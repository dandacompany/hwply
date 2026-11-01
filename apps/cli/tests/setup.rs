//! `hwply setup` 을 가짜 홈·bin·앱 번들로 실행한다(실제 홈은 건드리지 않는다).
#![cfg(unix)]

use assert_cmd::Command;
use serde_json::Value;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

struct Fx {
    _dir: tempfile::TempDir,
    root: PathBuf,
    home: PathBuf,
    bin: PathBuf,
    macos: PathBuf,
    skill: PathBuf,
    install: PathBuf,
}

/// `<root>/Applications/hwply.app` 번들, 빈 홈(+ `.claude`), 빈 bin.
fn fixture() -> Fx {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let app = root.join("Applications/hwply.app/Contents");
    let macos = app.join("MacOS");
    let skill = app.join("Resources/skill/hwply");
    std::fs::create_dir_all(&macos).unwrap();
    std::fs::create_dir_all(skill.join("references")).unwrap();
    for name in ["hwply", "hwply-cli", "rhwp"] {
        std::fs::write(macos.join(name), b"#!/bin/sh\n").unwrap();
    }
    std::fs::write(skill.join("SKILL.md"), b"---\nname: hwply\n---\nnew\n").unwrap();
    std::fs::write(skill.join("references/cli.md"), b"ref").unwrap();
    let home = root.join("home");
    std::fs::create_dir_all(home.join(".claude")).unwrap();
    let bin = home.join(".local/bin");
    let install = root.join("install.json");
    write_install(&install, &macos, &skill, "0.2.0");
    Fx { _dir: dir, root, home, bin, macos, skill, install }
}

fn write_install(path: &Path, macos: &Path, skill: &Path, version: &str) {
    let v = serde_json::json!({
        "appVersion": version,
        "rhwpVersion": "v0.8.7",
        "appExe": macos.join("hwply"),
        "cliExe": macos.join("hwply-cli"),
        "rhwpExe": macos.join("rhwp"),
        "skillDir": skill,
    });
    std::fs::write(path, serde_json::to_vec(&v).unwrap()).unwrap();
}

impl Fx {
    fn cmd(&self, args: &[&str]) -> Command {
        let mut c = Command::cargo_bin("hwply").unwrap();
        c.env("HWPLY_HOME", &self.home)
            .env("HWPLY_BIN_DIR", &self.bin)
            .env("HWPLY_INSTALL_FILE", &self.install)
            .env("PATH", "/usr/bin:/bin")
            .arg("setup")
            .args(args);
        c
    }

    fn run_json(&self, args: &[&str]) -> Value {
        let out = self.cmd(args).arg("--json").output().unwrap();
        assert!(
            out.status.success(),
            "exit {:?}\nstdout {}\nstderr {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&out.stdout).unwrap()
    }

    fn claude_skill(&self) -> PathBuf {
        self.home.join(".claude/skills/hwply")
    }
}

fn action<'a>(report: &'a Value, kind: &str, dest_suffix: &str) -> &'a Value {
    report["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == kind && a["dest"].as_str().unwrap().ends_with(dest_suffix))
        .unwrap_or_else(|| panic!("{kind} {dest_suffix} 없음: {report:#}"))
}

fn marker_version(dir: &Path) -> String {
    let v: Value =
        serde_json::from_slice(&std::fs::read(dir.join(".hwply-skill.json")).unwrap()).unwrap();
    assert_eq!(v["name"], "hwply");
    assert_eq!(v["installedBy"], "hwply-setup");
    v["version"].as_str().unwrap().to_string()
}

#[test]
fn setup_links_cli_and_rhwp_into_bin() {
    let fx = fixture();
    let report = fx.run_json(&["--yes"]);
    assert_eq!(action(&report, "link", "/hwply")["status"], "done");
    assert_eq!(action(&report, "link", "/rhwp")["status"], "done");
    assert_eq!(std::fs::read_link(fx.bin.join("hwply")).unwrap(), fx.macos.join("hwply-cli"));
    assert_eq!(std::fs::read_link(fx.bin.join("rhwp")).unwrap(), fx.macos.join("rhwp"));
}

#[test]
fn setup_keeps_foreign_rhwp_link() {
    let fx = fixture();
    std::fs::create_dir_all(&fx.bin).unwrap();
    let own = fx.root.join("share/rhwp-0.8.7/rhwp");
    std::fs::create_dir_all(own.parent().unwrap()).unwrap();
    std::fs::write(&own, b"").unwrap();
    symlink(&own, fx.bin.join("rhwp")).unwrap();
    let report = fx.run_json(&["--yes"]);
    let rhwp = action(&report, "link", "/rhwp");
    assert_eq!(rhwp["status"], "skipped");
    assert!(rhwp["reason"].as_str().unwrap().contains("--force"), "{rhwp}");
    assert_eq!(std::fs::read_link(fx.bin.join("rhwp")).unwrap(), own);
    assert_eq!(action(&report, "link", "/hwply")["status"], "done");
}

