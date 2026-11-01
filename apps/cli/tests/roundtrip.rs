//! 왕복 명령: 가짜 브리지(mockito) + 가짜 rhwp(fixtures/fake-rhwp.sh). 셸 스크립트라 Unix 만.
#![cfg(unix)]

use assert_cmd::Command;
use mockito::{Matcher, Server, ServerGuard};
use predicates::prelude::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const TOKEN: &str = "test-token";
const BYTES: &[u8] = b"HWP-BYTES";

struct Env {
    server: ServerGuard,
    dir: tempfile::TempDir,
    agent_file: PathBuf,
    tmp_root: PathBuf,
    log: PathBuf,
    copy: PathBuf,
}

fn env() -> Env {
    let server = Server::new();
    let dir = tempfile::tempdir().unwrap();
    let port: u16 = server
        .host_with_port()
        .rsplit(':')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    let agent_file = dir.path().join("agent.json");
    std::fs::write(
        &agent_file,
        json!({"port": port, "token": TOKEN, "pid": 1}).to_string(),
    )
    .unwrap();
    let tmp_root = dir.path().join("cli-tmp");
    let log = dir.path().join("rhwp.log");
    let copy = dir.path().join("rhwp-input-copy");
    Env {
        server,
        dir,
        agent_file,
        tmp_root,
        log,
        copy,
    }
}

fn fake_rhwp() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-rhwp.sh")
}

fn hwply(e: &Env) -> Command {
    let mut cmd = Command::cargo_bin("hwply").unwrap();
    cmd.env("HWPLY_AGENT_FILE", &e.agent_file)
        .env("HWPLY_INSTALL_FILE", e.agent_file.with_file_name("no-install.json"))
        .env("HWPLY_TMP", &e.tmp_root)
        .env("HWPLY_RHWP", fake_rhwp())
        .env("FAKE_RHWP_LOG", &e.log)
        .env("FAKE_RHWP_COPY", &e.copy);
    cmd
}

fn state(seq: u64) -> Value {
    json!({"schemaVersion":1,"format":"hwp","documentEpoch":1,"changeSeq":seq,"dirty":false,"pageCount":1,"documentSha256":"ab"})
}

fn mock_doc_and_export(e: &mut Env) -> (mockito::Mock, mockito::Mock) {
    let docs = e
        .server
        .mock("GET", "/v1/docs")
        .with_body(json!({"docs":[{"id":"d1","path":"/tmp/a.hwp","title":"a.hwp","format":"hwp","active":true,"state":state(4)}]}).to_string())
        .create();
    let export = e
        .server
        .mock("GET", "/v1/docs/d1/export")
        .match_query(Matcher::UrlEncoded("format".into(), "hwp".into()))
        .with_header("hwply-document-state", &state(4).to_string())
        .with_body(BYTES)
        .create();
    (docs, export)
}

fn rhwp_args(e: &Env) -> Vec<String> {
    std::fs::read_to_string(&e.log)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect()
}

fn leftover_temp_dirs(e: &Env) -> usize {
    std::fs::read_dir(&e.tmp_root)
        .map(|d| d.count())
        .unwrap_or(0)
}

#[test]
fn edit_rejects_user_output_flag() {
    let e = env();
    hwply(&e)
        .args([
            "edit", "@active", "--", "edit", "set-cell", "--table", "0", "-o", "x.hwp",
        ])
        .assert()
        .code(2)
        .stderr(predicate::str::contains("-o"));
}

#[test]
fn edit_rejects_unsupported_subcommand() {
    let e = env();
    hwply(&e)
        .args(["edit", "@active", "--", "export-pdf"])
        .assert()
        .code(2);
}

#[test]
fn read_runs_rhwp_on_exported_bytes_and_cleans_up() {
    let mut e = env();
    let (_d, export) = mock_doc_and_export(&mut e);
    hwply(&e)
        .args(["read", "@active", "--", "export-text", "--json"])
        .assert()
        .success();
    export.assert();
    assert_eq!(std::fs::read(&e.copy).unwrap(), BYTES);
    let args = rhwp_args(&e);
    assert_eq!(args[0], "export-text");
    assert!(args[1].ends_with("doc.hwp"), "{args:?}");
    assert_eq!(args[2], "--json");
    assert_eq!(leftover_temp_dirs(&e), 0);
}

#[test]
fn read_propagates_rhwp_failure_as_exit_5() {
    let mut e = env();
    let _m = mock_doc_and_export(&mut e);
    hwply(&e)
        .env("FAKE_RHWP_EXIT", "3")
        .args(["read", "@active", "--", "fields"])
        .assert()
        .code(5);
    assert_eq!(leftover_temp_dirs(&e), 0);
}

