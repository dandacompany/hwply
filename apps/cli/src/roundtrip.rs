use crate::client::{cli_temp_root, Connection};
use crate::exit::CliError;
use crate::{absolute, expected_from, rhwp, selector};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// `<파일>.hwply-checkout.json`: 체크아웃 때의 문서와 상태(스펙 §8.4).
fn record_path(file: &Path) -> PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(".hwply-checkout.json");
    PathBuf::from(name)
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), CliError> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    std::io::Write::write_all(
        &mut options
            .open(path)
            .map_err(|e| CliError::Other(format!("{} 를 쓸 수 없습니다: {e}", path.display())))?,
        bytes,
    )
    .map_err(|e| CliError::Other(format!("{} 를 쓸 수 없습니다: {e}", path.display())))
}

/// 앱 캐시 아래 0700 임시 폴더. 놓으면 지워진다.
fn temp_dir() -> Result<tempfile::TempDir, CliError> {
    let root = cli_temp_root();
    std::fs::create_dir_all(&root)
        .map_err(|e| CliError::Other(format!("임시 폴더를 만들 수 없습니다: {e}")))?;
    tempfile::Builder::new()
        .prefix("hwply-")
        .tempdir_in(&root)
        .map_err(|e| CliError::Other(format!("임시 폴더를 만들 수 없습니다: {e}")))
}

pub struct Exported {
    pub id: String,
    pub format: String,
    pub state: Value,
}

/// 문서를 지금 메모리 상태 그대로 내보낸다(미저장 편집 포함).
pub fn export_to(
    conn: &Connection,
    doc: &Value,
    format: Option<&str>,
    out: &Path,
) -> Result<Exported, CliError> {
    let id = selector::doc_id(doc)?.to_string();
    let format = format
        .unwrap_or_else(|| doc["format"].as_str().unwrap_or("hwp"))
        .to_string();
    let exported = conn.get_bytes(&format!("/v1/docs/{id}/export?format={format}"))?;
    write_private(out, &exported.bytes)?;
    Ok(Exported {
        id,
        format,
        state: exported.state,
    })
}

pub fn read(
    conn: &Connection,
    doc: &Value,
    rhwp_bin: &Path,
    args: &[String],
) -> Result<(), CliError> {
    let dir = temp_dir()?;
    let format = doc["format"].as_str().unwrap_or("hwp");
    let file = dir.path().join(format!("doc.{format}"));
    export_to(conn, doc, None, &file)?;
    rhwp::run(rhwp_bin, &rhwp::insert_file_arg(args, &file, 1)?)
}

pub fn checkout(conn: &Connection, doc: &Value, file: &Path) -> Result<Value, CliError> {
    let file = absolute(file)?;
    let exported = export_to(conn, doc, None, &file)?;
    let record =
        json!({ "docId": exported.id, "format": exported.format, "state": exported.state });
    write_private(&record_path(&file), record.to_string().as_bytes())?;
    Ok(record)
}

/// 체크인. 기록 파일을 먼저 확인한 뒤에 앱에 묻는다.
pub fn checkin(selector_arg: &str, file: &Path, force: bool) -> Result<Value, CliError> {
    let file = absolute(file)?;
    let record_file = record_path(&file);
    let record: Value = std::fs::read_to_string(&record_file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .ok_or_else(|| {
            CliError::usage(format!(
                "{} 는 체크아웃한 파일이 아닙니다. 먼저 `hwply checkout` 하세요.",
                file.display()
            ))
        })?;
    let conn = &Connection::discover()?;
    let doc = selector::resolve(conn, selector_arg)?;
    let id = selector::doc_id(&doc)?;
    if record["docId"].as_str() != Some(id) {
        return Err(CliError::usage(
            "체크아웃한 문서와 다른 문서에 체크인하려고 합니다",
        ));
    }
    let state = if force {
        eprintln!("경고: --force — 체크아웃 뒤 사람이 고친 내용을 덮어씁니다");
        conn.get_json(&format!("/v1/docs/{id}"))?["state"].clone()
    } else {
        record["state"].clone()
    };
    let result = replace(conn, id, &file, &state)?;
    let _ = std::fs::remove_file(&record_file);
    Ok(result)
}

fn replace(conn: &Connection, id: &str, file: &Path, state: &Value) -> Result<Value, CliError> {
    let body = json!({ "path": file, "expected": expected_from(state) });
    conn.post_json(&format!("/v1/docs/{id}/replace"), &body)
}

/// `hwply edit`: 체크아웃 → rhwp 한 번 → 체크인. rhwp 가 실패하면 문서는 그대로다.
pub fn edit(
    conn: &Connection,
    doc: &Value,
    rhwp_bin: &Path,
    args: &[String],
) -> Result<Value, CliError> {
    let words = rhwp::edit_words(args)?;
    let dir = temp_dir()?;
    let format = doc["format"].as_str().unwrap_or("hwp");
    let input = dir.path().join(format!("doc.{format}"));
    let output = dir.path().join(format!("edited.{format}"));
    let exported = export_to(conn, doc, None, &input)?;
    let mut rhwp_args = rhwp::insert_file_arg(args, &input, words)?;
    rhwp_args.push("-o".into());
    rhwp_args.push(output.to_string_lossy().into_owned());
    rhwp::run(rhwp_bin, &rhwp_args)?;
    replace(conn, &exported.id, &output, &exported.state)
}
