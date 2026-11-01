use crate::agent::backend::{AgentBackend, DocSummary, ExportFormat, ExportedBytes};
use crate::agent::pending::PendingRequests;
use crate::agent::protocol::{ApiError, DocumentState, ErrorCode, Expected};
use crate::agent::registry::{AgentRegistry, AttachedDocument};
use crate::agent::staging::StagingDir;
use crate::state::DocumentFormat;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// 교체 파일 크기 상한.
pub const MAX_REPLACE_BYTES: u64 = 256 * 1024 * 1024;
pub const AGENT_REQUEST_EVENT: &str = "hwply-agent-request";

/// 허브가 창을 다루는 길. 앱에서는 Tauri, 테스트에서는 가짜.
pub trait WindowPort: Send + Sync + 'static {
    fn emit_request(&self, label: &str, payload: Value) -> Result<(), String>;
    fn is_focused(&self, label: &str) -> bool;
    fn focus(&self, label: &str);
    /// 기다리지 않는다. 창이 문서를 붙이면(`attach`) 레지스트리에 나타난다.
    fn open_in_new_window(&self, path: &Path) -> Result<(), String>;
    /// 새 창의 라벨. 창은 비동기로 만들어진다.
    fn create_blank_window(&self) -> Result<String, String>;
    fn session_dirty(&self, doc_id: &str) -> Option<bool>;
}

#[derive(Debug, Clone)]
pub struct Timeouts {
    pub call: Duration,
    /// export·replace·save
    pub long: Duration,
    /// 문서 목록의 창별 상태 조회
    pub state: Duration,
    pub attach_wait: Duration,
    pub attach_poll: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Timeouts {
            call: Duration::from_secs(30),
            long: Duration::from_secs(120),
            state: Duration::from_secs(2),
            attach_wait: Duration::from_secs(30),
            attach_poll: Duration::from_millis(100),
        }
    }
}

/// 창이 `agent_attach_document` 로 보내는 문서 정보.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachRequest {
    pub doc_id: String,
    pub file_name: String,
    pub source_path: Option<String>,
    pub format: String,
    pub encrypted: bool,
}

pub struct HubCore<P: WindowPort> {
    port: P,
    registry: Mutex<AgentRegistry>,
    pending: PendingRequests,
    staging: StagingDir,
    window_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    open_locks: Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>,
    /// `new` 로 만든 창. 네이티브 창은 빈 문서를 저절로 만들지 않으므로 시작할 때 이것을 묻는다.
    new_document_windows: Mutex<std::collections::HashSet<String>>,
    timeouts: Timeouts,
    health: Value,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Windows `canonicalize` 는 `\\?\C:\…` 같은 verbatim 경로를 돌려준다. 창·사람에게 넘길 경로에서는 접두사를 뗀다.
pub fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

/// 실제 경로(심볼릭 링크·`.`·NFD 정리) — verbatim 접두사 없이.
pub fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    std::fs::canonicalize(path).map(plain_path)
}

fn bad_request(message: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::BadRequest, message)
}

fn doc_not_found(id: &str) -> ApiError {
    ApiError::new(
        ErrorCode::DocNotFound,
        format!("열린 문서가 아닙니다: {id}"),
    )
}

impl<P: WindowPort> HubCore<P> {
    pub fn new(port: P, staging: StagingDir, timeouts: Timeouts, health: Value) -> Self {
        HubCore {
            port,
            registry: Mutex::default(),
            pending: PendingRequests::default(),
            staging,
            window_locks: Mutex::default(),
            open_locks: Mutex::default(),
            new_document_windows: Mutex::default(),
            timeouts,
            health,
        }
    }

    pub fn attach(&self, label: &str, doc: AttachRequest) {
        let source_path = doc.source_path.map(PathBuf::from);
        let canonical_path = source_path.as_deref().and_then(|p| canonical(p).ok());
        lock(&self.registry).attach(AttachedDocument {
            doc_id: doc.doc_id,
            window_label: label.to_string(),
            file_name: doc.file_name,
            source_path,
            canonical_path,
            format: doc.format,
            encrypted: doc.encrypted,
        });
    }

    pub fn detach(&self, label: &str) {
        lock(&self.registry).detach_window(label);
    }

