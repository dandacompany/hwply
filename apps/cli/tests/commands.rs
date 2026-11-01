//! 가짜 브리지(mockito)를 상대로 `hwply` 바이너리를 실행한다.

use assert_cmd::Command;
use mockito::{Matcher, Server, ServerGuard};
use predicates::prelude::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const TOKEN: &str = "test-token";

struct Bridge {
    server: ServerGuard,
    dir: tempfile::TempDir,
    agent_file: PathBuf,
}

fn bridge() -> Bridge {
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
        json!({"port": port, "token": TOKEN, "pid": 1, "appVersion": "0.1.0", "rhwpVersion": "v0.8.7"}).to_string(),
    )
    .unwrap();
    Bridge {
        server,
        dir,
        agent_file,
    }
}

fn hwply(agent_file: &Path) -> Command {
    let mut cmd = Command::cargo_bin("hwply").unwrap();
    // 이 맥에 실제 hwply 가 설치돼 있어도 그 install.json 을 읽지 않게 한다.
    cmd.env("HWPLY_AGENT_FILE", agent_file)
        .env("HWPLY_INSTALL_FILE", agent_file.with_file_name("no-install.json"));
    cmd
}

fn state(seq: u64) -> Value {
    json!({"schemaVersion":1,"format":"hwp","documentEpoch":1,"changeSeq":seq,"dirty":false,"pageCount":1,"documentSha256":"ab"})
}

fn doc(id: &str, path: &str, active: bool) -> Value {
    json!({"id": id, "path": path, "title": Path::new(path).file_name().unwrap().to_string_lossy(),
           "format": "hwp", "dirty": false, "encrypted": false, "windowLabel": "main",
           "focused": active, "active": active, "state": state(0)})
}

fn mock_docs(b: &mut Bridge, docs: Vec<Value>) -> mockito::Mock {
    b.server
        .mock("GET", "/v1/docs")
        .match_header("authorization", format!("Bearer {TOKEN}").as_str())
        .with_header("content-type", "application/json")
        .with_body(json!({ "docs": docs }).to_string())
        .create()
}

#[test]
fn status_without_agent_file_exits_4() {
    let dir = tempfile::tempdir().unwrap();
    hwply(&dir.path().join("missing.json"))
        .arg("status")
        .assert()
        .code(4)
        .stderr(predicate::str::contains("hwply 앱이 실행 중이 아닙니다"));
}

#[test]
fn status_with_stale_agent_file_exits_4() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("agent.json");
    // 아무도 듣지 않는 포트(앱이 강제 종료돼 파일만 남은 경우).
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    std::fs::write(
        &file,
        json!({"port": port, "token": "t", "pid": 1, "appVersion": "0", "rhwpVersion": "0"})
            .to_string(),
    )
    .unwrap();
    hwply(&file).arg("status").assert().code(4);
}

#[test]
fn status_sends_bearer_token() {
    let mut b = bridge();
    let m = b
        .server
        .mock("GET", "/v1/health")
        .match_header("authorization", format!("Bearer {TOKEN}").as_str())
        .with_body(json!({"appVersion":"0.1.0","rhwpVersion":"v0.8.7","pid":42}).to_string())
        .create();
    hwply(&b.agent_file)
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::contains("0.1.0").and(predicate::str::contains("v0.8.7")));
    m.assert();
}

#[test]
fn docs_prints_table_and_json() {
    let mut b = bridge();
    let _m = mock_docs(&mut b, vec![doc("d1", "/tmp/보고서.hwp", true)]);
    hwply(&b.agent_file)
        .arg("docs")
        .assert()
        .success()
        .stdout(predicate::str::contains("보고서.hwp").and(predicate::str::contains("d1")));
    let out = hwply(&b.agent_file)
        .args(["docs", "--json"])
        .output()
        .unwrap();
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["docs"][0]["id"], "d1");
}

#[test]
fn active_selector_picks_active_doc() {
    let mut b = bridge();
    let _d = mock_docs(
        &mut b,
        vec![
            doc("d1", "/tmp/a.hwp", false),
            doc("d2", "/tmp/b.hwp", true),
        ],
    );
    let m = b
        .server
        .mock("GET", "/v1/docs/d2/selection")
        .with_body(r#"{"page":3}"#)
        .create();
    hwply(&b.agent_file)
        .args(["selection", "@active", "--json"])
        .assert()
        .success();
    m.assert();
}

#[test]
fn path_selector_matches_nfd_and_relative_paths() {
    let mut b = bridge();
    let nfd_name: String = unicode_nfd("보고서.hwp");
    let file = b.dir.path().join(&nfd_name);
    std::fs::write(&file, b"x").unwrap();
    // 앱이 보고하는 경로(실제 경로, Windows 는 \\?\ 없이)를 NFC 로.
    let nfc_path = unicode_nfc(&canonical(&file).to_string_lossy());
    let _d = mock_docs(&mut b, vec![doc("d1", &nfc_path, false)]);
    let m = b
        .server
        .mock("GET", "/v1/docs/d1/selection")
        .with_body("{}")
        .expect(1)
        .create();
    hwply(&b.agent_file)
        .current_dir(b.dir.path())
        .args(["selection", &format!("./{nfd_name}"), "--json"])
        .assert()
        .success();
    m.assert();
}

/// CLI 가 보내는 실제 경로(Windows 는 \\?\ 접두사 없이).
fn canonical(path: &Path) -> PathBuf {
    let p = std::fs::canonicalize(path).unwrap();
    let text = p.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p,
    }
}

