//! 앱이 시작할 때 쓰는 `install.json`(번들 안 CLI·rhwp·skill 위치). 앱이 꺼져 있어도 읽힌다.

use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    pub app_version: String,
    pub rhwp_version: String,
    pub app_exe: PathBuf,
    #[serde(default)]
    pub cli_exe: Option<PathBuf>,
    #[serde(default)]
    pub rhwp_exe: Option<PathBuf>,
    #[serde(default)]
    pub skill_dir: Option<PathBuf>,
}

/// `HWPLY_INSTALL_FILE` → 앱 데이터 폴더의 `install.json`.
pub fn install_file_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HWPLY_INSTALL_FILE") {
        return Some(PathBuf::from(path));
    }
    crate::client::app_data_dir().map(|dir| dir.join("install.json"))
}

/// 없거나 깨졌으면 `None`(앱을 한 번도 안 켰거나 개발 빌드).
pub fn load() -> Option<InstallInfo> {
    install_file_path().and_then(|path| load_from(&path))
}

pub fn load_from(path: &Path) -> Option<InstallInfo> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_from_missing_or_broken_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_from(&dir.path().join("install.json")).is_none());
        std::fs::write(dir.path().join("install.json"), b"{not json").unwrap();
        assert!(load_from(&dir.path().join("install.json")).is_none());
    }

    #[test]
    fn load_from_reads_optional_fields() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("install.json");
        std::fs::write(
            &file,
            br#"{"appVersion":"0.1.0","rhwpVersion":"v0.8.7","appExe":"/A/hwply.app/Contents/MacOS/hwply","rhwpExe":"/A/hwply.app/Contents/MacOS/rhwp"}"#,
        )
        .unwrap();
        let info = load_from(&file).unwrap();
        assert_eq!(info.app_version, "0.1.0");
        assert_eq!(info.rhwp_version, "v0.8.7");
        assert_eq!(info.cli_exe, None);
        assert_eq!(
            info.rhwp_exe,
            Some(PathBuf::from("/A/hwply.app/Contents/MacOS/rhwp"))
        );
        assert_eq!(info.skill_dir, None);
    }
}
