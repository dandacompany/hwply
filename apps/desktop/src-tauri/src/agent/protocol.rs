use serde::{Deserialize, Serialize, Serializer};

/// 브리지 오류 코드(스펙 §8.6). 상류 `DocumentAgentErrorCode` 는 `Upstream` 으로 그대로 통과시킨다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorCode {
    DocumentChanged,
    FileChangedOnDisk,
    DocumentEncrypted,
    DocNotFound,
    AppBusy,
    RhwpFailed,
    Unauthorized,
    BadRequest,
    SavePathRequired,
    SnapshotNotFound,
    TargetExists,
    InternalError,
    Upstream(String),
}

const BRIDGE_CODES: &[(ErrorCode, &str, u16)] = &[
    (ErrorCode::DocumentChanged, "DOCUMENT_CHANGED", 409),
    (ErrorCode::FileChangedOnDisk, "FILE_CHANGED_ON_DISK", 409),
    (ErrorCode::DocumentEncrypted, "DOCUMENT_ENCRYPTED", 423),
    (ErrorCode::DocNotFound, "DOC_NOT_FOUND", 404),
    (ErrorCode::AppBusy, "APP_BUSY", 503),
    (ErrorCode::RhwpFailed, "RHWP_FAILED", 502),
    (ErrorCode::Unauthorized, "UNAUTHORIZED", 401),
    (ErrorCode::BadRequest, "BAD_REQUEST", 400),
    (ErrorCode::SavePathRequired, "SAVE_PATH_REQUIRED", 400),
    (ErrorCode::SnapshotNotFound, "SNAPSHOT_NOT_FOUND", 404),
    (ErrorCode::TargetExists, "TARGET_EXISTS", 409),
    (ErrorCode::InternalError, "INTERNAL_ERROR", 500),
];

/// 상류 코드 중 "다시 읽고 다시 보내라" 에 해당하는 것.
const UPSTREAM_CONFLICTS: &[&str] = &[
    "COMMAND_NOT_LATEST",
    "PAGE_COUNT_CHANGED",
    "NON_TARGET_CHANGED",
];

impl ErrorCode {
    pub fn from_wire(code: &str) -> ErrorCode {
        BRIDGE_CODES
            .iter()
            .find(|(_, wire, _)| *wire == code)
            .map(|(variant, _, _)| variant.clone())
            .unwrap_or_else(|| ErrorCode::Upstream(code.to_string()))
    }

    pub fn as_str(&self) -> &str {
        match self {
            ErrorCode::Upstream(code) => code,
            known => BRIDGE_CODES
                .iter()
                .find(|(variant, _, _)| variant == known)
                .map(|(_, wire, _)| *wire)
                .unwrap_or("INTERNAL_ERROR"),
        }
    }

    pub fn http_status(&self) -> u16 {
        match self {
            ErrorCode::Upstream(code) if code.ends_with("_MISMATCH") => 409,
            ErrorCode::Upstream(code) if UPSTREAM_CONFLICTS.contains(&code.as_str()) => 409,
            ErrorCode::Upstream(code) if code == "TARGET_NOT_FOUND" => 404,
            ErrorCode::Upstream(_) => 422,
            known => BRIDGE_CODES
                .iter()
                .find(|(variant, _, _)| variant == known)
                .map(|(_, _, status)| *status)
                .unwrap_or(500),
        }
    }
}

impl Serialize for ErrorCode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ErrorCode {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(ErrorCode::from_wire(&String::deserialize(deserializer)?))
    }
}

/// 상류 `RhwpDocumentStateV1` 그대로.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentState {
    pub schema_version: u32,
    pub format: String,
    pub document_epoch: u64,
    pub change_seq: u64,
    pub dirty: bool,
    pub page_count: u32,
    pub document_sha256: String,
}

/// 쓰기 요청의 사전조건(스펙 §8.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Expected {
    pub document_epoch: u64,
    pub change_seq: u64,
    pub document_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<serde_json::Value>,
}

impl ApiError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            state: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_codes_map_to_spec_statuses() {
        assert_eq!(ErrorCode::DocumentChanged.http_status(), 409);
        assert_eq!(ErrorCode::FileChangedOnDisk.http_status(), 409);
        assert_eq!(ErrorCode::DocumentEncrypted.http_status(), 423);
        assert_eq!(ErrorCode::DocNotFound.http_status(), 404);
        assert_eq!(ErrorCode::AppBusy.http_status(), 503);
        assert_eq!(ErrorCode::RhwpFailed.http_status(), 502);
        assert_eq!(ErrorCode::Unauthorized.http_status(), 401);
        assert_eq!(ErrorCode::SavePathRequired.http_status(), 400);
        assert_eq!(ErrorCode::InternalError.http_status(), 500);
    }

    #[test]
    fn upstream_codes_pass_through_with_mapped_status() {
        assert_eq!(
            ErrorCode::from_wire("CHANGE_SEQ_MISMATCH").http_status(),
            409
        );
        assert_eq!(ErrorCode::from_wire("TARGET_NOT_FOUND").http_status(), 404);
        assert_eq!(
            ErrorCode::from_wire("TARGET_FORMAT_MISMATCH").http_status(),
            409
        );
        assert_eq!(ErrorCode::from_wire("RENDER_FAILED").http_status(), 422);
        assert_eq!(
            ErrorCode::from_wire("RENDER_FAILED").as_str(),
            "RENDER_FAILED"
        );
        assert_eq!(
            ErrorCode::from_wire("DOCUMENT_ENCRYPTED"),
            ErrorCode::DocumentEncrypted
        );
    }

    #[test]
    fn api_error_serializes_without_state_when_absent() {
        let v = serde_json::to_value(ApiError::new(ErrorCode::DocNotFound, "없음")).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"code":"DOC_NOT_FOUND","message":"없음"})
        );
    }
}
