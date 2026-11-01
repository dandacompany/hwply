use serde_json::Value;
use std::fmt;

/// CLI 오류와 종료 코드(스펙 §9): 0 성공 · 2 인자 · 3 문서 상태 충돌 · 4 앱 연결 불가 · 5 rhwp 실패 · 그 밖 1.
#[derive(Debug)]
pub enum CliError {
    Usage(String),
    NotRunning(String),
    Bridge {
        status: u16,
        code: String,
        message: String,
        state: Option<Value>,
    },
    Rhwp(String),
    Other(String),
}

impl CliError {
    pub fn usage(message: impl Into<String>) -> Self {
        CliError::Usage(message.into())
    }

    pub fn code(&self) -> &str {
        match self {
            CliError::Usage(_) => "USAGE",
            CliError::NotRunning(_) => "APP_NOT_RUNNING",
            CliError::Bridge { code, .. } => code,
            CliError::Rhwp(_) => "RHWP_FAILED",
            CliError::Other(_) => "ERROR",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            CliError::Usage(m)
            | CliError::NotRunning(m)
            | CliError::Rhwp(m)
            | CliError::Other(m) => m,
            CliError::Bridge { message, .. } => message,
        }
    }

    pub fn exit_code(&self) -> i32 {
        match self {
            CliError::Usage(_) => 2,
            CliError::NotRunning(_) => 4,
            CliError::Rhwp(_) => 5,
            CliError::Other(_) => 1,
            CliError::Bridge { status, code, .. } => match code.as_str() {
                "RHWP_FAILED" => 5,
                "DOCUMENT_CHANGED" | "FILE_CHANGED_ON_DISK" => 3,
                _ if *status == 409 => 3,
                _ => 1,
            },
        }
    }

    pub fn to_json(&self) -> Value {
        let mut v = serde_json::json!({ "code": self.code(), "message": self.message() });
        if let CliError::Bridge {
            state: Some(state), ..
        } = self
        {
            v["state"] = state.clone();
        }
        v
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "오류 [{}]: {}", self.code(), self.message())
    }
}