#[test]
fn edit_checks_in_rhwp_output_with_export_state() {
    let mut e = env();
    let _m = mock_doc_and_export(&mut e);
    let replace = e
        .server
        .mock("POST", "/v1/docs/d1/replace")
        .match_body(Matcher::PartialJson(json!({
            "expected": {"documentEpoch": 1, "changeSeq": 4, "documentSha256": "ab"}
        })))
        .with_body(json!({"state": state(0)}).to_string())
        .create();
    hwply(&e)
        .args([
            "edit",
            "@active",
            "--",
            "edit",
            "fill-fields",
            "--data",
            r#"{"수신":"기관"}"#,
        ])
        .assert()
        .success();
    replace.assert();
    let args = rhwp_args(&e);
    assert_eq!(&args[0..2], ["edit", "fill-fields"]);
    assert!(args[2].ends_with("doc.hwp"));
    assert_eq!(&args[3..5], ["--data", r#"{"수신":"기관"}"#]);
    assert_eq!(args[5], "-o");
    assert_eq!(leftover_temp_dirs(&e), 0);
}

#[test]
fn edit_rhwp_failure_exits_5_without_replace() {
    let mut e = env();
    let _m = mock_doc_and_export(&mut e);
    let replace = e
        .server
        .mock("POST", "/v1/docs/d1/replace")
        .expect(0)
        .create();
    hwply(&e)
        .env("FAKE_RHWP_EXIT", "2")
        .args([
            "edit",
            "@active",
            "--",
            "csv-to-table",
            "--table",
            "0",
            "--csv",
            "t.csv",
        ])
        .assert()
        .code(5);
    replace.assert();
}

#[test]
fn checkout_record_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let mut e = env();
    let _m = mock_doc_and_export(&mut e);
    let file = e.dir.path().join("work.hwp");
    hwply(&e)
        .args(["checkout", "@active", file.to_str().unwrap()])
        .assert()
        .success();
    assert_eq!(std::fs::read(&file).unwrap(), BYTES);
    let record = e.dir.path().join("work.hwp.hwply-checkout.json");
    let mode = std::fs::metadata(&record).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
    let v: Value = serde_json::from_str(&std::fs::read_to_string(&record).unwrap()).unwrap();
    assert_eq!(v["docId"], "d1");
    assert_eq!(v["state"]["changeSeq"], 4);
}

#[test]
fn checkin_maps_409_to_exit_3_and_keeps_record() {
    let mut e = env();
    let _m = mock_doc_and_export(&mut e);
    let file = e.dir.path().join("work.hwp");
    hwply(&e)
        .args(["checkout", "@active", file.to_str().unwrap()])
        .assert()
        .success();
    let _r = e
        .server
        .mock("POST", "/v1/docs/d1/replace")
        .with_status(409)
        .with_body(json!({"code":"DOCUMENT_CHANGED","message":"바뀜","state":state(5)}).to_string())
        .create();
    hwply(&e)
        .args(["checkin", "@active", file.to_str().unwrap()])
        .assert()
        .code(3);
    assert!(e.dir.path().join("work.hwp.hwply-checkout.json").exists());
}

#[test]
fn checkin_without_record_exits_2() {
    let e = env();
    let file = e.dir.path().join("never.hwp");
    std::fs::write(&file, b"x").unwrap();
    hwply(&e)
        .args(["checkin", "@active", file.to_str().unwrap()])
        .assert()
        .code(2);
}

#[test]
fn missing_rhwp_exits_5() {
    let e = env();
    let mut cmd = Command::cargo_bin("hwply").unwrap();
    cmd.env("HWPLY_AGENT_FILE", &e.agent_file)
        .env("HWPLY_INSTALL_FILE", e.agent_file.with_file_name("no-install.json"))
        .env("HWPLY_TMP", &e.tmp_root)
        .env_remove("HWPLY_RHWP")
        .env("PATH", "");
    cmd.args(["read", "@active", "--", "fields"])
        .assert()
        .code(5);
}

#[test]
fn launched_app_does_not_hold_cli_output_open() {
    // 앱을 띄울 때 CLI 의 stdout/stderr 를 물려주면 `$(hwply open …)` 이 앱이 끝날 때까지 매달린다.
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.hwp");
    std::fs::write(&file, b"x").unwrap();
    let app = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sleepy-app.sh");
    let started = std::time::Instant::now();
    Command::cargo_bin("hwply")
        .unwrap()
        .env("HWPLY_AGENT_FILE", dir.path().join("missing.json"))
        .env("HWPLY_INSTALL_FILE", dir.path().join("no-install.json"))
        .env("HWPLY_APP", app)
        .env("HWPLY_LAUNCH_WAIT_MS", "300")
        .args(["open", file.to_str().unwrap()])
        .timeout(std::time::Duration::from_secs(10))
        .assert()
        .code(4);
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
}
