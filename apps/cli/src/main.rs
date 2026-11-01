mod cli;
mod client;
mod doctor;
mod exit;
mod install;
mod launch;
mod output;
mod rhwp;
mod roundtrip;
mod selector;
mod setup;

use clap::Parser;
use cli::{Cli, Command};
use client::Connection;
use exit::CliError;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};

fn main() {
    let cli = Cli::parse();
    let as_json = cli.json;
    if let Err(error) = run(cli) {
        output::error(&error, as_json);
        std::process::exit(error.exit_code());
    }
}

fn run(cli: Cli) -> Result<(), CliError> {
    let as_json = cli.json;
    let print = |value: &Value| output::json(value);
    match cli.command {
        Command::Doctor => doctor::run(as_json)?,
        Command::Setup {
            yes,
            dry_run,
            path,
            skills,
            from,
            force,
            remove,
        } => {
            let opts = setup::SetupOptions {
                path,
                skills,
                from,
                force,
                remove,
            };
            setup::run(opts, yes, dry_run, as_json)?;
        }
        Command::Status => {
            let health = Connection::discover()?.get_json("/v1/health")?;
            if as_json {
                print(&health);
            } else {
                println!(
                    "hwply {} 실행 중 (rhwp {}, pid {})",
                    health["appVersion"].as_str().unwrap_or("?"),
                    health["rhwpVersion"].as_str().unwrap_or("?"),
                    health["pid"]
                );
            }
        }
        Command::Docs => {
            let docs = Connection::discover()?.get_json("/v1/docs")?;
            if as_json {
                print(&docs)
            } else {
                output::docs_table(&docs)
            }
        }
        Command::Open { file, no_launch } => {
            let path = absolute(&file)?;
            let doc = launch::open(&path, no_launch)?;
            if as_json {
                print(&doc)
            } else {
                println!("{}", doc["id"].as_str().unwrap_or(""))
            }
        }
        Command::New => {
            let doc = Connection::discover()?.post_json("/v1/docs/new", &json!({}))?;
            if as_json {
                print(&doc)
            } else {
                println!("{}", doc["id"].as_str().unwrap_or(""))
            }
        }
        Command::Selection { doc } => {
            let (conn, id) = target(&doc)?;
            print(&conn.get_json(&format!("/v1/docs/{id}/selection"))?);
        }
        Command::Paragraph {
            doc,
            section,
            paragraph,
        } => {
            let (conn, id) = target(&doc)?;
            let p = conn.get_json(&format!("/v1/docs/{id}/paragraphs/{section}/{paragraph}"))?;
            if as_json {
                print(&p);
            } else {
                let editable = if p["editable"].as_bool() == Some(true) {
                    "실시간 편집 가능".to_string()
                } else {
                    format!("실시간 편집 불가: {}", p["reason"].as_str().unwrap_or(""))
                };
                println!(
                    "{}\n({}자, {editable})",
                    p["text"].as_str().unwrap_or(""),
                    p["length"]
                );
            }
        }
        Command::SetText {
            doc,
            section,
            paragraph,
            text,
        } => {
            let text = if text == "-" { read_stdin()? } else { text };
            let (conn, id) = target(&doc)?;
            let receipt = set_text(&conn, &id, section, paragraph, &text)?;
            if as_json {
                print(&receipt)
            } else {
                println!("문단 {section}.{paragraph} 을 바꿨습니다")
            }
        }
        Command::Save {
            doc,
            save_as,
            force,
        } => {
            let (conn, id) = target(&doc)?;
            let mut body = json!({ "force": force });
            if let Some(path) = save_as {
                body["path"] = json!(absolute(&path)?);
            }
            let saved = conn.post_json(&format!("/v1/docs/{id}/save"), &body)?;
            if as_json {
                print(&saved);
            } else {
                println!("저장했습니다: {}", saved["path"].as_str().unwrap_or(""));
                for warning in saved["warnings"].as_array().into_iter().flatten() {
                    eprintln!("경고: {}", warning.as_str().unwrap_or(""));
                }
            }
        }
        Command::Focus {
            doc,
            section,
            paragraph,
        } => {
            let (conn, id) = target(&doc)?;
            let body = json!({ "section": section, "paragraph": paragraph });
            print(&conn.post_json(&format!("/v1/docs/{id}/focus"), &body)?);
        }
        Command::Snapshots { doc } => {
            let (conn, id) = target(&doc)?;
            print(&conn.get_json(&format!("/v1/docs/{id}/snapshots"))?);
        }
        Command::Restore { doc, n } => {
            let (conn, id) = target(&doc)?;
            let state = conn.get_json(&format!("/v1/docs/{id}"))?["state"].clone();
            let body = json!({ "expected": expected_from(&state) });
            print(&conn.post_json(&format!("/v1/docs/{id}/snapshots/{n}/restore"), &body)?);
        }
        Command::Export { doc, format, out } => {
            let conn = Connection::discover()?;
            let doc = selector::resolve(&conn, &doc)?;
            let out = absolute(&out)?;
            let exported = roundtrip::export_to(&conn, &doc, format.as_deref(), &out)?;
            if as_json {
                print(&json!({ "path": out, "state": exported.state }))
            } else {
                println!("{}", out.display())
            }
        }
        Command::Read { doc, rhwp: args } => {
            let rhwp_bin = rhwp::locate(install::load().as_ref())?;
            let conn = Connection::discover()?;
            let doc = selector::resolve(&conn, &doc)?;
            roundtrip::read(&conn, &doc, &rhwp_bin, &args)?;
        }
        Command::Checkout { doc, file } => {
            let conn = Connection::discover()?;
            let doc = selector::resolve(&conn, &doc)?;
            let record = roundtrip::checkout(&conn, &doc, &file)?;
            if as_json {
                print(&record)
            } else {
                println!("체크아웃했습니다: {}", file.display())
            }
        }
        Command::Checkin { doc, file, force } => {
            let result = roundtrip::checkin(&doc, &file, force)?;
            if as_json {
                print(&result)
            } else {
                println!("체크인했습니다")
            }
        }
        Command::Edit { doc, rhwp: args } => {
            rhwp::edit_words(&args)?;
            let rhwp_bin = rhwp::locate(install::load().as_ref())?;
            let conn = Connection::discover()?;
            let doc = selector::resolve(&conn, &doc)?;
            let result = roundtrip::edit(&conn, &doc, &rhwp_bin, &args)?;
            if as_json {
                print(&result)
            } else {
                println!("편집해서 체크인했습니다")
            }
        }
    }
    Ok(())
}

