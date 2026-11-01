use super::model::{UpdaterBlocker, UpdaterSnapshot, UpdaterTrigger};
use super::service::{ServiceError, UpdaterEventSink, UpdaterService};
use super::target::{detect_updater_target, NativeTargetProbe, TargetEligibility};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{App, AppHandle, Emitter, Manager, State};

const UPDATER_EVENT: &str = "hwply-updater-state";
const MANUAL_DOWNLOADS_URL: &str = "https://github.com/dandacompany/hwply/releases";

pub(crate) fn setup(app: &mut App) -> tauri::Result<()> {
    let eligibility = detect_updater_target(&NativeTargetProbe);
    let service = build_service(app, eligibility)?;
    let startup_enabled = service.is_enabled();
    let _ = app.manage(service.clone());
    if startup_enabled {
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let sink: Arc<dyn UpdaterEventSink> = Arc::new(TauriEventSink(app_handle));
            let _ = service.check(UpdaterTrigger::Startup, sink).await;
        });
    }
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
fn build_service(app: &mut App, eligibility: TargetEligibility) -> tauri::Result<UpdaterService> {
    use super::service::native::NativeUpdaterBackend;

    match eligibility {
        TargetEligibility::Supported(target) if release_configured(app) => {
            app.handle().plugin(
                tauri_plugin_updater::Builder::new()
                    .target(target.target.clone())
                    .build(),
            )?;
            let backend = Arc::new(NativeUpdaterBackend::new(
                app.handle().clone(),
                target.clone(),
            ));
            Ok(UpdaterService::supported(target, backend))
        }
        TargetEligibility::ManualOnly {
            blocker,
            downloads_url,
            ..
        } => Ok(UpdaterService::manual(blocker, downloads_url)),
        TargetEligibility::Supported(_) => Ok(UpdaterService::manual(
            UpdaterBlocker::UnsupportedInstall,
            MANUAL_DOWNLOADS_URL.into(),
        )),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn build_service(_app: &mut App, eligibility: TargetEligibility) -> tauri::Result<UpdaterService> {
    let (blocker, downloads_url) = match eligibility {
        TargetEligibility::ManualOnly {
            blocker,
            downloads_url,
            ..
        } => (blocker, downloads_url),
        TargetEligibility::Supported(_) => (
            UpdaterBlocker::UnsupportedInstall,
            MANUAL_DOWNLOADS_URL.into(),
        ),
    };
    Ok(UpdaterService::manual(blocker, downloads_url))
}

fn release_configured(app: &App) -> bool {
    if cfg!(debug_assertions) {
        return false;
    }
    let Some(config) = app.config().plugins.0.get("updater") else {
        return false;
    };
    let has_pubkey = config
        .get("pubkey")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let has_endpoint = config
        .get("endpoints")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|values| !values.is_empty());
    has_pubkey && has_endpoint
}

#[tauri::command]
pub(crate) fn updater_get_state(updater: State<'_, UpdaterService>) -> UpdaterSnapshot {
    updater.snapshot()
}

#[tauri::command]
pub(crate) fn updater_open_manual_downloads() -> Result<(), String> {
    open::that(MANUAL_DOWNLOADS_URL)
        .map_err(|error| format!("다운로드 페이지를 열 수 없습니다: {error}"))
}

#[tauri::command]
pub(crate) async fn updater_check(
    app: AppHandle,
    updater: State<'_, UpdaterService>,
) -> Result<UpdaterSnapshot, String> {
    updater
        .check(UpdaterTrigger::Manual, event_sink(app))
        .await
        .map_err(public_error)
}

#[tauri::command]
pub(crate) async fn updater_apply(
    app: AppHandle,
    state: State<'_, AppState>,
    updater: State<'_, UpdaterService>,
) -> Result<UpdaterSnapshot, String> {
    updater
        .apply(|| state.has_dirty_sessions(), event_sink(app))
        .await
        .map_err(public_error)
}

#[tauri::command]
pub(crate) fn updater_restart(
    app: AppHandle,
    updater: State<'_, UpdaterService>,
) -> Result<UpdaterSnapshot, String> {
    updater.prepare_restart().map_err(public_error)?;
    let snapshot = updater.snapshot();
    app.request_restart();
    Ok(snapshot)
}

fn event_sink(app: AppHandle) -> Arc<dyn UpdaterEventSink> {
    Arc::new(TauriEventSink(app))
}

fn public_error(error: ServiceError) -> String {
    format!("{}: {}", error.code, error.message)
}

struct TauriEventSink(AppHandle);

impl UpdaterEventSink for TauriEventSink {
    fn publish(&self, snapshot: UpdaterSnapshot) {
        let _ = self.0.emit(UPDATER_EVENT, snapshot);
    }
}
