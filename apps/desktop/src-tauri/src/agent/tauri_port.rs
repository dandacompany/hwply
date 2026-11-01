use crate::agent::discovery::{new_token, DiscoveryFile, DiscoveryInfo};
use crate::agent::http;
use crate::agent::hub::{AttachRequest, HubCore, Timeouts, WindowPort, AGENT_REQUEST_EVENT};
use crate::agent::protocol::ApiError;
use crate::agent::staging::StagingDir;
use crate::state::AppState;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_fs::FsExt;

pub struct TauriWindowPort {
    app: AppHandle,
}

impl WindowPort for TauriWindowPort {
    fn emit_request(&self, label: &str, payload: Value) -> Result<(), String> {
        self.app
            .emit_to(label, AGENT_REQUEST_EVENT, payload)
            .map_err(|e| format!("창에 요청을 보내지 못했습니다: {e}"))
    }

    fn is_focused(&self, label: &str) -> bool {
        self.app
            .get_webview_window(label)
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
    }

    fn focus(&self, label: &str) {
        if let Some(window) = self.app.get_webview_window(label) {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    fn open_in_new_window(&self, path: &Path) -> Result<(), String> {
        let app = self.app.clone();
        let path = path.to_string_lossy().into_owned();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = crate::open_path_in_new_window(&app, path) {
                eprintln!("[agent] 새 창으로 열기 실패: {error}");
            }
        });
        Ok(())
    }

    fn create_blank_window(&self) -> Result<String, String> {
        let app = self.app.clone();
        let label = crate::windows::new_editor_window_label();
        let created = label.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = crate::windows::create_editor_window_with_label(&app, &created) {
                eprintln!("[agent] 새 창 만들기 실패: {error}");
            }
        });
        Ok(label)
    }

    fn session_dirty(&self, doc_id: &str) -> Option<bool> {
        let state = self.app.state::<AppState>();
        let sessions = state.sessions.lock().ok()?;
        sessions.session(doc_id).ok().map(|s| s.dirty)
    }
}

/// 앱이 보유하는 브리지. 놓으면 `agent.json` 이 지워진다.
pub struct AgentHub {
    pub core: Arc<HubCore<TauriWindowPort>>,
    discovery: Mutex<Option<DiscoveryFile>>,
}

impl AgentHub {
    pub fn start(app: &AppHandle) -> Result<AgentHub, Box<dyn std::error::Error>> {
        let staging = StagingDir::new(&app.path().app_cache_dir()?.join("agent"))?;
        // 창이 이 폴더에 내보낸 바이트를 쓰고 교체 바이트를 읽는다. 폴더 하나만, 하위 폴더 없이 허용한다.
        app.fs_scope().allow_directory(staging.dir(), false)?;
        let app_version = app.package_info().version.to_string();
        let rhwp_version = env!("HWPLY_RHWP_TAG").to_string();
        let health = json!({
            "appVersion": app_version,
            "rhwpVersion": rhwp_version,
            "pid": std::process::id(),
        });
        let port = TauriWindowPort { app: app.clone() };
        let core = Arc::new(HubCore::new(port, staging, Timeouts::default(), health));

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let token = new_token();
        let router = http::router(core.clone(), token.clone());
        tauri::async_runtime::spawn(async move {
            match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => {
                    if let Err(error) = axum::serve(listener, router).await {
                        eprintln!("[agent] 브리지 서버가 멈췄습니다: {error}");
                    }
                }
                Err(error) => eprintln!("[agent] 브리지 소켓을 쓸 수 없습니다: {error}"),
            }
        });

        let discovery = DiscoveryFile::write(
            &app.path().app_data_dir()?,
            &DiscoveryInfo {
                port,
                token,
                pid: std::process::id(),
                app_version,
                rhwp_version,
            },
        )?;
        Ok(AgentHub {
            core,
            discovery: Mutex::new(Some(discovery)),
        })
    }

    pub fn shutdown(&self) {
        if let Ok(mut discovery) = self.discovery.lock() {
            discovery.take();
        }
    }
}

#[tauri::command]
pub fn agent_attach_document(
    window: WebviewWindow,
    doc: AttachRequest,
    hub: tauri::State<'_, AgentHub>,
) {
    hub.core.attach(window.label(), doc);
}

#[tauri::command]
pub fn agent_detach_document(window: WebviewWindow, hub: tauri::State<'_, AgentHub>) {
    hub.core.detach(window.label());
}

#[tauri::command]
pub fn agent_respond(
    request_id: String,
    result: Option<Value>,
    error: Option<ApiError>,
    hub: tauri::State<'_, AgentHub>,
) {
    hub.core.respond(&request_id, result, error);
}

#[tauri::command]
pub fn agent_take_new_document_request(
    window: WebviewWindow,
    hub: tauri::State<'_, AgentHub>,
) -> bool {
    hub.core.take_new_document_request(window.label())
}
