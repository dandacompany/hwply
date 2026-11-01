use crate::agent::protocol::{ApiError, DocumentState, Expected};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

/// `GET /v1/docs` 의 한 줄(스펙 §8.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSummary {
    pub id: String,
    pub path: Option<String>,
    pub title: String,
    pub format: String,
    pub dirty: bool,
    pub encrypted: bool,
    pub window_label: String,
    pub focused: bool,
    pub active: bool,
    pub state: Option<DocumentState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Hwp,
    Hwpx,
    Hml,
}

impl ExportFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            ExportFormat::Hwp => "hwp",
            ExportFormat::Hwpx => "hwpx",
            ExportFormat::Hml => "hml",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExportedBytes {
    pub bytes: Vec<u8>,
    pub state: DocumentState,
}

/// 라우터가 부르는 쪽. 앱에서는 창으로 요청을 보내는 구현, 테스트에서는 가짜.
// async-trait 가 만든 함수에 clippy::double_must_use 오탐이 난다.
#[allow(clippy::double_must_use)]
#[async_trait::async_trait]
pub trait AgentBackend: Send + Sync + 'static {
    /// `{"appVersion","rhwpVersion","pid"}`
    fn health(&self) -> Value;
    async fn list_docs(&self) -> Result<Vec<DocSummary>, ApiError>;
    async fn open(&self, path: PathBuf) -> Result<DocSummary, ApiError>;
    async fn new_doc(&self) -> Result<DocSummary, ApiError>;
    async fn doc(&self, id: &str) -> Result<DocSummary, ApiError>;
    async fn export(&self, id: &str, format: ExportFormat) -> Result<ExportedBytes, ApiError>;
    /// selection·paragraph·text·save·focus·snapshots·restore
    async fn call(&self, id: &str, method: &str, params: Value) -> Result<Value, ApiError>;
    async fn replace(&self, id: &str, path: PathBuf, expected: Expected)
        -> Result<Value, ApiError>;
}