#[test]
fn setup_force_replaces_foreign_link() {
    let fx = fixture();
    std::fs::create_dir_all(&fx.bin).unwrap();
    std::fs::write(fx.bin.join("rhwp"), b"someone else").unwrap();
    let report = fx.run_json(&["--yes", "--force"]);
    assert_eq!(action(&report, "link", "/rhwp")["status"], "done");
    assert_eq!(std::fs::read_link(fx.bin.join("rhwp")).unwrap(), fx.macos.join("rhwp"));
}

#[test]
fn setup_relinks_old_bundle_location() {
    let fx = fixture();
    std::fs::create_dir_all(&fx.bin).unwrap();
    symlink("/Old/Place/hwply.app/Contents/MacOS/hwply-cli", fx.bin.join("hwply")).unwrap();
    let report = fx.run_json(&["--yes"]);
    assert_eq!(action(&report, "link", "/hwply")["status"], "done");
    assert_eq!(std::fs::read_link(fx.bin.join("hwply")).unwrap(), fx.macos.join("hwply-cli"));
}

#[test]
fn setup_refuses_translocated_source() {
    let fx = fixture();
    let moved = fx.root.join("private/var/folders/x/AppTranslocation/ABC/d/hwply.app/Contents");
    std::fs::create_dir_all(moved.join("MacOS")).unwrap();
    for name in ["hwply", "hwply-cli", "rhwp"] {
        std::fs::write(moved.join("MacOS").join(name), b"").unwrap();
    }
    write_install(&fx.install, &moved.join("MacOS"), &fx.skill, "0.2.0");
    let report = fx.run_json(&["--yes"]);
    let link = action(&report, "link", "/hwply");
    assert_eq!(link["status"], "skipped");
    assert!(link["reason"].as_str().unwrap().contains("응용 프로그램 폴더"), "{link}");
    assert!(!fx.bin.join("hwply").exists());
}

#[test]
fn setup_installs_skill_copy_with_marker() {
    let fx = fixture();
    let report = fx.run_json(&["--yes"]);
    assert_eq!(action(&report, "skill", "/.claude/skills/hwply")["status"], "done");
    let dest = fx.claude_skill();
    assert!(!std::fs::symlink_metadata(&dest).unwrap().file_type().is_symlink());
    assert_eq!(std::fs::read(dest.join("references/cli.md")).unwrap(), b"ref");
    assert_eq!(marker_version(&dest), "0.2.0");
}

#[test]
fn setup_skips_unmarked_skill_dir() {
    let fx = fixture();
    std::fs::create_dir_all(fx.claude_skill()).unwrap();
    std::fs::write(fx.claude_skill().join("SKILL.md"), b"mine").unwrap();
    let report = fx.run_json(&["--yes"]);
    let skill = action(&report, "skill", "/.claude/skills/hwply");
    assert_eq!(skill["status"], "skipped");
    assert_eq!(std::fs::read(fx.claude_skill().join("SKILL.md")).unwrap(), b"mine");
}

#[test]
fn setup_skips_symlinked_skill_dir() {
    let fx = fixture();
    let elsewhere = fx.root.join("nas/skills/hwply");
    std::fs::create_dir_all(&elsewhere).unwrap();
    std::fs::create_dir_all(fx.home.join(".claude/skills")).unwrap();
    symlink(&elsewhere, fx.claude_skill()).unwrap();
    let report = fx.run_json(&["--yes"]);
    assert_eq!(action(&report, "skill", "/.claude/skills/hwply")["status"], "skipped");
    assert_eq!(std::fs::read_link(fx.claude_skill()).unwrap(), elsewhere);
    assert!(!elsewhere.join("SKILL.md").exists());
}

#[test]
fn setup_upgrades_own_skill_atomically() {
    let fx = fixture();
    write_install(&fx.install, &fx.macos, &fx.skill, "0.1.0");
    fx.run_json(&["--yes"]);
    std::fs::write(fx.claude_skill().join("stale.md"), b"old only").unwrap();
    write_install(&fx.install, &fx.macos, &fx.skill, "0.2.0");
    let report = fx.run_json(&["--yes"]);
    assert_eq!(action(&report, "skill", "/.claude/skills/hwply")["status"], "done");
    assert_eq!(marker_version(&fx.claude_skill()), "0.2.0");
    assert!(!fx.claude_skill().join("stale.md").exists(), "옛 폴더 내용이 남았다");
    let leftovers: Vec<_> = std::fs::read_dir(fx.home.join(".claude/skills"))
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .filter(|n| n != "hwply")
        .collect();
    assert!(leftovers.is_empty(), "임시 폴더가 남았다: {leftovers:?}");
}

