use crate::client::Connection;
use crate::exit::CliError;
use serde_json::Value;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

/// `<doc>`: 문서 id, `@active`(앞에 있는 창), 또는 열린 문서의 파일 경로(스펙 §9).
pub fn resolve(conn: &Connection, selector: &str) -> Result<Value, CliError> {
    let docs = conn.get_json("/v1/docs")?;
    let docs = docs["docs"].as_array().cloned().unwrap_or_default();
    if selector == "@active" {
        return docs
            .into_iter()
            .find(|d| d["active"].as_bool() == Some(true))
            .ok_or_else(|| CliError::usage("열린 문서가 없습니다"));
    }
    if let Some(doc) = docs.iter().find(|d| d["id"].as_str() == Some(selector)) {
        return Ok(doc.clone());
    }
    let wanted = path_key(Path::new(selector));
    docs.into_iter()
        .find(|d| d["path"].as_str().map(|p| path_key(Path::new(p))) == Some(wanted.clone()))
        .ok_or_else(|| {
            CliError::usage(format!(
                "열린 문서 중에 '{selector}' 가 없습니다. `hwply docs` 로 확인하세요."
            ))
        })
}

/// 경로 비교 열쇠: 정규화(실제 경로) 후 NFC. macOS 파일 이름은 NFD 로 올 수 있다.
pub fn path_key(path: &Path) -> String {
    let resolved = canonical(path).unwrap_or_else(|_| path.to_path_buf());
    resolved.to_string_lossy().nfc().collect()
}

/// Windows `canonicalize` 의 `\\?\` verbatim 접두사를 뗀다(앱이 보고하는 경로와 맞춘다).
pub fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

pub fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    std::fs::canonicalize(path).map(plain_path)
}

pub fn doc_id(doc: &Value) -> Result<&str, CliError> {
    doc["id"]
        .as_str()
        .ok_or_else(|| CliError::Other("브리지 응답에 문서 id 가 없습니다".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_path_strips_windows_verbatim_prefixes() {
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\C:\docs\a.hwp")),
            PathBuf::from(r"C:\docs\a.hwp")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\UNC\server\share\a.hwp")),
            PathBuf::from(r"\\server\share\a.hwp")
        );
        assert_eq!(
            plain_path(PathBuf::from("/tmp/a.hwp")),
            PathBuf::from("/tmp/a.hwp")
        );
    }
}
