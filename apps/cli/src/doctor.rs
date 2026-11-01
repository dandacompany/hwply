//! `hwply doctor`: 앱·설치·PATH·rhwp·skill 을 점검해 무엇이 빠졌고 어떻게 고치는지 알려 준다.

use crate::client::{agent_file_path, Connection};
use crate::exit::CliError;
use crate::install::{self, InstallInfo};
use crate::setup::{marker_version, version_key, Platform, SetupEnv, HARNESSES};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
pub struct Check {
    pub id: String,
    pub status: Level,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
}

fn check(id: impl Into<String>, status: Level, message: impl Into<String>, fix: Option<&str>) -> Check {
    Check {
        id: id.into(),
        status,
        message: message.into(),
        fix: fix.map(str::to_string),
    }
}

const SETUP_FIX: &str = "hwply setup 을 실행하세요";

pub fn run(as_json: bool) -> Result<(), CliError> {
    let env = SetupEnv::from_process(None);
    let info = install::load();
    let checks = vec![
        check_app(),
        check_install(info.as_ref()),
        check_path_hwply(&env, info.as_ref()),
        check_rhwp(info.as_ref()),
        check_links(&env),
    ]
    .into_iter()
    .chain(check_skills(&env))
    .collect::<Vec<_>>();

    if as_json {
        crate::output::json(&serde_json::to_value(&checks).unwrap_or_default());
    } else {
        for c in &checks {
            let mark = match c.status {
                Level::Ok => "✓",
                Level::Warn => "!",
                Level::Fail => "✗",
            };
            println!("{mark} {:<13} {}", c.id, c.message);
            if let Some(fix) = &c.fix {
                println!("  → {fix}");
            }
        }
    }
    if checks.iter().any(|c| c.status == Level::Fail) {
        // 출력은 이미 했으므로 메시지만 짧게.
        return Err(CliError::Other("점검 실패 항목이 있습니다".into()));
    }
    Ok(())
}

fn check_app() -> Check {
    let present = agent_file_path().is_some_and(|p| p.is_file());
    if !present {
        return check("app", Level::Warn, "hwply 앱이 꺼져 있습니다", Some("hwply open <파일> 이 앱을 띄웁니다"));
    }
    match Connection::discover().and_then(|c| c.get_json("/v1/health")) {
        Ok(health) => check(
            "app",
            Level::Ok,
            format!(
                "hwply {} 실행 중 (rhwp {})",
                health["appVersion"].as_str().unwrap_or("?"),
                health["rhwpVersion"].as_str().unwrap_or("?")
            ),
            None,
        ),
        Err(_) => check(
            "app",
            Level::Warn,
            "agent.json 이 남아 있지만 앱에 연결되지 않습니다(비정상 종료 흔적)",
            Some("앱을 다시 켜면 정리됩니다"),
        ),
    }
}

