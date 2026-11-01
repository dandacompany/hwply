use crate::exit::CliError;
use serde_json::Value;

pub fn json(value: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_default()
    );
}

pub fn error(error: &CliError, as_json: bool) {
    if as_json {
        eprintln!("{}", error.to_json());
    } else {
        eprintln!("{error}");
    }
}

pub fn docs_table(docs: &Value) {
    let docs = docs["docs"].as_array().cloned().unwrap_or_default();
    if docs.is_empty() {
        println!("열린 문서가 없습니다");
        return;
    }
    for doc in docs {
        let marker = if doc["active"].as_bool() == Some(true) {
            "*"
        } else {
            " "
        };
        let dirty = if doc["dirty"].as_bool() == Some(true) {
            "수정됨"
        } else {
            ""
        };
        println!(
            "{marker} {}  {}  {}  {}",
            doc["id"].as_str().unwrap_or(""),
            doc["title"].as_str().unwrap_or(""),
            dirty,
            doc["path"].as_str().unwrap_or("(저장 안 됨)"),
        );
    }
}
