//! `hwply doctor` 를 가짜 홈·번들·브리지로 실행한다.
#![cfg(unix)]

use assert_cmd::Command;
use serde_json::Value;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};

struct Fx {
    _dir: tempfile::TempDir,
    home: PathBuf,
    bin: PathBuf,
    macos: PathBuf,
    install: PathBuf,
    agent: PathBuf,
}

fn script(path: &Path, body: &str) {
    std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn fixture(rhwp_version: &str) -> Fx {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let app = root.join("Applications/hwply.app/Contents");
    let macos = app.join("MacOS");
    let skill = app.join("Resources/skill/hwply");
    std::fs::create_dir_all(&macos).unwrap();
    std::fs::create_dir_all(&skill).unwrap();
    script(&macos.join("hwply"), "exit 0");
    script(&macos.join("hwply-cli"), "exit 0");
    script(&macos.join("rhwp"), &format!("echo 'rhwp {rhwp_version}'"));
    std::fs::write(skill.join("SKILL.md"), b"---\nname: hwply\n---\n").unwrap();
    let home = root.join("home");
    std::fs::create_dir_all(home.join(".claude")).unwrap();
    let install = root.join("install.json");
    let v = serde_json::json!({
        "appVersion": "0.1.0", "rhwpVersion": "v0.8.7",
        "appExe": macos.join("hwply"), "cliExe": macos.join("hwply-cli"),
        "rhwpExe": macos.join("rhwp"), "skillDir": skill,
    });
    std::fs::write(&install, serde_json::to_vec(&v).unwrap()).unwrap();
    Fx {
        bin: home.join(".local/bin"),
        agent: root.join("agent.json"),
        _dir: dir,
        home,
        macos,
        install,
    }
}

impl Fx {
    fn cmd(&self, sub: &str) -> Command {
        let mut c = Command::cargo_bin("hwply").unwrap();
        c.env("HWPLY_HOME", &self.home)
            .env("HWPLY_BIN_DIR", &self.bin)
            .env("HWPLY_INSTALL_FILE", &self.install)
            .env("HWPLY_AGENT_FILE", &self.agent)
            .env_remove("HWPLY_RHWP")
            .env("PATH", format!("{}:/usr/bin:/bin", self.bin.display()))
            .arg(sub);
        c
    }

    fn setup(&self) {
        self.cmd("setup").args(["--yes", "--json"]).assert().success();
    }

    fn doctor(&self) -> (i32, Vec<Value>) {
        let out = self.cmd("doctor").arg("--json").output().unwrap();
        let checks: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
            panic!("{e}: {}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr))
        });
        (out.status.code().unwrap(), checks.as_array().unwrap().clone())
    }
}

fn check<'a>(checks: &'a [Value], id: &str) -> &'a Value {
    checks
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("{id} 없음: {checks:#?}"))
}

fn running_bridge(fx: &Fx) -> mockito::ServerGuard {
    let mut server = mockito::Server::new();
    server
        .mock("GET", "/v1/health")
        .with_body(r#"{"appVersion":"0.1.0","rhwpVersion":"v0.8.7","pid":1}"#)
        .create();
    let port: u16 = server.host_with_port().rsplit(':').next().unwrap().parse().unwrap();
    std::fs::write(&fx.agent, format!(r#"{{"port":{port},"token":"t"}}"#)).unwrap();
    server
}

#[test]
fn doctor_all_ok_exits_0() {
    let fx = fixture("v0.8.7");
    fx.setup();
    let _bridge = running_bridge(&fx);
    let (code, checks) = fx.doctor();
    let bad: Vec<_> = checks.iter().filter(|c| c["status"] != "ok").collect();
    assert!(bad.is_empty(), "{bad:#?}");
    assert_eq!(code, 0);
    for id in ["app", "install", "path.hwply", "path.rhwp", "links", "skill.claude"] {
        check(&checks, id);
    }
}

#[test]
fn doctor_app_not_running_is_warn() {
    let fx = fixture("v0.8.7");
    fx.setup();
    let (code, checks) = fx.doctor();
    assert_eq!(check(&checks, "app")["status"], "warn");
    assert_eq!(code, 0);
}

#[test]
fn doctor_stale_agent_file_is_warn() {
    let fx = fixture("v0.8.7");
    fx.setup();
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    std::fs::write(&fx.agent, format!(r#"{{"port":{port},"token":"t"}}"#)).unwrap();
    let (_, checks) = fx.doctor();
    let app = check(&checks, "app");
    assert_eq!(app["status"], "warn");
    assert!(app["message"].as_str().unwrap().contains("agent.json"), "{app}");
}

#[test]
fn doctor_missing_rhwp_is_fail_exit_1() {
    let fx = fixture("v0.8.7");
    fx.setup();
    std::fs::remove_file(fx.bin.join("rhwp")).unwrap();
    std::fs::remove_file(fx.macos.join("rhwp")).unwrap();
    let (code, checks) = fx.doctor();
    assert_eq!(check(&checks, "path.rhwp")["status"], "fail");
    assert_eq!(check(&checks, "install")["status"], "fail");
    assert_eq!(code, 1);
}

#[test]
fn doctor_rhwp_version_mismatch_is_warn() {
    let fx = fixture("v0.8.6");
    fx.setup();
    let (_, checks) = fx.doctor();
    let rhwp = check(&checks, "path.rhwp");
    assert_eq!(rhwp["status"], "warn");
    assert!(rhwp["message"].as_str().unwrap().contains("v0.8.6"), "{rhwp}");
}

#[test]
fn doctor_reports_dangling_link() {
    let fx = fixture("v0.8.7");
    std::fs::create_dir_all(&fx.bin).unwrap();
    symlink("/Gone/hwply.app/Contents/MacOS/hwply-cli", fx.bin.join("hwply")).unwrap();
    let (code, checks) = fx.doctor();
    let links = check(&checks, "links");
    assert_eq!(links["status"], "fail");
    assert!(links["message"].as_str().unwrap().contains("/Gone/"), "{links}");
    assert!(links["fix"].as_str().unwrap().contains("hwply setup"), "{links}");
    assert_eq!(code, 1);
}

#[test]
fn doctor_old_skill_suggests_setup() {
    let fx = fixture("v0.8.7");
    fx.setup();
    let marker = fx.home.join(".claude/skills/hwply/.hwply-skill.json");
    let text = std::fs::read_to_string(&marker).unwrap().replace("0.1.0", "0.0.9");
    std::fs::write(&marker, text).unwrap();
    let (_, checks) = fx.doctor();
    let skill = check(&checks, "skill.claude");
    assert_eq!(skill["status"], "warn");
    assert!(skill["fix"].as_str().unwrap().contains("hwply setup"), "{skill}");
}

#[test]
fn doctor_json_shape() {
    let fx = fixture("v0.8.7");
    let (_, checks) = fx.doctor();
    for c in &checks {
        assert!(c["id"].is_string() && c["message"].is_string(), "{c}");
        assert!(["ok", "warn", "fail"].contains(&c["status"].as_str().unwrap()), "{c}");
    }
    assert!(checks.iter().all(|c| c["id"] != "skill.agents"), "루트가 없는 하니스는 점검하지 않는다");
}
