use crate::client::Connection;
use crate::exit::CliError;
use crate::install::{self, InstallInfo};
use crate::selector;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::path::Path;
use std::time::{Duration, Instant};

const DEFAULT_WAIT: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(250);

/// `hwply open`: 앱이 떠 있으면 브리지로 열고, 없으면 그 파일로 앱을 띄운 뒤 문서가 나타나기를 기다린다.
pub fn open(path: &Path, no_launch: bool) -> Result<Value, CliError> {
    match Connection::discover().and_then(|c| c.get_json("/v1/health").map(|_| c)) {
        Ok(conn) => conn.post_json("/v1/docs/open", &json!({ "path": path })),
        Err(error @ CliError::NotRunning(_)) if no_launch => Err(error),
        Err(CliError::NotRunning(_)) => {
            launch_app(path)?;
            wait_for_doc(path)
        }
        Err(other) => Err(other),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Mac,
    Windows,
    Other,
}

impl Os {
    fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Other
        }
    }
}

/// 앱을 띄울 프로그램과 앞쪽 인자(파일 경로는 호출한 쪽이 붙인다).
/// `HWPLY_APP` → install.json 의 appExe → OS 기본(macOS 번들 id, Windows 기본 설치 위치).
pub fn launch_command(
    app_env: Option<OsString>,
    install: Option<&InstallInfo>,
    os: Os,
) -> Option<(OsString, Vec<OsString>)> {
    if let Some(app) = app_env {
        return Some((app, Vec::new()));
    }
    let app_exe = install.map(|i| i.app_exe.as_path());
    match os {
        Os::Mac => {
            // `.app/Contents/MacOS/hwply` 면 번들로 띄운다(파일은 Apple 이벤트로 넘어간다).
            let bundle = app_exe
                .and_then(|exe| exe.ancestors().nth(3))
                .filter(|b| b.extension().is_some_and(|e| e == "app") && b.is_dir());
            let args = match bundle {
                Some(b) => vec!["-a".into(), b.as_os_str().to_owned()],
                None => vec!["-b".into(), "com.dante-labs.hwply".into()],
            };
            Some(("open".into(), args))
        }
        Os::Windows => {
            let exe = app_exe.map(Path::to_path_buf).unwrap_or_else(|| {
                let base = std::env::var_os("LOCALAPPDATA").unwrap_or_default();
                Path::new(&base).join("hwply").join("hwply.exe")
            });
            Some((exe.into_os_string(), Vec::new()))
        }
        Os::Other => None,
    }
}

fn launch_app(path: &Path) -> Result<(), CliError> {
    let Some((program, args)) = launch_command(
        std::env::var_os("HWPLY_APP"),
        install::load().as_ref(),
        Os::current(),
    ) else {
        return Err(CliError::NotRunning(
            "이 OS 에서는 앱을 띄울 수 없습니다".into(),
        ));
    };
    let mut command = std::process::Command::new(program);
    command.args(args).arg(path);
    // 앱은 CLI 보다 오래 산다. 표준 입출력을 물려주면 `$(hwply open …)` 처럼 출력을 받는 쪽이 앱이 끝날 때까지 기다린다.
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| CliError::NotRunning(format!("hwply 앱을 띄우지 못했습니다: {e}")))
}

fn wait_for_doc(path: &Path) -> Result<Value, CliError> {
    let wait = std::env::var("HWPLY_LAUNCH_WAIT_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_WAIT);
    let deadline = Instant::now() + wait;
    let wanted = path.to_string_lossy().into_owned();
    loop {
        if let Ok(conn) = Connection::discover() {
            if let Ok(doc) = selector::resolve(&conn, &wanted) {
                return Ok(doc);
            }
        }
        if Instant::now() >= deadline {
            return Err(CliError::NotRunning(
                "hwply 앱이 제한 시간 안에 문서를 열지 못했습니다".into(),
            ));
        }
        std::thread::sleep(POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::InstallInfo;
    use std::ffi::OsString;
    use std::path::PathBuf;

    fn info(app_exe: &str) -> InstallInfo {
        InstallInfo {
            app_version: "0.1.0".into(),
            rhwp_version: "v0.8.7".into(),
            app_exe: PathBuf::from(app_exe),
            cli_exe: None,
            rhwp_exe: None,
            skill_dir: None,
        }
    }

    fn os(v: &[&str]) -> Vec<OsString> {
        v.iter().map(OsString::from).collect()
    }

    #[test]
    fn macos_launch_uses_app_bundle_from_install() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("hwply.app");
        std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
        let i = info(bundle.join("Contents/MacOS/hwply").to_str().unwrap());
        let (program, args) = launch_command(None, Some(&i), Os::Mac).unwrap();
        assert_eq!(program, OsString::from("open"));
        assert_eq!(args, vec![OsString::from("-a"), bundle.into_os_string()]);
    }

    #[test]
    fn macos_launch_ignores_vanished_bundle() {
        // dmg 안 격리 경로처럼 지금은 없는 번들이면 번들 id 로 띄운다.
        let gone = info("/private/var/folders/x/AppTranslocation/A/d/hwply.app/Contents/MacOS/hwply");
        let (_, args) = launch_command(None, Some(&gone), Os::Mac).unwrap();
        assert_eq!(args, os(&["-b", "com.dante-labs.hwply"]));
    }

    #[test]
    fn macos_launch_without_install_uses_bundle_id() {
        let (program, args) = launch_command(None, None, Os::Mac).unwrap();
        assert_eq!(program, OsString::from("open"));
        assert_eq!(args, os(&["-b", "com.dante-labs.hwply"]));
        let not_bundle = info("/Users/x/target/debug/hwply");
        let (_, args) = launch_command(None, Some(&not_bundle), Os::Mac).unwrap();
        assert_eq!(args, os(&["-b", "com.dante-labs.hwply"]));
    }

    #[test]
    fn windows_launch_uses_install_app_exe() {
        let i = info(r"C:\Users\u\AppData\Local\hwply\hwply.exe");
        let (program, args) = launch_command(None, Some(&i), Os::Windows).unwrap();
        assert_eq!(program, OsString::from(r"C:\Users\u\AppData\Local\hwply\hwply.exe"));
        assert!(args.is_empty());
    }

    #[test]
    fn hwply_app_env_wins() {
        let i = info("/Applications/hwply.app/Contents/MacOS/hwply");
        let (program, args) =
            launch_command(Some("/custom/app".into()), Some(&i), Os::Mac).unwrap();
        assert_eq!(program, OsString::from("/custom/app"));
        assert!(args.is_empty());
        assert!(launch_command(None, None, Os::Other).is_none());
    }
}
