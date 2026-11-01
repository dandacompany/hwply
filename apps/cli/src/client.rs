use crate::exit::CliError;
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

pub const STATE_HEADER: &str = "hwply-document-state";
const APP_IDENTIFIER: &str = "com.dante-labs.hwply";

/// 앱이 쓰는 `agent.json`(스펙 §8.1).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub port: u16,
    pub token: String,
}

pub fn agent_file_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HWPLY_AGENT_FILE") {
        return Some(PathBuf::from(path));
    }
    app_data_dir().map(|dir| dir.join("agent.json"))
}

pub(crate) fn app_data_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library/Application Support")
                .join(APP_IDENTIFIER)
        })
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join(APP_IDENTIFIER))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
            .map(|dir| dir.join(APP_IDENTIFIER))
    }
}

/// CLI 임시 파일 폴더(앱 캐시 아래 `cli/`). 테스트는 `HWPLY_TMP` 로 바꾼다.
pub fn cli_temp_root() -> PathBuf {
    if let Some(dir) = std::env::var_os("HWPLY_TMP") {
        return PathBuf::from(dir);
    }
    let cache = if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Caches"))
    } else if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
    };
    cache
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_IDENTIFIER)
        .join("cli")
}

pub struct Connection {
    base: String,
    token: String,
    agent: ureq::Agent,
}

pub struct Bytes {
    pub bytes: Vec<u8>,
    pub state: Value,
}

fn not_running() -> CliError {
    CliError::NotRunning(
        "hwply 앱이 실행 중이 아닙니다. 앱을 띄우거나 `hwply open <파일>` 을 쓰세요.".into(),
    )
}

impl Connection {
    pub fn discover() -> Result<Connection, CliError> {
        let path = agent_file_path().ok_or_else(not_running)?;
        let text = std::fs::read_to_string(&path).map_err(|_| not_running())?;
        let info: AgentInfo = serde_json::from_str(&text)
            .map_err(|e| CliError::NotRunning(format!("agent.json 을 읽을 수 없습니다: {e}")))?;
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(2))
            .timeout_read(Duration::from_secs(180))
            .build();
        Ok(Connection {
            base: format!("http://127.0.0.1:{}", info.port),
            token: info.token,
            agent,
        })
    }

    fn request(&self, method: &str, path: &str) -> ureq::Request {
        self.agent
            .request(method, &format!("{}{}", self.base, path))
            .set("Authorization", &format!("Bearer {}", self.token))
    }

    pub fn get_json(&self, path: &str) -> Result<Value, CliError> {
        read_json(self.request("GET", path).call())
    }

    pub fn post_json(&self, path: &str, body: &Value) -> Result<Value, CliError> {
        read_json(self.request("POST", path).send_json(body.clone()))
    }

    pub fn get_bytes(&self, path: &str) -> Result<Bytes, CliError> {
        let response = self.request("GET", path).call().map_err(map_error)?;
        let state = response
            .header(STATE_HEADER)
            .and_then(|h| serde_json::from_str(h).ok())
            .unwrap_or(Value::Null);
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut response.into_reader(), &mut bytes)
            .map_err(|e| CliError::Other(format!("응답을 읽지 못했습니다: {e}")))?;
        Ok(Bytes { bytes, state })
    }
}

fn read_json(result: Result<ureq::Response, ureq::Error>) -> Result<Value, CliError> {
    let response = result.map_err(map_error)?;
    response
        .into_json()
        .map_err(|e| CliError::Other(format!("응답 JSON 을 읽지 못했습니다: {e}")))
}

fn map_error(error: ureq::Error) -> CliError {
    match error {
        ureq::Error::Status(status, response) => {
            let body: Value = response.into_json().unwrap_or(Value::Null);
            CliError::Bridge {
                status,
                code: body["code"].as_str().unwrap_or("HTTP_ERROR").to_string(),
                message: body["message"]
                    .as_str()
                    .unwrap_or("브리지가 오류를 돌려줬습니다")
                    .to_string(),
                state: body.get("state").cloned(),
            }
        }
        ureq::Error::Transport(_) => not_running(),
    }
}