fn check_install(info: Option<&InstallInfo>) -> Check {
    let Some(info) = info else {
        return check("install", Level::Warn, "install.json 이 없습니다", Some("hwply 앱을 한 번 실행하세요"));
    };
    let missing: Vec<String> = [&info.cli_exe, &info.rhwp_exe]
        .into_iter()
        .flatten()
        .filter(|p| !p.is_file())
        .map(|p| p.display().to_string())
        .collect();
    if missing.is_empty() {
        check("install", Level::Ok, format!("hwply {} 설치 확인", info.app_version), None)
    } else {
        check(
            "install",
            Level::Fail,
            format!("설치 기록의 파일이 없습니다: {}", missing.join(", ")),
            Some("hwply 를 다시 설치하거나 앱을 한 번 실행하세요"),
        )
    }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .map(|d| d.join(&file))
        .find(|c| c.is_file())
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn check_path_hwply(env: &SetupEnv, info: Option<&InstallInfo>) -> Check {
    let Some(found) = find_on_path("hwply") else {
        return check("path.hwply", Level::Fail, "PATH 에 hwply 가 없습니다", Some(SETUP_FIX));
    };
    let ours = env.bin_dir.join(format!("hwply{}", std::env::consts::EXE_SUFFIX));
    let is_ours = same_file(&found, &ours)
        || info.and_then(|i| i.cli_exe.as_deref()).is_some_and(|cli| same_file(&found, cli));
    if is_ours || info.is_none() {
        check("path.hwply", Level::Ok, found.display().to_string(), None)
    } else {
        check(
            "path.hwply",
            Level::Warn,
            format!("PATH 의 첫 hwply 가 이 앱의 CLI 가 아닙니다: {}", found.display()),
            Some("PATH 순서를 확인하거나 hwply setup --force"),
        )
    }
}

fn check_rhwp(info: Option<&InstallInfo>) -> Check {
    let rhwp = match crate::rhwp::locate(info) {
        Ok(p) => p,
        Err(e) => return check("path.rhwp", Level::Fail, e.message().to_string(), Some(SETUP_FIX)),
    };
    let version = std::process::Command::new(&rhwp)
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.split_whitespace().nth(1).map(str::to_string));
    let Some(version) = version else {
        return check(
            "path.rhwp",
            Level::Fail,
            format!("{} 를 실행하지 못했습니다", rhwp.display()),
            Some(SETUP_FIX),
        );
    };
    match info.map(|i| i.rhwp_version.as_str()) {
        Some(expected) if version_key(expected) != version_key(&version) => check(
            "path.rhwp",
            Level::Warn,
            format!("{} 는 rhwp {version} 입니다(앱이 고정한 버전은 {expected})", rhwp.display()),
            Some("hwply setup --force 로 앱에 든 rhwp 를 연결할 수 있습니다"),
        ),
        _ => check("path.rhwp", Level::Ok, format!("rhwp {version} ({})", rhwp.display()), None),
    }
}

fn check_links(env: &SetupEnv) -> Check {
    if env.platform == Platform::Windows {
        return check("links", Level::Ok, "Windows 는 복사본을 씁니다", None);
    }
    let dangling: Vec<String> = ["hwply", "rhwp"]
        .iter()
        .map(|n| env.bin_dir.join(n))
        .filter_map(|p| {
            let target = std::fs::read_link(&p).ok()?;
            (!p.exists()).then(|| format!("{} → {}", p.display(), target.display()))
        })
        .collect();
    if dangling.is_empty() {
        check("links", Level::Ok, "끊긴 연결 없음", None)
    } else {
        check(
            "links",
            Level::Fail,
            format!("끊긴 연결(앱을 옮기거나 지움): {}", dangling.join(", ")),
            Some("앱을 응용 프로그램 폴더에 둔 채 hwply setup 을 다시 실행하세요"),
        )
    }
}

fn check_skills(env: &SetupEnv) -> Vec<Check> {
    HARNESSES
        .iter()
        .filter(|(_, _, root)| env.home.join(root).is_dir())
        .map(|(id, label, root)| {
            let dest = env.home.join(root).join("skills").join("hwply");
            let id = format!("skill.{id}");
            match marker_version(&dest) {
                Some(v) if version_key(&v) < version_key(&env.app_version) => check(
                    id,
                    Level::Warn,
                    format!("{label} skill 이 낮은 버전({v})입니다"),
                    Some(SETUP_FIX),
                ),
                Some(v) => check(id, Level::Ok, format!("{label} skill {v}"), None),
                None if std::fs::symlink_metadata(&dest).is_ok() => check(
                    id,
                    Level::Warn,
                    format!("{} 에 hwply setup 이 설치하지 않은 skill 이 있습니다", dest.display()),
                    None,
                ),
                None => check(id, Level::Warn, format!("{label} skill 이 설치되지 않았습니다"), Some(SETUP_FIX)),
            }
        })
        .collect()
}

