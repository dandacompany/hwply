use serde::Serialize;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub const DISCOVERY_FILE_NAME: &str = "agent.json";

/// CLI 가 브리지를 찾는 정보(스펙 §8.1).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryInfo {
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub app_version: String,
    pub rhwp_version: String,
}

/// 쓴 `agent.json`. 놓으면(앱 종료) 지운다.
#[derive(Debug)]
pub struct DiscoveryFile {
    path: PathBuf,
}

impl DiscoveryFile {
    pub fn write(dir: &Path, info: &DiscoveryInfo) -> io::Result<DiscoveryFile> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(DISCOVERY_FILE_NAME);
        let staged = dir.join(format!(
            "{}.{}.tmp",
            DISCOVERY_FILE_NAME,
            uuid::Uuid::new_v4().simple()
        ));
        let bytes = serde_json::to_vec(info).map_err(io::Error::other)?;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = options
            .open(&staged)
            .and_then(|mut file| file.write_all(&bytes).and_then(|_| file.sync_all()))
            .and_then(|_| std::fs::rename(&staged, &path));
        if result.is_err() {
            let _ = std::fs::remove_file(&staged);
        }
        result.map(|_| DiscoveryFile { path })
    }
}

impl Drop for DiscoveryFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// 32바이트 OS 난수의 hex.
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("OS 난수를 얻을 수 없습니다");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_file_is_private_and_removed_on_drop() {
        let dir = tempfile::tempdir().unwrap();
        let info = DiscoveryInfo {
            port: 4321,
            token: "t".into(),
            pid: 7,
            app_version: "0.1.0".into(),
            rhwp_version: "v0.8.7".into(),
        };
        let file = DiscoveryFile::write(dir.path(), &info).unwrap();
        let path = dir.path().join("agent.json");
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        for key in ["port", "token", "pid", "appVersion", "rhwpVersion"] {
            assert!(v.get(key).is_some(), "{key}");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        drop(file);
        assert!(!path.exists());
    }

    #[test]
    fn token_is_64_hex_and_unique() {
        let a = new_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, new_token());
    }
}
