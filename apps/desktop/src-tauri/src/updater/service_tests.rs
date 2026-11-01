use super::model::{
    ArtifactKind, UpdaterBlocker, UpdaterSnapshot, UpdaterStatus, UpdaterTarget, UpdaterTrigger,
};
use super::service::{
    BackendError, BackendFuture, CheckOutcome, UpdateMetadata, UpdatePackage, UpdaterBackend,
    UpdaterEventSink, UpdaterService,
};
use std::collections::VecDeque;
use std::future::{pending, Future};
use std::pin::pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

struct RecordedEvents(Mutex<Vec<UpdaterSnapshot>>);

impl RecordedEvents {
    fn new() -> Arc<Self> {
        Arc::new(Self(Mutex::new(Vec::new())))
    }

    fn snapshots(&self) -> Vec<UpdaterSnapshot> {
        self.0.lock().expect("event recorder poisoned").clone()
    }
}

impl UpdaterEventSink for RecordedEvents {
    fn publish(&self, snapshot: UpdaterSnapshot) {
        self.0
            .lock()
            .expect("event recorder poisoned")
            .push(snapshot);
    }
}

struct FixtureBackend(Mutex<VecDeque<Result<CheckOutcome, BackendError>>>);

impl FixtureBackend {
    fn new(outcomes: Vec<Result<CheckOutcome, BackendError>>) -> Arc<Self> {
        Arc::new(Self(Mutex::new(outcomes.into())))
    }
}

impl UpdaterBackend for FixtureBackend {
    fn check(&self) -> BackendFuture<'_, CheckOutcome> {
        Box::pin(async move {
            self.0
                .lock()
                .expect("fixture backend poisoned")
                .pop_front()
                .expect("missing fixture outcome")
        })
    }
}

struct PendingBackend;

impl UpdaterBackend for PendingBackend {
    fn check(&self) -> BackendFuture<'_, CheckOutcome> {
        Box::pin(pending())
    }
}

struct FixturePackage {
    metadata: UpdateMetadata,
    downloaded: Arc<AtomicBool>,
    installed: Arc<AtomicBool>,
}

impl UpdatePackage for FixturePackage {
    fn metadata(&self) -> &UpdateMetadata {
        &self.metadata
    }

    fn download<'a>(
        &'a self,
        on_chunk: Arc<dyn Fn(usize, Option<u64>) + Send + Sync>,
    ) -> BackendFuture<'a, Vec<u8>> {
        Box::pin(async move {
            self.downloaded.store(true, Ordering::Relaxed);
            on_chunk(3, Some(8));
            on_chunk(5, Some(8));
            Ok(vec![1, 2, 3])
        })
    }

    fn install(&self, _bytes: &[u8]) -> Result<(), BackendError> {
        self.installed.store(true, Ordering::Relaxed);
        Ok(())
    }
}

#[test]
fn appimage_lifecycle_publishes_progress_and_requires_restart() {
    let installed = Arc::new(AtomicBool::new(false));
    let service = fixture_service(
        ArtifactKind::AppImage,
        vec![Ok(update_outcome(
            ArtifactKind::AppImage,
            installed.clone(),
        ))],
    );
    let events = RecordedEvents::new();

    let available =
        tauri::async_runtime::block_on(service.check(UpdaterTrigger::Manual, events.clone()))
            .expect("check should succeed");
    let completed = tauri::async_runtime::block_on(service.apply(|| false, events.clone()))
        .expect("apply should succeed");

    assert_eq!(available.status, UpdaterStatus::Available);
    assert_eq!(completed.status, UpdaterStatus::RestartRequired);
    assert!(installed.load(Ordering::Relaxed));
    assert!(events.snapshots().iter().any(|snapshot| {
        snapshot
            .progress
            .as_ref()
            .is_some_and(|progress| progress.percent == Some(100))
    }));
}

#[test]
fn mac_app_install_requires_restart() {
    let installed = Arc::new(AtomicBool::new(false));
    let service = fixture_service(
        ArtifactKind::MacAppAarch64,
        vec![Ok(update_outcome(
            ArtifactKind::MacAppAarch64,
            installed.clone(),
        ))],
    );
    let events = RecordedEvents::new();
    tauri::async_runtime::block_on(service.check(UpdaterTrigger::Manual, events.clone()))
        .expect("check should succeed");
    let completed = tauri::async_runtime::block_on(service.apply(|| false, events.clone()))
        .expect("apply should succeed");
    assert_eq!(completed.status, UpdaterStatus::RestartRequired);
    assert!(installed.load(Ordering::Relaxed));
}

#[test]
fn dirty_document_guard_blocks_before_download() {
    let downloaded = Arc::new(AtomicBool::new(false));
    let installed = Arc::new(AtomicBool::new(false));
    let service = fixture_service(
        ArtifactKind::AppImage,
        vec![Ok(tracked_update_outcome(
            ArtifactKind::AppImage,
            downloaded.clone(),
            installed.clone(),
        ))],
    );
    let events = RecordedEvents::new();
    tauri::async_runtime::block_on(service.check(UpdaterTrigger::Manual, events.clone()))
        .expect("check should succeed");

    let blocked = tauri::async_runtime::block_on(service.apply(|| true, events))
        .expect("dirty document should return a state snapshot");

    assert_eq!(blocked.status, UpdaterStatus::Available);
    assert_eq!(blocked.blocker, Some(UpdaterBlocker::DirtyDocuments));
    assert!(!downloaded.load(Ordering::Relaxed));
    assert!(!installed.load(Ordering::Relaxed));
}

