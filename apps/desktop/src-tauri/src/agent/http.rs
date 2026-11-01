use crate::agent::backend::{AgentBackend, ExportFormat};
use crate::agent::protocol::{ApiError, ErrorCode, Expected};
use axum::extract::rejection::JsonRejection;
use axum::extract::{DefaultBodyLimit, FromRequest, Path, Query, Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

/// 요청 본문 한도. 문서 바이트는 본문이 아니라 경로로 오간다.
pub const BODY_LIMIT_BYTES: usize = 1024 * 1024;
pub const STATE_HEADER: &str = "hwply-document-state";

type Backend = Arc<dyn AgentBackend>;

#[derive(Clone)]
struct AppState {
    backend: Backend,
    token: Arc<String>,
}

/// 루프백 브리지 라우터(스펙 §8.3). CORS 레이어는 일부러 붙이지 않는다.
pub fn router(backend: Backend, token: String) -> Router {
    let state = AppState {
        backend,
        token: Arc::new(token),
    };
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/docs", get(list_docs))
        .route("/v1/docs/open", post(open))
        .route("/v1/docs/new", post(new_doc))
        .route("/v1/docs/{id}", get(doc))
        .route("/v1/docs/{id}/export", get(export))
        .route("/v1/docs/{id}/selection", get(selection))
        .route(
            "/v1/docs/{id}/paragraphs/{section}/{paragraph}",
            get(paragraph),
        )
        .route("/v1/docs/{id}/text", post(text))
        .route("/v1/docs/{id}/replace", post(replace))
        .route("/v1/docs/{id}/save", post(save))
        .route("/v1/docs/{id}/focus", post(focus))
        .route("/v1/docs/{id}/snapshots", get(snapshots))
        .route("/v1/docs/{id}/snapshots/{n}/restore", post(restore))
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
        .layer(middleware::from_fn_with_state(state.clone(), require_token))
        .with_state(state)
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.code.http_status())
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (status, Json(self)).into_response()
    }
}