fn unicode_nfd(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    s.nfd().collect()
}

fn unicode_nfc(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    s.nfc().collect()
}

#[test]
fn unknown_selector_exits_2() {
    let mut b = bridge();
    let _d = mock_docs(&mut b, vec![doc("d1", "/tmp/a.hwp", true)]);
    hwply(&b.agent_file)
        .args(["selection", "nope"])
        .assert()
        .code(2);
}

fn paragraph_body(editable: bool) -> Value {
    let mut v = json!({"section":0,"paragraph":3,"length":5,"text":"옛 문단","editable":editable,"state":state(7)});
    if editable {
        v["evidence"] =
            json!({"beforeSha256":"b1","formatSha256":"f1","adjacentContextSha256":"a1"});
    } else {
        v["reason"] = json!("필드가 있는 문단");
    }
    v
}

#[test]
fn set_text_reads_paragraph_then_posts_with_evidence() {
    let mut b = bridge();
    let _d = mock_docs(&mut b, vec![doc("d1", "/tmp/a.hwp", true)]);
    let _p = b
        .server
        .mock("GET", "/v1/docs/d1/paragraphs/0/3")
        .with_body(paragraph_body(true).to_string())
        .create();
    let post = b
        .server
        .mock("POST", "/v1/docs/d1/text")
        .match_body(Matcher::PartialJson(json!({
            "section": 0, "paragraph": 3, "length": 5, "replacement": "새 문단",
            "expected": {"documentEpoch": 1, "changeSeq": 7, "documentSha256": "ab"},
            "evidence": {"beforeSha256":"b1","formatSha256":"f1","adjacentContextSha256":"a1"}
        })))
        .with_body(r#"{"afterChangeSeq":8}"#)
        .create();
    hwply(&b.agent_file)
        .args(["set-text", "@active", "0", "3", "새 문단"])
        .assert()
        .success();
    post.assert();
}

#[test]
fn set_text_on_uneditable_paragraph_exits_2_without_post() {
    let mut b = bridge();
    let _d = mock_docs(&mut b, vec![doc("d1", "/tmp/a.hwp", true)]);
    let _p = b
        .server
        .mock("GET", "/v1/docs/d1/paragraphs/0/3")
        .with_body(paragraph_body(false).to_string())
        .create();
    let post = b.server.mock("POST", "/v1/docs/d1/text").expect(0).create();
    hwply(&b.agent_file)
        .args(["set-text", "@active", "0", "3", "x"])
        .assert()
        .code(2)
        .stderr(predicate::str::contains("필드가 있는 문단"));
    post.assert();
}

fn conflict(b: &mut Bridge, code: &str) {
    let _d = mock_docs(b, vec![doc("d1", "/tmp/a.hwp", true)]);
    let _p = b
        .server
        .mock("GET", "/v1/docs/d1/paragraphs/0/3")
        .with_body(paragraph_body(true).to_string())
        .create();
    let _post = b
        .server
        .mock("POST", "/v1/docs/d1/text")
        .with_status(409)
        .with_body(json!({"code": code, "message": "바뀜", "state": state(9)}).to_string())
        .create();
    hwply(&b.agent_file)
        .args(["set-text", "@active", "0", "3", "x"])
        .assert()
        .code(3)
        .stderr(predicate::str::contains(code));
}

#[test]
fn document_changed_exits_3() {
    conflict(&mut bridge(), "DOCUMENT_CHANGED");
}

#[test]
fn upstream_preimage_mismatch_exits_3() {
    conflict(&mut bridge(), "TARGET_PREIMAGE_MISMATCH");
}

#[test]
fn save_sends_absolute_as_path_and_force() {
    let mut b = bridge();
    let _d = mock_docs(&mut b, vec![doc("d1", "/tmp/a.hwp", true)]);
    // 아직 없는 파일: 폴더는 실제 경로로 풀린다(macOS /var → /private/var).
    let expected = canonical(b.dir.path()).join("out.hwpx");
    let m = b
        .server
        .mock("POST", "/v1/docs/d1/save")
        .match_body(Matcher::Json(json!({"path": expected, "force": true})))
        .with_body(json!({"state": state(0), "path": expected, "warnings": []}).to_string())
        .create();
    hwply(&b.agent_file)
        .current_dir(b.dir.path())
        .args(["save", "@active", "--as", "out.hwpx", "--force"])
        .assert()
        .success();
    m.assert();
}

#[test]
fn open_with_no_launch_and_no_app_exits_4() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.hwp");
    std::fs::write(&file, b"x").unwrap();
    hwply(&dir.path().join("missing.json"))
        .args(["open", file.to_str().unwrap(), "--no-launch"])
        .assert()
        .code(4);
}

#[test]
fn open_sends_absolute_path_and_prints_id() {
    let mut b = bridge();
    let file = b.dir.path().join("a.hwp");
    std::fs::write(&file, b"x").unwrap();
    let _h = b
        .server
        .mock("GET", "/v1/health")
        .with_body(r#"{"appVersion":"0.1.0"}"#)
        .create();
    let m = b
        .server
        .mock("POST", "/v1/docs/open")
        .match_body(Matcher::Json(json!({"path": canonical(&file)})))
        .with_body(doc("d7", file.to_str().unwrap(), true).to_string())
        .create();
    hwply(&b.agent_file)
        .current_dir(b.dir.path())
        .args(["open", "a.hwp"])
        .assert()
        .success()
        .stdout(predicate::str::contains("d7"));
    m.assert();
}