#[test]
fn dirty_document_guard_runs_before_install_and_keeps_update_retryable() {
    let downloaded = Arc::new(AtomicBool::new(false));
    let installed = Arc::new(AtomicBool::new(false));
    let service = fixture_service(
        ArtifactKind::AppImage,
        vec![Ok(tracked_update_outcome(
            ArtifactKind::AppImage,
            downloaded.clone(),
            installed.clone(),
        ))],
    );
    let events = RecordedEvents::new();
    tauri::async_runtime::block_on(service.check(UpdaterTrigger::Manual, events.clone()))
        .expect("check should succeed");
    let guard_count = AtomicUsize::new(0);

    let blocked = tauri::async_runtime::block_on(
        service.apply(|| guard_count.fetch_add(1, Ordering::Relaxed) > 0, events),
    )
    .expect("dirty document should return a state snapshot");

    assert_eq!(blocked.status, UpdaterStatus::Available);
    assert_eq!(blocked.blocker, Some(UpdaterBlocker::DirtyDocuments));
    assert!(downloaded.load(Ordering::Relaxed));
    assert!(!installed.load(Ordering::Relaxed));
}

#[test]
fn cross_target_metadata_is_rejected_before_download() {
    let installed = Arc::new(AtomicBool::new(false));
    let service = fixture_service(
        ArtifactKind::Nsis,
        vec![Ok(update_outcome(ArtifactKind::Msi, installed.clone()))],
    );

    let snapshot = tauri::async_runtime::block_on(
        service.check(UpdaterTrigger::Manual, RecordedEvents::new()),
    )
    .expect("invalid metadata is represented as updater state");

    assert_eq!(snapshot.status, UpdaterStatus::Error);
    assert_eq!(
        snapshot.failure.expect("missing failure").code,
        "invalidUpdateMetadata"
    );
    assert!(!installed.load(Ordering::Relaxed));
}

#[test]
fn a_second_native_operation_is_rejected_while_check_is_pending() {
    let service = UpdaterService::supported(
        UpdaterTarget::for_kind(ArtifactKind::AppImage),
        Arc::new(PendingBackend),
    );
    let events = RecordedEvents::new();
    let mut first = pin!(service.check(UpdaterTrigger::Startup, events.clone()));
    let waker = Waker::noop();
    let mut context = Context::from_waker(waker);
    assert_eq!(first.as_mut().poll(&mut context), Poll::Pending);

    let error = tauri::async_runtime::block_on(service.check(UpdaterTrigger::Manual, events))
        .expect_err("concurrent operation should be rejected");

    assert_eq!(error.code, "updaterBusy");
}

#[test]
fn manual_only_and_failed_check_keep_safe_user_visible_states() {
    let manual = UpdaterService::manual(
        UpdaterBlocker::UnsupportedInstall,
        "https://example.invalid/updates/".into(),
    );
    let manual_snapshot =
        tauri::async_runtime::block_on(manual.check(UpdaterTrigger::Manual, RecordedEvents::new()))
            .expect("manual fallback should be readable");
    assert_eq!(
        manual_snapshot.blocker,
        Some(UpdaterBlocker::UnsupportedInstall)
    );

    let service = fixture_service(ArtifactKind::Nsis, vec![Err(BackendError::Check)]);
    let failed = tauri::async_runtime::block_on(
        service.check(UpdaterTrigger::Manual, RecordedEvents::new()),
    )
    .expect("backend failure should be represented as updater state");
    assert_eq!(failed.status, UpdaterStatus::Error);
    assert!(failed.failure.expect("missing failure").retryable);
}

fn fixture_service(
    expected_kind: ArtifactKind,
    outcomes: Vec<Result<CheckOutcome, BackendError>>,
) -> UpdaterService {
    UpdaterService::supported(
        UpdaterTarget::for_kind(expected_kind),
        FixtureBackend::new(outcomes),
    )
}

fn update_outcome(kind: ArtifactKind, installed: Arc<AtomicBool>) -> CheckOutcome {
    tracked_update_outcome(kind, Arc::new(AtomicBool::new(false)), installed)
}

fn tracked_update_outcome(
    kind: ArtifactKind,
    downloaded: Arc<AtomicBool>,
    installed: Arc<AtomicBool>,
) -> CheckOutcome {
    let asset_path = match kind {
        ArtifactKind::Msi => "hwply_0.2.0_x64_en-US.msi",
        ArtifactKind::Nsis => "hwply_0.2.0_x64-setup.exe",
        ArtifactKind::AppImage => "hwply_0.2.0_amd64.AppImage",
        ArtifactKind::MacAppAarch64 => "hwply_aarch64.app.tar.gz",
        ArtifactKind::MacAppX64 => "hwply_x64.app.tar.gz",
    };
    CheckOutcome {
        current_version: "0.1.0".into(),
        update: Some(Box::new(FixturePackage {
            metadata: UpdateMetadata {
                current_version: "0.1.0".into(),
                version: "0.2.0".into(),
                target: kind.target().into(),
                asset_path: asset_path.into(),
                secure_download: true,
                release_notes: Some("fixture release".into()),
            },
            downloaded,
            installed,
        })),
    }
}