async fn require_token(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let presented = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match presented {
        Some(token) if constant_time_eq(token.as_bytes(), state.token.as_bytes()) => {
            next.run(request).await
        }
        _ => ApiError::new(ErrorCode::Unauthorized, "토큰이 없거나 맞지 않습니다").into_response(),
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// JSON 본문 추출기. 거절을 `{code,message}` 로 바꾼다(한도 초과는 413 유지).
struct JsonBody<T>(T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for JsonBody<T> {
    type Rejection = Response;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(req, state).await {
            Ok(Json(value)) => Ok(JsonBody(value)),
            Err(rejection) => Err(json_rejection(rejection)),
        }
    }
}

fn json_rejection(rejection: JsonRejection) -> Response {
    let status = rejection.status();
    let error = ApiError::new(ErrorCode::BadRequest, rejection.body_text());
    if status == StatusCode::PAYLOAD_TOO_LARGE {
        return (status, Json(error)).into_response();
    }
    error.into_response()
}

fn bad_request(message: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::BadRequest, message)
}

type ApiResult = Result<Response, ApiError>;

fn ok_json(value: impl serde::Serialize) -> ApiResult {
    Ok(Json(value).into_response())
}

async fn health(State(s): State<AppState>) -> ApiResult {
    ok_json(s.backend.health())
}

async fn list_docs(State(s): State<AppState>) -> ApiResult {
    ok_json(json!({ "docs": s.backend.list_docs().await? }))
}

#[derive(Deserialize)]
struct OpenBody {
    path: PathBuf,
}

async fn open(State(s): State<AppState>, JsonBody(body): JsonBody<OpenBody>) -> ApiResult {
    ok_json(s.backend.open(body.path).await?)
}

async fn new_doc(State(s): State<AppState>) -> ApiResult {
    ok_json(s.backend.new_doc().await?)
}

async fn doc(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult {
    ok_json(s.backend.doc(&id).await?)
}

async fn export(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<Value>,
) -> ApiResult {
    let format: ExportFormat = query
        .get("format")
        .cloned()
        .map(serde_json::from_value)
        .unwrap_or(Ok(ExportFormat::Hwp))
        .map_err(|_| bad_request("format 은 hwp, hwpx, hml 중 하나여야 합니다"))?;
    let exported = s.backend.export(&id, format).await?;
    let state_json = serde_json::to_string(&exported.state)
        .map_err(|e| ApiError::new(ErrorCode::InternalError, e.to_string()))?;
    let state_header = HeaderValue::from_str(&state_json)
        .map_err(|e| ApiError::new(ErrorCode::InternalError, e.to_string()))?;
    let mut response = exported.bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(STATE_HEADER, state_header);
    Ok(response)
}

async fn selection(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult {
    ok_json(s.backend.call(&id, "selection", json!({})).await?)
}

async fn paragraph(
    State(s): State<AppState>,
    Path((id, section, paragraph)): Path<(String, u32, u32)>,
) -> ApiResult {
    let params = json!({ "section": section, "paragraph": paragraph });
    ok_json(s.backend.call(&id, "paragraph", params).await?)
}

async fn text(
    State(s): State<AppState>,
    Path(id): Path<String>,
    JsonBody(body): JsonBody<Value>,
) -> ApiResult {
    ok_json(s.backend.call(&id, "text", body).await?)
}

#[derive(Deserialize)]
struct ReplaceBody {
    path: PathBuf,
    expected: Expected,
}

async fn replace(
    State(s): State<AppState>,
    Path(id): Path<String>,
    JsonBody(body): JsonBody<ReplaceBody>,
) -> ApiResult {
    ok_json(s.backend.replace(&id, body.path, body.expected).await?)
}

async fn save(
    State(s): State<AppState>,
    Path(id): Path<String>,
    JsonBody(body): JsonBody<Value>,
) -> ApiResult {
    ok_json(s.backend.call(&id, "save", body).await?)
}

async fn focus(
    State(s): State<AppState>,
    Path(id): Path<String>,
    JsonBody(body): JsonBody<Value>,
) -> ApiResult {
    ok_json(s.backend.call(&id, "focus", body).await?)
}

async fn snapshots(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult {
    ok_json(s.backend.call(&id, "snapshots", json!({})).await?)
}

#[derive(Deserialize)]
struct RestoreBody {
    expected: Option<Expected>,
}

async fn restore(
    State(s): State<AppState>,
    Path((id, n)): Path<(String, u32)>,
    body: axum::body::Bytes,
) -> ApiResult {
    // 본문 없이 불러도 된다(사람·스크립트의 단순 복원).
    let expected = if body.is_empty() {
        None
    } else {
        serde_json::from_slice::<RestoreBody>(&body)
            .map_err(|e| bad_request(e.to_string()))?
            .expected
    };
    ok_json(
        s.backend
            .call(&id, "restore", json!({ "n": n, "expected": expected }))
            .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::backend::{AgentBackend, DocSummary, ExportFormat, ExportedBytes};
    use crate::agent::protocol::{ApiError, DocumentState, ErrorCode, Expected};
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use tower::ServiceExt;

    const TOKEN: &str = "secret-token";

    fn state(change_seq: u64) -> DocumentState {
        DocumentState {
            schema_version: 1,
            format: "hwp".into(),
            document_epoch: 1,
            change_seq,
            dirty: false,
            page_count: 1,
            document_sha256: "ab".into(),
        }
    }

    #[derive(Default)]
    struct Fake {
        calls: Mutex<Vec<(String, Value)>>,
        fail_with: Mutex<Option<ApiError>>,
    }

    impl Fake {
        fn record(&self, name: &str, v: Value) -> Result<(), ApiError> {
            self.calls.lock().unwrap().push((name.into(), v));
            match self.fail_with.lock().unwrap().clone() {
                Some(e) => Err(e),
                None => Ok(()),
            }
        }
        fn calls(&self) -> Vec<(String, Value)> {
            self.calls.lock().unwrap().clone()
        }
    }

    fn summary() -> DocSummary {
        DocSummary {
            id: "d1".into(),
            path: None,
            title: "a.hwp".into(),
            format: "hwp".into(),
            dirty: false,
            encrypted: false,
            window_label: "main".into(),
            focused: true,
            active: true,
            state: Some(state(0)),
        }
    }

    #[async_trait::async_trait]
    impl AgentBackend for Fake {
        fn health(&self) -> Value {
            json!({"appVersion":"0.1.0","rhwpVersion":"v0.8.7","pid":1})
        }
        async fn list_docs(&self) -> Result<Vec<DocSummary>, ApiError> {
            self.record("list", json!({}))?;
            Ok(vec![summary()])
        }
        async fn open(&self, path: PathBuf) -> Result<DocSummary, ApiError> {
            self.record("open", json!(path))?;
            Ok(summary())
        }
        async fn new_doc(&self) -> Result<DocSummary, ApiError> {
            self.record("new", json!({}))?;
            Ok(summary())
        }
        async fn doc(&self, id: &str) -> Result<DocSummary, ApiError> {
            self.record("doc", json!(id))?;
            Ok(summary())
        }
        async fn export(&self, id: &str, f: ExportFormat) -> Result<ExportedBytes, ApiError> {
            self.record("export", json!([id, f.as_str()]))?;
            Ok(ExportedBytes {
                bytes: b"HWP!".to_vec(),
                state: state(7),
            })
        }
        async fn call(&self, id: &str, method: &str, params: Value) -> Result<Value, ApiError> {
            self.record(method, json!({"id": id, "params": params}))?;
            Ok(json!({"ok": true}))
        }
        async fn replace(&self, id: &str, path: PathBuf, e: Expected) -> Result<Value, ApiError> {
            self.record("replace", json!({"id": id, "path": path, "expected": e}))?;
            Ok(json!({"state": state(0)}))
        }
    }

    fn app(fake: Arc<Fake>) -> axum::Router {
        router(fake, TOKEN.to_string())
    }

    fn req(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
        let b = Request::builder()
            .method(method)
            .uri(uri)
            .header("authorization", format!("Bearer {TOKEN}"));
        match body {
            Some(v) => b
                .header("content-type", "application/json")
                .body(Body::from(v.to_string()))
                .unwrap(),
            None => b.body(Body::empty()).unwrap(),
        }
    }

    async fn json_body(res: axum::response::Response) -> Value {
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn rejects_missing_or_wrong_token_with_401() {
        let fake = Arc::new(Fake::default());
        let none = Request::get("/v1/docs").body(Body::empty()).unwrap();
        let res = app(fake.clone()).oneshot(none).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(json_body(res).await["code"], "UNAUTHORIZED");
        let wrong = Request::get("/v1/docs")
            .header("authorization", "Bearer x")
            .body(Body::empty())
            .unwrap();
        let res = app(fake.clone()).oneshot(wrong).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        assert!(fake.calls().is_empty());
    }

    #[tokio::test]
    async fn health_returns_versions_with_valid_token() {
        let res = app(Arc::new(Fake::default()))
            .oneshot(req("GET", "/v1/health", None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(json_body(res).await["rhwpVersion"], "v0.8.7");
    }

    #[tokio::test]
    async fn export_streams_bytes_with_state_header() {
        let res = app(Arc::new(Fake::default()))
            .oneshot(req("GET", "/v1/docs/d1/export?format=hwp", None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()["content-type"], "application/octet-stream");
        let header: Value =
            serde_json::from_str(res.headers()["hwply-document-state"].to_str().unwrap()).unwrap();
        assert_eq!(header["changeSeq"], 7);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&bytes[..], b"HWP!");
    }

    #[tokio::test]
    async fn export_rejects_unknown_format_with_400() {
        let res = app(Arc::new(Fake::default()))
            .oneshot(req("GET", "/v1/docs/d1/export?format=pdf", None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert_eq!(json_body(res).await["code"], "BAD_REQUEST");
    }

    #[tokio::test]
    async fn backend_error_maps_to_status_and_body() {
        let fake = Arc::new(Fake::default());
        let mut err = ApiError::new(ErrorCode::DocumentChanged, "바뀜");
        err.state = Some(serde_json::to_value(state(3)).unwrap());
        *fake.fail_with.lock().unwrap() = Some(err);
        let res = app(fake)
            .oneshot(req("GET", "/v1/docs/d1/selection", None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::CONFLICT);
        let body = json_body(res).await;
        assert_eq!(body["code"], "DOCUMENT_CHANGED");
        assert_eq!(body["state"]["changeSeq"], 3);
    }

    #[tokio::test]
    async fn oversized_body_is_rejected() {
        let fake = Arc::new(Fake::default());
        let big = "x".repeat(1024 * 1024 + 1);
        let res = app(fake.clone())
            .oneshot(req(
                "POST",
                "/v1/docs/d1/text",
                Some(json!({ "replacement": big })),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert!(fake.calls().is_empty());
    }

    #[tokio::test]
    async fn no_cors_headers_and_options_not_allowed() {
        let mut r = req("GET", "/v1/docs", None);
        r.headers_mut()
            .insert("origin", "https://evil.example".parse().unwrap());
        let res = app(Arc::new(Fake::default())).oneshot(r).await.unwrap();
        assert!(res
            .headers()
            .keys()
            .all(|k| !k.as_str().starts_with("access-control-")));
        let res = app(Arc::new(Fake::default()))
            .oneshot(req("OPTIONS", "/v1/docs", None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn paragraph_route_passes_coordinates() {
        let fake = Arc::new(Fake::default());
        let res = app(fake.clone())
            .oneshot(req("GET", "/v1/docs/d1/paragraphs/0/12", None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            fake.calls(),
            vec![(
                "paragraph".to_string(),
                json!({"id":"d1","params":{"section":0,"paragraph":12}})
            )]
        );
    }

    #[tokio::test]
    async fn replace_requires_expected() {
        let fake = Arc::new(Fake::default());
        let res = app(fake.clone())
            .oneshot(req(
                "POST",
                "/v1/docs/d1/replace",
                Some(json!({"path":"/tmp/a.hwp"})),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        assert!(fake.calls().is_empty());
        let body = json!({"path":"/tmp/a.hwp","expected":{"documentEpoch":1,"changeSeq":2,"documentSha256":"ab"}});
        let res = app(fake.clone())
            .oneshot(req("POST", "/v1/docs/d1/replace", Some(body)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(fake.calls()[0].0, "replace");
    }
}
