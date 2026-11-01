//! `install.json`: 앱이 시작할 때마다 자기 설치 위치(번들 안 CLI·rhwp·skill)를 적는다.
//! 앱이 꺼져 있어도 `hwply` CLI·`hwply setup` 이 번들 파일을 찾는 근거다.

use serde::Serialize;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub(crate) const INSTALL_FILE_NAME: &str = "install.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallRecord {
    pub app_version: String,
    pub rhwp_version: String,
    pub app_exe: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_exe: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rhwp_exe: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_dir: Option<PathBuf>,
}

fn sidecar(dir: &Path, name: &str) -> Option<PathBuf> {
    let file = dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
    file.is_file().then_some(file)
}

/// dmg 안에서 바로 실행한 앱(App Translocation)의 임시 경로. 곧 사라지므로 기록하지 않는다.
pub(crate) fn is_translocated(exe: &Path) -> bool {
    exe.to_string_lossy().contains("/AppTranslocation/")
}

/// 사이드카는 앱 실행 파일 옆(`hwply-cli`·`rhwp`), skill 은 리소스 폴더의 `skill/hwply`. 없는 것은 비운다.
pub(crate) fn collect(
    current_exe: &Path,
    resource_dir: &Path,
    app_version: &str,
    rhwp_version: &str,
) -> InstallRecord {
    let exe_dir = current_exe.parent().unwrap_or(Path::new("."));
    let skill = resource_dir.join("skill").join("hwply");
    InstallRecord {
        app_version: app_version.to_string(),
        rhwp_version: rhwp_version.to_string(),
        app_exe: current_exe.to_path_buf(),
        cli_exe: sidecar(exe_dir, "hwply-cli"),
        rhwp_exe: sidecar(exe_dir, "rhwp"),
        skill_dir: skill.join("SKILL.md").is_file().then_some(skill),
    }
}

/// 임시 파일에 쓰고 rename 한다. 읽는 쪽(CLI)이 반쯤 쓴 파일을 보지 않게.
pub(crate) fn write(dir: &Path, record: &InstallRecord) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let staged = dir.join(format!(
        "{INSTALL_FILE_NAME}.{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let bytes = serde_json::to_vec_pretty(record).map_err(io::Error::other)?;
    let result = std::fs::File::create(&staged)
        .and_then(|mut file| file.write_all(&bytes).and_then(|_| file.sync_all()))
        .and_then(|_| std::fs::rename(&staged, dir.join(INSTALL_FILE_NAME)));
    if result.is_err() {
        let _ = std::fs::remove_file(&staged);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exe(name: &str) -> String {
        if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_string()
        }
    }

    #[test]
    fn collect_records_present_sidecars_only() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join(exe("hwply"));
        std::fs::write(&app, b"").unwrap();
        std::fs::write(dir.path().join(exe("hwply-cli")), b"").unwrap();
        let record = collect(&app, dir.path(), "0.1.0", "v0.8.7");
        assert_eq!(record.app_exe, app);
        assert_eq!(record.cli_exe, Some(dir.path().join(exe("hwply-cli"))));
        assert_eq!(record.rhwp_exe, None);
        assert_eq!(record.app_version, "0.1.0");
        assert_eq!(record.rhwp_version, "v0.8.7");
    }

    #[test]
    fn collect_omits_missing_skill() {
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().join("res");
        let app = dir.path().join(exe("hwply"));
        assert_eq!(collect(&app, &resources, "0.1.0", "v0.8.7").skill_dir, None);
        let skill = resources.join("skill").join("hwply");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), b"---").unwrap();
        assert_eq!(
            collect(&app, &resources, "0.1.0", "v0.8.7").skill_dir,
            Some(skill)
        );
    }

    #[test]
    fn translocated_app_is_not_recorded() {
        assert!(is_translocated(Path::new(
            "/private/var/folders/x/AppTranslocation/ABC/d/hwply.app/Contents/MacOS/hwply"
        )));
        assert!(!is_translocated(Path::new(
            "/Applications/hwply.app/Contents/MacOS/hwply"
        )));
    }

    #[test]
    fn write_is_atomic_and_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let record = InstallRecord {
            app_version: "0.1.0".into(),
            rhwp_version: "v0.8.7".into(),
            app_exe: PathBuf::from("/Applications/hwply.app/Contents/MacOS/hwply"),
            cli_exe: None,
            rhwp_exe: Some(PathBuf::from("/x/rhwp")),
            skill_dir: None,
        };
        write(dir.path(), &record).unwrap();
        write(dir.path(), &record).unwrap();
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(INSTALL_FILE_NAME)]);
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join(INSTALL_FILE_NAME)).unwrap())
                .unwrap();
        assert_eq!(json["appVersion"], "0.1.0");
        assert_eq!(json["rhwpExe"], "/x/rhwp");
        assert!(json.get("cliExe").is_none());
        assert!(json.get("skillDir").is_none());
    }
}
