mod apply;
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
pub(crate) mod native;

use super::model::{
    StateError, UpdaterBlocker, UpdaterFailure, UpdaterSnapshot, UpdaterState, UpdaterStatus,
    UpdaterTarget, UpdaterTrigger,
};
use semver::Version;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub(crate) type BackendFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, BackendError>> + Send + 'a>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BackendError {
    Check,
    Download,
    Install,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UpdateMetadata {
    pub current_version: String,
    pub version: String,
    pub target: String,
    pub asset_path: String,
    pub secure_download: bool,
    pub release_notes: Option<String>,
}

pub(crate) struct CheckOutcome {
    pub current_version: String,
    pub update: Option<Box<dyn UpdatePackage>>,
}

pub(crate) trait UpdatePackage: Send + Sync {
    fn metadata(&self) -> &UpdateMetadata;
    fn download<'a>(
        &'a self,
        on_chunk: Arc<dyn Fn(usize, Option<u64>) + Send + Sync>,
    ) -> BackendFuture<'a, Vec<u8>>;
    fn install(&self, bytes: &[u8]) -> Result<(), BackendError>;
}

pub(crate) trait UpdaterBackend: Send + Sync {
    fn check(&self) -> BackendFuture<'_, CheckOutcome>;
}

pub(crate) trait UpdaterEventSink: Send + Sync {
    fn publish(&self, snapshot: UpdaterSnapshot);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ServiceError {
    pub code: &'static str,
    pub message: &'static str,
}

impl ServiceError {
    fn state(error: StateError) -> Self {
        match error {
            StateError::Busy(_) => Self::busy(),
            _ => Self {
                code: "updaterStateRejected",
                message: "현재 업데이트 상태에서는 이 작업을 실행할 수 없습니다.",
            },
        }
    }

    fn busy() -> Self {
        Self {
            code: "updaterBusy",
            message: "다른 업데이트 작업이 진행 중입니다.",
        }
    }
}

struct ServiceInner {
    state: Mutex<UpdaterState>,
    backend: Option<Arc<dyn UpdaterBackend>>,
    target: Option<UpdaterTarget>,
    pending: Mutex<Option<Box<dyn UpdatePackage>>>,
    busy: AtomicBool,
}

#[derive(Clone)]
pub(crate) struct UpdaterService {
    inner: Arc<ServiceInner>,
}

impl UpdaterService {
    pub(crate) fn supported(target: UpdaterTarget, backend: Arc<dyn UpdaterBackend>) -> Self {
        Self::new(UpdaterState::default(), Some(target), Some(backend))
    }

    pub(crate) fn manual(blocker: UpdaterBlocker, downloads_url: String) -> Self {
        Self::new(
            UpdaterState::manual_only(blocker, downloads_url),
            None,
            None,
        )
    }

    fn new(
        state: UpdaterState,
        target: Option<UpdaterTarget>,
        backend: Option<Arc<dyn UpdaterBackend>>,
    ) -> Self {
        Self {
            inner: Arc::new(ServiceInner {
                state: Mutex::new(state),
                backend,
                target,
                pending: Mutex::new(None),
                busy: AtomicBool::new(false),
            }),
        }
    }

    pub(crate) fn is_enabled(&self) -> bool {
        self.inner.backend.is_some()
    }

    pub(crate) fn snapshot(&self) -> UpdaterSnapshot {
        self.inner
            .state
            .lock()
            .expect("updater state poisoned")
            .snapshot()
    }