    /// 창이 시작할 때 한 번 부른다. true 면 빈 문서를 만든다.
    pub fn take_new_document_request(&self, label: &str) -> bool {
        lock(&self.new_document_windows).remove(label)
    }

    pub fn note_focus(&self, label: &str) {
        lock(&self.registry).note_focus(label);
    }

    pub fn window_destroyed(&self, label: &str) {
        self.detach(label);
        lock(&self.window_locks).remove(label);
        self.pending.fail_window(
            label,
            ApiError::new(ErrorCode::DocNotFound, "문서 창이 닫혔습니다"),
        );
    }

    /// 창의 응답. 오류는 `{code,message,state?}` 그대로.
    pub fn respond(
        &self,
        request_id: &str,
        result: Option<Value>,
        error: Option<ApiError>,
    ) -> bool {
        let reply = match error {
            Some(error) => Err(error),
            None => Ok(result.unwrap_or(Value::Null)),
        };
        self.pending.resolve(request_id, reply)
    }

    fn label_for(&self, doc_id: &str) -> Result<String, ApiError> {
        lock(&self.registry)
            .by_doc_id(doc_id)
            .map(|d| d.window_label.clone())
            .ok_or_else(|| doc_not_found(doc_id))
    }

    fn window_lock(&self, label: &str) -> Arc<tokio::sync::Mutex<()>> {
        lock(&self.window_locks)
            .entry(label.to_string())
            .or_default()
            .clone()
    }

