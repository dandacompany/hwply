//! 첫 실행 「에이전트 연결 설정」: 번들 안 `hwply-cli setup` 을 불러 계획을 받고 적용한다.
//! PATH·skill 설치 로직은 CLI 한 곳에만 있다(계획 3 결정). 여기는 실행·기록만 한다.

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(crate) const SETUP_STATE_FILE: &str = "setup.json";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupStatus {
    pub cli_available: bool,
    pub first_run: bool,
    pub suggest_refresh: bool,
    pub plan: Value,
}

/// CLI 를 셸 없이 인자 벡터로 실행한다. 표준 출력이 JSON 이면 종료 코드와 무관하게 그것을 돌려준다
/// (`setup` 은 일부 항목 실패 때 exit 1 이지만 결과 JSON 을 낸다).
pub(crate) fn run_cli(cli: &Path, args: &[&str]) -> Result<Value, String> {
    let mut command = std::process::Command::new(cli);
    #[cfg(windows)]
    {
        // GUI 앱이 콘솔 프로그램(hwply-cli)을 부르면 창이 깜빡인다. CREATE_NO_WINDOW.
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .args(args)
        .env("HWPLY_GUI", "1")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("{} 를 실행하지 못했습니다: {e}", cli.display()))?;
    if let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) {
        return Ok(value);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("hwply setup 이 실패했습니다(exit {:?})", output.status.code())
    } else {
        stderr
    })
}

/// 사용자가 「설정」에서 고른 것(setup.json). 옛 형식(`completedVersion` 만)은 아무것도 고르지 않은 것으로 본다.
#[derive(Debug, Clone, Default)]
struct Chosen {
    path: bool,
    skills: Vec<String>,
}

fn read_chosen(data_dir: &Path) -> Chosen {
    let Ok(bytes) = std::fs::read(data_dir.join(SETUP_STATE_FILE)) else {
        return Chosen::default();
    };
    let v: Value = serde_json::from_slice(&bytes).unwrap_or_default();
    Chosen {
        path: v["path"].as_bool().unwrap_or(false),
        skills: v["skills"]
            .as_array()
            .map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
    }
}

/// 갱신을 제안할 때:
/// - 계획이 이미 있는 파일을 바꾼다(옛 skill·옛 링크·옛 복사본), 또는
/// - 사용자가 골랐던 항목이 지금 없어 다시 만들어야 한다(Windows 수동 업그레이드가 지웠거나, dmg 안에서 실행해 건너뛰었던 경우).
fn needs_refresh(plan: &Value, chosen: &Chosen) -> bool {
    let chosen_skill_dests: Vec<&str> = plan["harnesses"]
        .as_array()
        .map(|hs| {
            hs.iter()
                .filter(|h| chosen.skills.iter().any(|id| h["id"] == id.as_str()))
                .filter_map(|h| h["dest"].as_str())
                .collect()
        })
        .unwrap_or_default();
    plan["actions"].as_array().is_some_and(|actions| {
        actions.iter().filter(|a| a["status"] == "planned").any(|a| {
            let dest = a["dest"].as_str().unwrap_or("");
            let replaces = !dest.is_empty() && std::fs::symlink_metadata(dest).is_ok();
            let chosen_path = chosen.path
                && matches!(a["kind"].as_str(), Some("link" | "copy" | "user-path"));
            let chosen_skill = a["kind"] == "skill" && chosen_skill_dests.contains(&dest);
            replaces || chosen_path || chosen_skill
        })
    })
}

pub(crate) fn status_from(cli: Option<&Path>, data_dir: &Path) -> SetupStatus {
    let first_run = !data_dir.join(SETUP_STATE_FILE).is_file();
    let Some(cli) = cli.filter(|c| c.is_file()) else {
        return SetupStatus {
            cli_available: false,
            first_run,
            suggest_refresh: false,
            plan: Value::Null,
        };
    };
    match run_cli(cli, &["setup", "--dry-run", "--json"]) {
        Ok(plan) => SetupStatus {
            cli_available: true,
            first_run,
            suggest_refresh: needs_refresh(&plan, &read_chosen(data_dir)),
            plan,
        },
        Err(error) => {
            eprintln!("[setup] 계획을 받지 못했습니다: {error}");
            SetupStatus {
                cli_available: false,
                first_run,
                suggest_refresh: false,
                plan: Value::Null,
            }
        }
    }
}