#[test]
fn setup_does_not_downgrade_skill() {
    let fx = fixture();
    fx.run_json(&["--yes"]);
    write_install(&fx.install, &fx.macos, &fx.skill, "0.1.0");
    let report = fx.run_json(&["--yes"]);
    let skill = action(&report, "skill", "/.claude/skills/hwply");
    assert_eq!(skill["status"], "skipped");
    assert!(skill["reason"].as_str().unwrap().contains("0.2.0"), "{skill}");
    assert_eq!(marker_version(&fx.claude_skill()), "0.2.0");
}

#[test]
fn setup_defaults_to_existing_harness_roots() {
    let fx = fixture();
    let report = fx.run_json(&["--dry-run"]);
    let harnesses = report["harnesses"].as_array().unwrap();
    let claude = harnesses.iter().find(|h| h["id"] == "claude").unwrap();
    let agents = harnesses.iter().find(|h| h["id"] == "agents").unwrap();
    assert_eq!(claude["exists"], true);
    assert_eq!(agents["exists"], false);
    let skills: Vec<_> = report["actions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["kind"] == "skill")
        .collect();
    assert_eq!(skills.len(), 1, "{report:#}");
    let explicit = fx.run_json(&["--dry-run", "--skills", "agents"]);
    let kinds: Vec<_> = explicit["actions"].as_array().unwrap().iter().map(|a| a["kind"].clone()).collect();
    assert_eq!(kinds, vec![Value::from("skill")], "--skills 만 주면 PATH 연결은 빠진다");
    assert!(action(&explicit, "skill", "/.agents/skills/hwply")["dest"].is_string());
}

#[test]
fn setup_without_yes_on_non_tty_prints_plan_and_exits_2() {
    let fx = fixture();
    let out = fx.cmd(&[]).write_stdin("").output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stdout).contains("hwply-cli"));
    assert!(String::from_utf8_lossy(&out.stderr).contains("--yes"));
    assert!(!fx.bin.join("hwply").exists());
}

#[test]
fn setup_dry_run_json_shape() {
    let fx = fixture();
    let report = fx.run_json(&["--dry-run"]);
    for a in report["actions"].as_array().unwrap() {
        assert!(a["kind"].is_string() && a["dest"].is_string(), "{a}");
        assert_eq!(a["status"], "planned", "{a}");
    }
    let h = &report["harnesses"][0];
    for key in ["id", "label", "root", "exists"] {
        assert!(!h[key].is_null(), "{key} 없음: {h}");
    }
    assert!(!fx.bin.exists(), "dry-run 이 썼다");
    assert!(!fx.claude_skill().exists(), "dry-run 이 썼다");
}

#[test]
fn setup_remove_deletes_only_ours() {
    let fx = fixture();
    fx.run_json(&["--yes"]);
    std::fs::create_dir_all(fx.home.join(".agents/skills/hwply")).unwrap();
    std::fs::write(fx.home.join(".agents/skills/hwply/SKILL.md"), b"mine").unwrap();
    std::fs::write(fx.bin.join("other"), b"keep").unwrap();
    fx.run_json(&["--yes", "--remove"]);
    assert!(std::fs::symlink_metadata(fx.bin.join("hwply")).is_err());
    assert!(std::fs::symlink_metadata(fx.bin.join("rhwp")).is_err());
    assert!(!fx.claude_skill().exists());
    assert!(fx.home.join(".agents/skills/hwply/SKILL.md").exists());
    assert!(fx.bin.join("other").exists());
}

#[test]
fn setup_reports_path_hint_when_bin_not_on_path() {
    let fx = fixture();
    let report = fx.run_json(&["--dry-run"]);
    assert!(report["pathHint"].as_str().unwrap().contains(".local/bin"), "{report:#}");
    let on_path = fx
        .cmd(&["--dry-run", "--json"])
        .env("PATH", format!("{}:/usr/bin", fx.bin.display()))
        .output()
        .unwrap();
    let report: Value = serde_json::from_slice(&on_path.stdout).unwrap();
    assert!(report["pathHint"].is_null(), "{report:#}");
}

#[test]
fn setup_from_app_uses_conditional_path_hint() {
    // 앱(Finder 실행)은 셸 PATH 를 모르므로 "없습니다" 라고 단정하지 않는다.
    let fx = fixture();
    let out = fx.cmd(&["--dry-run", "--json"]).env("HWPLY_GUI", "1").output().unwrap();
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    let hint = report["pathHint"].as_str().unwrap();
    assert!(hint.contains("터미널에서 hwply 가 실행되지 않으면"), "{hint}");
    assert!(!hint.contains("PATH 에 없습니다"), "{hint}");
}