    async fn request(
        &self,
        label: &str,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, ApiError> {
        let (id, receiver) = self.pending.register_for(label);
        let payload = json!({ "requestId": id, "method": method, "params": params });
        if let Err(error) = self.port.emit_request(label, payload) {
            self.pending.resolve(&id, Ok(Value::Null));
            return Err(ApiError::new(ErrorCode::AppBusy, error));
        }
        self.pending.wait(&id, receiver, timeout).await
    }

    /// 같은 창으로 가는 요청은 한 번에 하나(교체와 실시간 편집이 섞이지 않게).
    async fn locked_request(
        &self,
        doc_id: &str,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, ApiError> {
        let label = self.label_for(doc_id)?;
        let window_lock = self.window_lock(&label);
        let _guard = window_lock.lock().await;
        // 기다리는 사이 창이 다른 문서로 바뀌거나 닫혔을 수 있다.
        if self.label_for(doc_id)? != label {
            return Err(doc_not_found(doc_id));
        }
        self.request(&label, method, params, timeout).await
    }

    async fn state_of(&self, label: &str) -> Option<DocumentState> {
        let value = self
            .request(label, "state", json!({}), self.timeouts.state)
            .await
            .ok()?;
        serde_json::from_value(value).ok()
    }

    fn summary(
        &self,
        doc: &AttachedDocument,
        active: Option<&str>,
        state: Option<DocumentState>,
    ) -> DocSummary {
        DocSummary {
            id: doc.doc_id.clone(),
            path: doc
                .source_path
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            title: doc.file_name.clone(),
            format: doc.format.clone(),
            dirty: self.port.session_dirty(&doc.doc_id).unwrap_or(false),
            encrypted: doc.encrypted,
            window_label: doc.window_label.clone(),
            focused: self.port.is_focused(&doc.window_label),
            active: active == Some(doc.window_label.as_str()),
            state,
        }
    }

    async fn summary_for(
        &self,
        find: impl Fn(&AgentRegistry) -> Option<AttachedDocument>,
    ) -> Option<DocSummary> {
        let (doc, active) = {
            let registry = lock(&self.registry);
            (
                find(&registry)?,
                registry.active_label().map(str::to_string),
            )
        };
        let state = self.state_of(&doc.window_label).await;
        Some(self.summary(&doc, active.as_deref(), state))
    }

    async fn wait_for_attach(
        &self,
        find: impl Fn(&AgentRegistry) -> Option<AttachedDocument>,
    ) -> Result<DocSummary, ApiError> {
        let deadline = Instant::now() + self.timeouts.attach_wait;
        loop {
            if lock(&self.registry).is_attached(&find) {
                if let Some(summary) = self.summary_for(&find).await {
                    return Ok(summary);
                }
            }
            if Instant::now() >= deadline {
                return Err(ApiError::new(
                    ErrorCode::AppBusy,
                    "새 창이 제한 시간 안에 문서를 열지 못했습니다",
                ));
            }
            tokio::time::sleep(self.timeouts.attach_poll).await;
        }
    }

    /// 다른 이름으로 저장할 대상이 이미 있으면 force 없이는 덮어쓰지 않는다. 다른 창에 열린 파일은 force 로도 안 된다.
    fn check_save_target(&self, id: &str, params: &Value) -> Result<(), ApiError> {
        let Some(target) = params.get("path").and_then(Value::as_str) else {
            return Ok(());
        };
        let Ok(target) = canonical(Path::new(target)) else {
            return Ok(()); // 아직 없는 파일
        };
        let registry = lock(&self.registry);
        let own = registry.by_doc_id(id).ok_or_else(|| doc_not_found(id))?;
        if own.canonical_path.as_deref() == Some(target.as_path()) {
            return Ok(());
        }
        if let Some(other) = registry.by_canonical_path(&target) {
            return Err(ApiError::new(
                ErrorCode::TargetExists,
                format!(
                    "{} 는 다른 창에 열려 있습니다. 그 창을 닫거나 다른 경로를 고르세요.",
                    other.file_name
                ),
            ));
        }
        if params.get("force").and_then(Value::as_bool) != Some(true) {
            return Err(ApiError::new(
                ErrorCode::TargetExists,
                format!(
                    "{} 가 이미 있습니다. 덮어쓰려면 force 를 쓰세요.",
                    target.display()
                ),
            ));
        }
        Ok(())
    }

    fn take_staged(&self, staged: &Path) -> Result<Vec<u8>, ApiError> {
        let bytes = std::fs::read(staged).map_err(|e| {
            ApiError::new(
                ErrorCode::InternalError,
                format!("내보낸 바이트를 읽지 못했습니다: {e}"),
            )
        });
        let _ = std::fs::remove_file(staged);
        bytes
    }
}

impl AgentRegistry {
    fn is_attached(&self, find: &impl Fn(&AgentRegistry) -> Option<AttachedDocument>) -> bool {
        find(self).is_some()
    }
}

fn parse_state(value: &Value) -> Result<DocumentState, ApiError> {
    serde_json::from_value(value["state"].clone()).map_err(|e| {
        ApiError::new(
            ErrorCode::InternalError,
            format!("창 응답에 state 가 없습니다: {e}"),
        )
    })
}

#[async_trait::async_trait]
impl<P: WindowPort> AgentBackend for HubCore<P> {
    fn health(&self) -> Value {
        self.health.clone()
    }

    async fn list_docs(&self) -> Result<Vec<DocSummary>, ApiError> {
        let (docs, active) = {
            let registry = lock(&self.registry);
            let docs: Vec<AttachedDocument> = registry.list().into_iter().cloned().collect();
            (docs, registry.active_label().map(str::to_string))
        };
        let states =
            futures_util::future::join_all(docs.iter().map(|d| self.state_of(&d.window_label)))
                .await;
        Ok(docs
            .iter()
            .zip(states)
            .map(|(doc, state)| self.summary(doc, active.as_deref(), state))
            .collect())
    }

    async fn open(&self, path: PathBuf) -> Result<DocSummary, ApiError> {
        if !path.is_absolute() {
            return Err(bad_request("경로는 절대경로여야 합니다"));
        }
        let canonical = canonical(&path).map_err(|e| {
            bad_request(format!("파일을 찾을 수 없습니다: {} ({e})", path.display()))
        })?;
        let extension = canonical
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        if !matches!(extension.as_deref(), Some("hwp" | "hwpx")) || !canonical.is_file() {
            return Err(bad_request("hwp·hwpx 파일만 열 수 있습니다"));
        }
        let open_lock = lock(&self.open_locks)
            .entry(canonical.clone())
            .or_default()
            .clone();
        let _guard = open_lock.lock().await;
        let by_path = |r: &AgentRegistry| r.by_canonical_path(&canonical).cloned();
        let existing = by_path(&lock(&self.registry));
        if let Some(existing) = existing {
            self.port.focus(&existing.window_label);
            if let Some(summary) = self.summary_for(by_path).await {
                return Ok(summary);
            }
        }
        self.port
            .open_in_new_window(&canonical)
            .map_err(|e| ApiError::new(ErrorCode::AppBusy, e))?;
        self.wait_for_attach(by_path).await
    }

    async fn new_doc(&self) -> Result<DocSummary, ApiError> {
        let label = self
            .port
            .create_blank_window()
            .map_err(|e| ApiError::new(ErrorCode::AppBusy, e))?;
        lock(&self.new_document_windows).insert(label.clone());
        let result = self
            .wait_for_attach(|r: &AgentRegistry| r.by_label(&label).cloned())
            .await;
        lock(&self.new_document_windows).remove(&label);
        result
    }

    async fn doc(&self, id: &str) -> Result<DocSummary, ApiError> {
        self.summary_for(|r: &AgentRegistry| r.by_doc_id(id).cloned())
            .await
            .ok_or_else(|| doc_not_found(id))
    }

    async fn export(&self, id: &str, format: ExportFormat) -> Result<ExportedBytes, ApiError> {
        let staged = self.staging.new_path(format.as_str());
        let params = json!({ "format": format.as_str(), "stagedPath": staged });
        let result = self
            .locked_request(id, "export", params, self.timeouts.long)
            .await;
        let value = match result {
            Ok(value) => value,
            Err(error) => {
                let _ = std::fs::remove_file(&staged);
                return Err(error);
            }
        };
        let bytes = self.take_staged(&staged)?;
        Ok(ExportedBytes {
            bytes,
            state: parse_state(&value)?,
        })
    }

    async fn call(&self, id: &str, method: &str, params: Value) -> Result<Value, ApiError> {
        if method == "save" {
            self.check_save_target(id, &params)?;
        }
        let timeout = if method == "save" {
            self.timeouts.long
        } else {
            self.timeouts.call
        };
        self.locked_request(id, method, params, timeout).await
    }

    async fn replace(
        &self,
        id: &str,
        path: PathBuf,
        expected: Expected,
    ) -> Result<Value, ApiError> {
        if !path.is_absolute() {
            return Err(bad_request("경로는 절대경로여야 합니다"));
        }
        let size = std::fs::metadata(&path)
            .map_err(|e| bad_request(format!("파일을 읽을 수 없습니다: {} ({e})", path.display())))?
            .len();
        if size > MAX_REPLACE_BYTES {
            return Err(bad_request("교체 파일이 너무 큽니다(256 MiB 초과)"));
        }
        let bytes = std::fs::read(&path).map_err(|e| {
            bad_request(format!("파일을 읽을 수 없습니다: {} ({e})", path.display()))
        })?;
        let format = DocumentFormat::from_bytes(&bytes).map_err(bad_request)?;
        let doc_format = lock(&self.registry)
            .by_doc_id(id)
            .map(|d| d.format.clone())
            .ok_or_else(|| doc_not_found(id))?;
        if format.as_str() != doc_format {
            return Err(bad_request(format!(
                "교체 바이트 형식({})이 문서 형식({doc_format})과 다릅니다",
                format.as_str()
            )));
        }
        let staged = self.staging.new_path(format.as_str());
        std::fs::write(&staged, &bytes)
            .map_err(|e| ApiError::new(ErrorCode::InternalError, format!("스테이징 실패: {e}")))?;
        let params = json!({ "stagedPath": staged, "expected": expected });
        let result = self
            .locked_request(id, "replace", params, self.timeouts.long)
            .await;
        let _ = std::fs::remove_file(&staged);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::backend::AgentBackend;
    use crate::agent::protocol::{ApiError, ErrorCode, Expected};
    use serde_json::{json, Value};
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use tokio::sync::mpsc;

    #[derive(Default)]
    struct FakeState {
        emits: Vec<(String, Value, Instant)>,
        opened: Vec<PathBuf>,
        focused_calls: Vec<String>,
    }

    struct FakePort {
        state: Arc<Mutex<FakeState>>,
        tx: mpsc::UnboundedSender<(String, Value)>,
        on_open: Box<dyn Fn(&Path) + Send + Sync>,
    }

    impl WindowPort for FakePort {
        fn emit_request(&self, label: &str, payload: Value) -> Result<(), String> {
            self.state
                .lock()
                .unwrap()
                .emits
                .push((label.into(), payload.clone(), Instant::now()));
            let _ = self.tx.send((label.into(), payload));
            Ok(())
        }
        fn is_focused(&self, _label: &str) -> bool {
            false
        }
        fn focus(&self, label: &str) {
            self.state.lock().unwrap().focused_calls.push(label.into());
        }
        fn open_in_new_window(&self, path: &Path) -> Result<(), String> {
            self.state.lock().unwrap().opened.push(path.into());
            (self.on_open)(path);
            Ok(())
        }
        fn create_blank_window(&self) -> Result<String, String> {
            Ok("blank".into())
        }
        fn session_dirty(&self, _doc_id: &str) -> Option<bool> {
            Some(false)
        }
    }

    fn timeouts() -> Timeouts {
        Timeouts {
            call: Duration::from_secs(2),
            long: Duration::from_secs(2),
            state: Duration::from_millis(50),
            attach_wait: Duration::from_secs(2),
            attach_poll: Duration::from_millis(10),
        }
    }

    type Rx = mpsc::UnboundedReceiver<(String, Value)>;

    fn hub_with(
        on_open: Box<dyn Fn(&Path) + Send + Sync>,
    ) -> (
        Arc<HubCore<FakePort>>,
        Arc<Mutex<FakeState>>,
        Rx,
        tempfile::TempDir,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        let state = Arc::new(Mutex::new(FakeState::default()));
        let staging_root = tempfile::tempdir().unwrap();
        let port = FakePort {
            state: state.clone(),
            tx,
            on_open,
        };
        let staging = StagingDir::new(&staging_root.path().join("agent")).unwrap();
        let hub = Arc::new(HubCore::new(port, staging, timeouts(), json!({"pid": 1})));
        (hub, state, rx, staging_root)
    }

    fn hub() -> (
        Arc<HubCore<FakePort>>,
        Arc<Mutex<FakeState>>,
        Rx,
        tempfile::TempDir,
    ) {
        hub_with(Box::new(|_| {}))
    }

    fn attach(hub: &HubCore<FakePort>, label: &str, id: &str, path: Option<&Path>) {
        hub.attach(
            label,
            AttachRequest {
                doc_id: id.into(),
                file_name: format!("{id}.hwp"),
                source_path: path.map(|p| p.to_string_lossy().into_owned()),
                format: "hwp".into(),
                encrypted: false,
            },
        );
    }

    fn state_json(seq: u64) -> Value {
        json!({"schemaVersion":1,"format":"hwp","documentEpoch":1,"changeSeq":seq,"dirty":false,"pageCount":1,"documentSha256":"ab"})
    }

    /// 창 흉내: 받은 요청에 delay 뒤 응답한다. respond 가 None 이면 답하지 않는다.
    fn spawn_window(
        hub: Arc<HubCore<FakePort>>,
        mut rx: Rx,
        delay: Duration,
        respond: impl Fn(&str, &Value) -> Option<Result<Value, ApiError>> + Send + 'static,
    ) -> Arc<Mutex<Vec<Instant>>> {
        let done = Arc::new(Mutex::new(Vec::new()));
        let done2 = done.clone();
        tokio::spawn(async move {
            while let Some((label, payload)) = rx.recv().await {
                let id = payload["requestId"].as_str().unwrap().to_string();
                let method = payload["method"].as_str().unwrap().to_string();
                if let Some(result) = respond(&label, &payload) {
                    tokio::time::sleep(delay).await;
                    done2.lock().unwrap().push(Instant::now());
                    let (ok, err) = match result {
                        Ok(v) => (Some(v), None),
                        Err(e) => (None, Some(e)),
                    };
                    let _ = method;
                    hub.respond(&id, ok, err);
                }
            }
        });
        done
    }

    #[tokio::test]
    async fn call_emits_request_and_returns_response() {
        let (hub, state, rx, _t) = hub();
        attach(&hub, "w1", "d1", None);
        spawn_window(hub.clone(), rx, Duration::ZERO, |_, p| {
            Some(Ok(json!({"echo": p["params"]["section"]})))
        });
        let v = hub
            .call("d1", "paragraph", json!({"section": 3}))
            .await
            .unwrap();
        assert_eq!(v, json!({"echo": 3}));
        let emits = &state.lock().unwrap().emits;
        assert_eq!(emits[0].0, "w1");
        assert_eq!(emits[0].1["method"], "paragraph");
    }

    #[tokio::test]
    async fn requests_to_one_window_are_serialized() {
        let (hub, state, rx, _t) = hub();
        attach(&hub, "w1", "d1", None);
        let done = spawn_window(hub.clone(), rx, Duration::from_millis(60), |_, _| {
            Some(Ok(json!({})))
        });
        let (a, b) = tokio::join!(
            hub.call("d1", "text", json!({})),
            hub.call("d1", "text", json!({}))
        );
        a.unwrap();
        b.unwrap();
        let emits = state.lock().unwrap().emits.clone();
        let done = done.lock().unwrap().clone();
        assert_eq!(emits.len(), 2);
        assert!(
            emits[1].2 >= done[0],
            "두 번째 요청은 첫 응답 뒤에 나가야 한다"
        );
    }

    #[tokio::test]
    async fn unknown_doc_is_404() {
        let (hub, _s, _rx, _t) = hub();
        let err = hub.call("nope", "selection", json!({})).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::DocNotFound);
    }

    #[tokio::test]
    async fn open_dedupes_by_canonical_path() {
        let (hub, state, _rx, dir) = hub();
        let file = dir.path().join("a.hwp");
        std::fs::write(&file, b"x").unwrap();
        attach(&hub, "w1", "d1", Some(&file));
        let dotted = dir.path().join(".").join("a.hwp");
        assert_eq!(hub.open(dotted).await.unwrap().id, "d1");
        #[cfg(unix)]
        {
            let link = dir.path().join("link.hwp");
            std::os::unix::fs::symlink(&file, &link).unwrap();
            assert_eq!(hub.open(link).await.unwrap().id, "d1");
        }
        let s = state.lock().unwrap();
        assert!(s.opened.is_empty());
        assert!(s.focused_calls.contains(&"w1".to_string()));
    }

    #[tokio::test]
    async fn open_waits_for_attach_then_returns_summary() {
        let slot: Arc<Mutex<Option<Arc<HubCore<FakePort>>>>> = Arc::new(Mutex::new(None));
        let slot2 = slot.clone();
        let (hub, _s, _rx, dir) = hub_with(Box::new(move |path: &Path| {
            let hub = slot2.lock().unwrap().clone().unwrap();
            let path = path.to_path_buf();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(50)).await;
                attach(&hub, "w9", "d9", Some(&path));
            });
        }));
        *slot.lock().unwrap() = Some(hub.clone());
        let file = dir.path().join("b.hwp");
        std::fs::write(&file, b"x").unwrap();
        let summary = hub.open(file.clone()).await.unwrap();
        assert_eq!(summary.id, "d9");
        // 창에는 정규화한 경로를 넘긴다(macOS 임시 폴더는 /private/var/… 로 풀리고, Windows 는 \\?\ 접두사를 뗀다).
        let canonical = canonical(&file).unwrap();
        assert!(!canonical.to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(
            summary.path.as_deref(),
            Some(canonical.to_string_lossy().as_ref())
        );
    }