fn target(selector: &str) -> Result<(Connection, String), CliError> {
    let conn = Connection::discover()?;
    let doc = selector::resolve(&conn, selector)?;
    let id = selector::doc_id(&doc)?.to_string();
    Ok((conn, id))
}

/// 실시간 경로(스펙 §8.4): 문단 사전조건을 받아 그대로 실어 보낸다.
fn set_text(
    conn: &Connection,
    id: &str,
    section: u32,
    paragraph: u32,
    text: &str,
) -> Result<Value, CliError> {
    let p = conn.get_json(&format!("/v1/docs/{id}/paragraphs/{section}/{paragraph}"))?;
    if p["editable"].as_bool() != Some(true) {
        return Err(CliError::usage(format!(
            "문단 {section}.{paragraph} 은 실시간으로 바꿀 수 없습니다: {}. `hwply edit` 를 쓰세요.",
            p["reason"].as_str().unwrap_or("")
        )));
    }
    let body = json!({
        "section": section,
        "paragraph": paragraph,
        "length": p["length"],
        "replacement": text,
        "expected": expected_from(&p["state"]),
        "evidence": p["evidence"],
    });
    conn.post_json(&format!("/v1/docs/{id}/text"), &body)
}

pub fn expected_from(state: &Value) -> Value {
    json!({
        "documentEpoch": state["documentEpoch"],
        "changeSeq": state["changeSeq"],
        "documentSha256": state["documentSha256"],
    })
}

pub fn absolute(path: &Path) -> Result<PathBuf, CliError> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(path))
        .map(|p| selector::canonical(&p).unwrap_or_else(|_| resolve_missing(&p)))
        .map_err(|e| CliError::Other(format!("현재 폴더를 알 수 없습니다: {e}")))
}

/// 아직 없는 파일(다른 이름으로 저장 대상): 폴더는 실제 경로로, 이름은 그대로.
fn resolve_missing(path: &Path) -> PathBuf {
    let normalized = normalize(path);
    match (normalized.parent(), normalized.file_name()) {
        (Some(parent), Some(name)) => selector::canonical(parent)
            .map(|p| p.join(name))
            .unwrap_or(normalized),
        _ => normalized,
    }
}

/// `./`·`..` 정리.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

fn read_stdin() -> Result<String, CliError> {
    let mut text = String::new();
    std::io::stdin()
        .read_to_string(&mut text)
        .map_err(|e| CliError::usage(format!("표준 입력을 읽지 못했습니다: {e}")))?;
    Ok(text)
}