    pub(crate) async fn check(
        &self,
        trigger: UpdaterTrigger,
        sink: Arc<dyn UpdaterEventSink>,
    ) -> Result<UpdaterSnapshot, ServiceError> {
        let Some(backend) = self.inner.backend.clone() else {
            let snapshot = self.snapshot();
            sink.publish(snapshot.clone());
            return Ok(snapshot);
        };
        let _operation = self.acquire()?;
        self.inner
            .pending
            .lock()
            .expect("pending update poisoned")
            .take();
        let operation_id = self
            .inner
            .state
            .lock()
            .expect("updater state poisoned")
            .begin_check(trigger)
            .map_err(ServiceError::state)?;
        self.publish(&sink);
        let outcome = match backend.check().await {
            Ok(outcome) => outcome,
            Err(error) => return self.fail(operation_id, error, &sink),
        };
        let Some(update) = outcome.update else {
            self.inner
                .state
                .lock()
                .expect("updater state poisoned")
                .mark_no_update(operation_id, outcome.current_version)
                .map_err(ServiceError::state)?;
            return Ok(self.publish(&sink));
        };
        let target =
            self.inner
                .target
                .clone()
                .ok_or(ServiceError::state(StateError::InvalidTransition(
                    UpdaterStatus::Checking,
                )))?;
        if !valid_metadata(update.metadata(), &target, &outcome.current_version) {
            return self.fail_metadata(operation_id, &sink);
        }
        let metadata = update.metadata().clone();
        self.inner
            .state
            .lock()
            .expect("updater state poisoned")
            .mark_available(
                operation_id,
                metadata.current_version,
                metadata.version,
                target,
                metadata.release_notes,
            )
            .map_err(ServiceError::state)?;
        self.inner
            .pending
            .lock()
            .expect("pending update poisoned")
            .replace(update);
        Ok(self.publish(&sink))
    }

    fn fail(
        &self,
        operation_id: u64,
        error: BackendError,
        sink: &Arc<dyn UpdaterEventSink>,
    ) -> Result<UpdaterSnapshot, ServiceError> {
        let failure = backend_failure(error);
        self.inner
            .pending
            .lock()
            .expect("pending update poisoned")
            .take();
        self.inner
            .state
            .lock()
            .expect("updater state poisoned")
            .fail(operation_id, failure)
            .map_err(ServiceError::state)?;
        Ok(self.publish(sink))
    }

    fn fail_metadata(
        &self,
        operation_id: u64,
        sink: &Arc<dyn UpdaterEventSink>,
    ) -> Result<UpdaterSnapshot, ServiceError> {
        self.inner
            .state
            .lock()
            .expect("updater state poisoned")
            .fail(
                operation_id,
                UpdaterFailure {
                    code: "invalidUpdateMetadata".into(),
                    message: "업데이트 정보가 현재 설치 형식과 일치하지 않습니다.".into(),
                    retryable: false,
                },
            )
            .map_err(ServiceError::state)?;
        Ok(self.publish(sink))
    }

    fn publish(&self, sink: &Arc<dyn UpdaterEventSink>) -> UpdaterSnapshot {
        let snapshot = self.snapshot();
        sink.publish(snapshot.clone());
        snapshot
    }

    fn acquire(&self) -> Result<OperationGuard<'_>, ServiceError> {
        self.inner
            .busy
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map_err(|_| ServiceError::busy())?;
        Ok(OperationGuard(&self.inner.busy))
    }
}

struct OperationGuard<'a>(&'a AtomicBool);

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn valid_metadata(metadata: &UpdateMetadata, target: &UpdaterTarget, current: &str) -> bool {
    let parse = |value: &str| Version::parse(value.strip_prefix('v').unwrap_or(value));
    let (Ok(current_version), Ok(update_version)) = (parse(current), parse(&metadata.version))
    else {
        return false;
    };
    metadata.current_version == current
        && update_version > current_version
        && metadata.target == target.target
        && metadata.secure_download
        && target.accepts_asset_path(&metadata.asset_path)
}

fn backend_failure(error: BackendError) -> UpdaterFailure {
    let (code, message) = match error {
        BackendError::Check => ("updateCheckFailed", "업데이트 정보를 확인하지 못했습니다."),
        BackendError::Download => (
            "updateDownloadFailed",
            "업데이트를 다운로드하지 못했습니다.",
        ),
        BackendError::Install => ("updateInstallFailed", "업데이트를 설치하지 못했습니다."),
    };
    UpdaterFailure {
        code: code.into(),
        message: message.into(),
        retryable: true,
    }
}