    #[tokio::test]
    async fn open_rejects_relative_and_unsupported_paths() {
        let (hub, _s, _rx, dir) = hub();
        assert_eq!(
            hub.open("a.hwp".into()).await.unwrap_err().code,
            ErrorCode::BadRequest
        );
        let txt = dir.path().join("a.txt");
        std::fs::write(&txt, b"x").unwrap();
        assert_eq!(hub.open(txt).await.unwrap_err().code, ErrorCode::BadRequest);
    }

    #[tokio::test]
    async fn list_docs_survives_one_unresponsive_window() {
        let (hub, _s, rx, _t) = hub();
        attach(&hub, "w1", "d1", None);
        attach(&hub, "w2", "d2", None);
        spawn_window(hub.clone(), rx, Duration::ZERO, |label, _| {
            (label == "w1").then(|| Ok(state_json(4)))
        });
        let docs = hub.list_docs().await.unwrap();
        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0].state.as_ref().unwrap().change_seq, 4);
        assert!(docs[1].state.is_none());
    }

    #[tokio::test]
    async fn replace_removes_staged_file_on_error() {
        let (hub, _s, rx, dir) = hub();
        attach(&hub, "w1", "d1", None);
        spawn_window(hub.clone(), rx, Duration::ZERO, |_, p| {
            assert!(Path::new(p["params"]["stagedPath"].as_str().unwrap()).exists());
            Some(Err(ApiError::new(ErrorCode::DocumentChanged, "바뀜")))
        });
        let src = dir.path().join("in.hwp");
        // HWP5 는 OLE 복합 문서 시그니처로 시작한다.
        std::fs::write(&src, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0]).unwrap();
        let expected = Expected {
            document_epoch: 1,
            change_seq: 0,
            document_sha256: "ab".into(),
        };
        let err = hub.replace("d1", src, expected).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::DocumentChanged);
        let left: Vec<_> = std::fs::read_dir(dir.path().join("agent"))
            .unwrap()
            .collect();
        assert!(left.is_empty());
    }

    #[tokio::test]
    async fn new_doc_marks_window_for_blank_document_and_waits_for_attach() {
        let (hub, _s, _rx, _t) = hub();
        let h2 = hub.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            // 새 창은 시작할 때 한 번 묻는다. 두 번째는 false.
            assert!(h2.take_new_document_request("blank"));
            assert!(!h2.take_new_document_request("blank"));
            attach(&h2, "blank", "dN", None);
        });
        assert!(!hub.take_new_document_request("other"));
        assert_eq!(hub.new_doc().await.unwrap().id, "dN");
    }

    #[tokio::test]
    async fn save_as_onto_existing_file_requires_force() {
        let (hub, state, rx, dir) = hub();
        let own = dir.path().join("a.hwp");
        let other = dir.path().join("other.hwp");
        std::fs::write(&own, b"x").unwrap();
        std::fs::write(&other, b"y").unwrap();
        attach(&hub, "w1", "d1", Some(&own));
        spawn_window(hub.clone(), rx, Duration::ZERO, |_, _| Some(Ok(json!({}))));
        let err = hub
            .call("d1", "save", json!({"path": other, "force": false}))
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::TargetExists);
        assert_eq!(err.code.http_status(), 409);
        assert!(state.lock().unwrap().emits.is_empty());
        hub.call("d1", "save", json!({"path": other, "force": true}))
            .await
            .unwrap();
        // 자기 파일로 저장하거나 새 파일로 저장하는 것은 그대로 간다.
        hub.call("d1", "save", json!({"path": own, "force": false}))
            .await
            .unwrap();
        hub.call(
            "d1",
            "save",
            json!({"path": dir.path().join("new.hwp"), "force": false}),
        )
        .await
        .unwrap();
        hub.call("d1", "save", json!({"force": false}))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn save_as_onto_file_open_in_another_window_is_refused_even_with_force() {
        let (hub, state, _rx, dir) = hub();
        let a = dir.path().join("a.hwp");
        let b = dir.path().join("b.hwp");
        std::fs::write(&a, b"x").unwrap();
        std::fs::write(&b, b"y").unwrap();
        attach(&hub, "w1", "d1", Some(&a));
        attach(&hub, "w2", "d2", Some(&b));
        let err = hub
            .call("d1", "save", json!({"path": b, "force": true}))
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::TargetExists);
        assert!(err.message.contains("다른 창"));
        assert!(state.lock().unwrap().emits.is_empty());
    }

    #[test]
    fn plain_path_strips_windows_verbatim_prefixes() {
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\C:\docs\a.hwp")),
            PathBuf::from(r"C:\docs\a.hwp")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\UNC\server\share\a.hwp")),
            PathBuf::from(r"\\server\share\a.hwp")
        );
        assert_eq!(
            plain_path(PathBuf::from("/private/var/a.hwp")),
            PathBuf::from("/private/var/a.hwp")
        );
    }

    #[tokio::test]
    async fn window_destroy_fails_pending_requests() {
        let (hub, _s, mut rx, _t) = hub();
        attach(&hub, "w1", "d1", None);
        let h2 = hub.clone();
        tokio::spawn(async move {
            let _ = rx.recv().await;
            h2.window_destroyed("w1");
        });
        let started = Instant::now();
        let err = hub.call("d1", "selection", json!({})).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::DocNotFound);
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(
            hub.call("d1", "selection", json!({}))
                .await
                .unwrap_err()
                .code,
            ErrorCode::DocNotFound
        );
    }
}