fn write_state(data_dir: &Path, version: &str, path: bool, skills: &[String]) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let body = serde_json::json!({ "completedVersion": version, "path": path, "skills": skills });
    std::fs::write(data_dir.join(SETUP_STATE_FILE), body.to_string()).map_err(|e| e.to_string())
}

pub(crate) fn dismiss(data_dir: &Path, version: &str) -> Result<(), String> {
    write_state(data_dir, version, false, &[])
}

pub(crate) fn apply(
    cli: &Path,
    path: bool,
    skills: &[String],
    data_dir: &Path,
    version: &str,
) -> Result<Value, String> {
    // 아무것도 고르지 않았는데 CLI 를 부르면 CLI 기본값(전부)이 적용된다. 부르지 않는다.
    let result = if !path && skills.is_empty() {
        serde_json::json!({ "actions": [], "harnesses": [] })
    } else {
        let joined = skills.join(",");
        let mut args = vec!["setup", "--yes", "--json"];
        if path {
            args.push("--path");
        }
        if !skills.is_empty() {
            args.extend(["--skills", joined.as_str()]);
        }
        run_cli(cli, &args)?
    };
    write_state(data_dir, version, path, skills)?;
    Ok(result)
}

fn sidecar_cli() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join(format!("hwply-cli{}", std::env::consts::EXE_SUFFIX)))
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn setup_status(app: tauri::AppHandle) -> Result<SetupStatus, String> {
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || status_from(sidecar_cli().as_deref(), &data))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn setup_apply(
    app: tauri::AppHandle,
    path: bool,
    skills: Vec<String>,
) -> Result<Value, String> {
    let data = data_dir(&app)?;
    let version = app.package_info().version.to_string();
    let cli = sidecar_cli().filter(|c| c.is_file()).ok_or("앱에 hwply-cli 가 없습니다")?;
    tauri::async_runtime::spawn_blocking(move || apply(&cli, path, &skills, &data, &version))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn setup_dismiss(app: tauri::AppHandle) -> Result<(), String> {
    dismiss(&data_dir(&app)?, &app.package_info().version.to_string())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fake_cli(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("hwply-cli");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    /// 받은 인자를 JSON 으로 돌려주는 가짜 CLI.
    const ECHO_ARGS: &str = r#"printf '{"args":"%s","actions":[],"harnesses":[]}' "$*""#;

    #[test]
    fn status_without_sidecar_is_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let status = status_from(None, dir.path());
        assert!(!status.cli_available);
        assert!(status.first_run);
        assert!(!status.suggest_refresh);
        let missing = dir.path().join("nope");
        assert!(!status_from(Some(&missing), dir.path()).cli_available);
    }

    #[test]
    fn first_run_true_until_setup_json_written() {
        let dir = tempfile::tempdir().unwrap();
        let cli = fake_cli(dir.path(), ECHO_ARGS);
        let data = dir.path().join("data");
        let status = status_from(Some(&cli), &data);
        assert!(status.cli_available && status.first_run);
        assert_eq!(status.plan["args"], "setup --dry-run --json");
        dismiss(&data, "0.1.0").unwrap();
        assert!(!status_from(Some(&cli), &data).first_run);
    }

    #[test]
    fn suggests_refresh_when_planned_action_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let existing = dir.path().join("skill");
        std::fs::create_dir_all(&existing).unwrap();
        let body = format!(
            r#"printf '{{"actions":[{{"kind":"skill","dest":"{}","status":"planned"}},{{"kind":"link","dest":"/nope/hwply","status":"planned"}}],"harnesses":[]}}'"#,
            existing.display()
        );
        let cli = fake_cli(dir.path(), &body);
        assert!(status_from(Some(&cli), dir.path()).suggest_refresh);
        let fresh = fake_cli(dir.path(), r#"printf '{"actions":[{"kind":"link","dest":"/nope/hwply","status":"planned"}],"harnesses":[]}'"#);
        assert!(!status_from(Some(&fresh), dir.path()).suggest_refresh);
    }

    #[test]
    fn apply_passes_selected_options_as_args() {
        let dir = tempfile::tempdir().unwrap();
        let cli = fake_cli(dir.path(), ECHO_ARGS);
        let both = apply(&cli, true, &["claude".into(), "agents".into()], dir.path(), "0.1.0").unwrap();
        assert_eq!(both["args"], "setup --yes --json --path --skills claude,agents");
        let skills_only = apply(&cli, false, &["claude".into()], dir.path(), "0.1.0").unwrap();
        assert_eq!(skills_only["args"], "setup --yes --json --skills claude");
        let path_only = apply(&cli, true, &[], dir.path(), "0.1.0").unwrap();
        assert_eq!(path_only["args"], "setup --yes --json --path");
        let nothing = apply(&cli, false, &[], dir.path(), "0.1.0").unwrap();
        assert!(nothing["args"].is_null(), "아무것도 고르지 않으면 CLI 를 부르지 않는다: {nothing}");
    }

    /// 링크 하나·skill 하나가 계획돼 있는(아직 없는) 가짜 CLI.
    fn missing_items_cli(dir: &Path) -> PathBuf {
        let skill = dir.join("home/.claude/skills/hwply");
        let body = format!(
            r#"printf '{{"actions":[{{"kind":"link","dest":"{}","status":"planned"}},{{"kind":"skill","dest":"{}","status":"planned"}}],"harnesses":[{{"id":"claude","dest":"{}"}}]}}'"#,
            dir.join("home/.local/bin/hwply").display(),
            skill.display(),
            skill.display()
        );
        fake_cli(dir, &body)
    }

    #[test]
    fn suggests_refresh_when_chosen_item_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let cli = missing_items_cli(dir.path());
        let data = dir.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let state = |body: &str| std::fs::write(data.join(SETUP_STATE_FILE), body).unwrap();

        state(r#"{"completedVersion":"0.1.0","path":true,"skills":[]}"#);
        assert!(status_from(Some(&cli), &data).suggest_refresh, "고른 PATH 연결이 사라졌다");
        state(r#"{"completedVersion":"0.1.0","path":false,"skills":["claude"]}"#);
        assert!(status_from(Some(&cli), &data).suggest_refresh, "고른 skill 이 사라졌다");
        state(r#"{"completedVersion":"0.1.0","path":false,"skills":[]}"#);
        assert!(!status_from(Some(&cli), &data).suggest_refresh, "고르지 않은 것은 다시 묻지 않는다");
        state(r#"{"completedVersion":"0.1.0"}"#);
        assert!(!status_from(Some(&cli), &data).suggest_refresh);
    }

    #[test]
    fn apply_records_choices_and_dismiss_records_none() {
        let dir = tempfile::tempdir().unwrap();
        let cli = fake_cli(dir.path(), ECHO_ARGS);
        let data = dir.path().join("data");
        let read = || -> Value {
            serde_json::from_slice(&std::fs::read(data.join(SETUP_STATE_FILE)).unwrap()).unwrap()
        };
        apply(&cli, true, &["claude".into()], &data, "0.1.0").unwrap();
        assert_eq!(read()["path"], true);
        assert_eq!(read()["skills"], serde_json::json!(["claude"]));
        dismiss(&data, "0.1.0").unwrap();
        assert_eq!(read()["path"], false);
        assert_eq!(read()["skills"], serde_json::json!([]));
    }

    #[test]
    fn apply_writes_completed_version() {
        let dir = tempfile::tempdir().unwrap();
        let cli = fake_cli(dir.path(), ECHO_ARGS);
        let data = dir.path().join("data");
        apply(&cli, true, &[], &data, "0.1.0").unwrap();
        let state: Value =
            serde_json::from_slice(&std::fs::read(data.join(SETUP_STATE_FILE)).unwrap()).unwrap();
        assert_eq!(state["completedVersion"], "0.1.0");
    }

    #[test]
    fn cli_failure_returns_error_message() {
        let dir = tempfile::tempdir().unwrap();
        let cli = fake_cli(dir.path(), "echo boom >&2; exit 3");
        let error = run_cli(&cli, &["setup"]).unwrap_err();
        assert!(error.contains("boom"), "{error}");
        // 일부 실패(exit 1)여도 JSON 결과가 있으면 그대로 돌려준다.
        let partial = fake_cli(dir.path(), r#"printf '{"actions":[{"status":"failed"}]}'; exit 1"#);
        assert_eq!(run_cli(&partial, &["setup"]).unwrap()["actions"][0]["status"], "failed");
    }

    #[test]
    fn cli_runs_with_gui_marker() {
        let dir = tempfile::tempdir().unwrap();
        let cli = fake_cli(dir.path(), r#"printf '{"gui":"%s"}' "$HWPLY_GUI""#);
        assert_eq!(run_cli(&cli, &["setup"]).unwrap()["gui"], "1");
    }
}
