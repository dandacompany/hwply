use super::model::{
    ArtifactKind, StateError, UpdaterBlocker, UpdaterState, UpdaterStatus, UpdaterTarget,
    UpdaterTrigger,
};

fn available_state() -> (UpdaterState, u64) {
    let mut state = UpdaterState::default();
    let operation_id = state.begin_check(UpdaterTrigger::Manual).unwrap();
    state
        .mark_available(
            operation_id,
            "0.1.0".into(),
            "0.2.0".into(),
            UpdaterTarget::for_kind(ArtifactKind::Nsis),
            Some("notes".into()),
        )
        .unwrap();
    (state, operation_id)
}

#[test]
fn state_serializes_the_public_camel_case_contract() {
    let (state, _) = available_state();
    let value = serde_json::to_value(state.snapshot()).unwrap();
    assert_eq!(value["status"], "available");
    assert_eq!(value["trigger"], "manual");
    assert_eq!(value["target"]["target"], "windows-x86_64-nsis");
    assert_eq!(value["target"]["artifactKind"], "nsis");

    let restart = serde_json::to_value(UpdaterStatus::RestartRequired).unwrap();
    assert_eq!(restart, "restartRequired");
    let blocker = serde_json::to_value(UpdaterBlocker::ReadOnlyAppImage).unwrap();
    assert_eq!(blocker, "readOnlyAppImage");
}

#[test]
fn manual_only_state_exposes_a_safe_fallback() {
    let state = UpdaterState::manual_only(
        UpdaterBlocker::UnsupportedInstall,
        "https://github.com/dandacompany/hwply/releases".into(),
    );
    let snapshot = state.snapshot();
    assert_eq!(snapshot.status, UpdaterStatus::Idle);
    assert_eq!(snapshot.blocker, Some(UpdaterBlocker::UnsupportedInstall));
    assert!(snapshot
        .manual_downloads_url
        .unwrap()
        .ends_with("/hwply/releases"));
}

#[test]
fn valid_lifecycle_tracks_monotonic_progress_and_restart() {
    let (mut state, operation_id) = available_state();
    state.begin_download(operation_id).unwrap();
    state.update_progress(operation_id, 25, Some(100)).unwrap();
    state.update_progress(operation_id, 100, Some(100)).unwrap();
    state.begin_install(operation_id).unwrap();
    state.mark_restart_required(operation_id).unwrap();

    let snapshot = state.snapshot();
    assert_eq!(snapshot.status, UpdaterStatus::RestartRequired);
    assert_eq!(snapshot.progress.unwrap().percent, Some(100));
}

#[test]
fn invalid_and_stale_transitions_are_rejected() {
    let (mut state, operation_id) = available_state();
    assert_eq!(
        state.begin_install(operation_id),
        Err(StateError::InvalidTransition(UpdaterStatus::Available))
    );
    assert_eq!(
        state.begin_download(operation_id + 1),
        Err(StateError::StaleOperation)
    );
    state.begin_download(operation_id).unwrap();
    assert_eq!(
        state.update_progress(operation_id, 10, Some(5)),
        Err(StateError::InvalidProgress)
    );
    state.update_progress(operation_id, 5, Some(10)).unwrap();
    assert_eq!(
        state.update_progress(operation_id, 4, Some(10)),
        Err(StateError::InvalidProgress)
    );
}

#[test]
fn dirty_guard_returns_download_to_available() {
    let (mut state, operation_id) = available_state();
    state.begin_download(operation_id).unwrap();
    state
        .block_apply(operation_id, UpdaterBlocker::DirtyDocuments)
        .unwrap();

    let snapshot = state.snapshot();
    assert_eq!(snapshot.status, UpdaterStatus::Available);
    assert_eq!(snapshot.blocker, Some(UpdaterBlocker::DirtyDocuments));
    assert!(snapshot.progress.is_none());
}

#[test]
fn target_and_asset_kind_must_match() {
    let msi = UpdaterTarget::for_kind(ArtifactKind::Msi);
    let nsis = UpdaterTarget::for_kind(ArtifactKind::Nsis);
    let appimage = UpdaterTarget::for_kind(ArtifactKind::AppImage);

    assert!(msi.accepts_asset_path("/hwply_0.2.0_x64_en-US.msi"));
    assert!(nsis.accepts_asset_path("/hwply_0.2.0_x64-setup.exe"));
    assert!(appimage.accepts_asset_path("/hwply_0.2.0_amd64.AppImage"));
    assert!(!msi.accepts_asset_path("/hwply_0.2.0_x64-setup.exe"));
    assert!(!nsis.accepts_asset_path("/hwply_0.2.0_x64_en-US.msi"));
    assert!(!appimage.accepts_asset_path("/hwply_0.2.0_amd64.deb"));
    assert!(!msi.accepts_asset_path("/hwply_0.2.0_arm64_en-US.msi"));
    assert!(!nsis.accepts_asset_path("/hwply_0.2.0_arm64-setup.exe"));
    assert!(!appimage.accepts_asset_path("/hwply_0.2.0_arm64.AppImage"));
}

#[test]
fn native_backend_bounds_manifest_and_asset_requests() {
    let source = include_str!("service/native.rs");
    assert!(source.contains("Duration::from_secs(120)"));
    assert!(source.contains(".timeout(UPDATER_REQUEST_TIMEOUT)"));
    assert!(source.contains("update.timeout = Some(UPDATER_REQUEST_TIMEOUT)"));
}
