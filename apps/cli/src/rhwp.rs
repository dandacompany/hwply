use crate::install::InstallInfo;
use crate::exit::CliError;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub const RHWP_NAME: &str = if cfg!(windows) { "rhwp.exe" } else { "rhwp" };

/// rhwp 바이너리: `HWPLY_RHWP` → `install.json` 의 rhwpExe(앱 번들) → PATH 의 rhwp (스펙 §9).
pub fn locate(install: Option<&InstallInfo>) -> Result<PathBuf, CliError> {
    locate_with(
        std::env::var_os("HWPLY_RHWP"),
        install,
        std::env::var_os("PATH"),
    )
}

pub fn locate_with(
    env_rhwp: Option<OsString>,
    install: Option<&InstallInfo>,
    path_var: Option<OsString>,
) -> Result<PathBuf, CliError> {
    if let Some(path) = env_rhwp {
        return Ok(PathBuf::from(path));
    }
    if let Some(path) = install
        .and_then(|i| i.rhwp_exe.clone())
        .filter(|p| p.is_file())
    {
        return Ok(path);
    }
    path_var
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join(RHWP_NAME))
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            CliError::Rhwp(
                "rhwp CLI 를 찾을 수 없습니다. `hwply setup` 을 실행하거나 HWPLY_RHWP 를 지정하세요."
                    .into(),
            )
        })
}

/// 앞 `words` 개 토큰(명령·하위명령) 뒤에 파일 경로를 끼운다. 상류 `rhwp <명령> [<하위명령>] <파일> …` 형태.
pub fn insert_file_arg(
    args: &[String],
    file: &Path,
    words: usize,
) -> Result<Vec<String>, CliError> {
    if args.len() < words {
        return Err(CliError::usage("rhwp 명령이 비어 있습니다"));
    }
    let mut out: Vec<String> = args[..words].to_vec();
    out.push(file.to_string_lossy().into_owned());
    out.extend_from_slice(&args[words..]);
    Ok(out)
}

/// `edit` 설탕이 받는 하위 명령과 그 명령 단어 수(스펙 §8.4). 사용자가 출력 경로를 주면 거절한다.
pub fn edit_words(args: &[String]) -> Result<usize, CliError> {
    if args
        .iter()
        .any(|a| a == "-o" || a == "--output" || a.starts_with("--output="))
    {
        return Err(CliError::usage(
            "출력 경로(-o/--output)는 hwply 가 정합니다. 빼고 다시 실행하세요.",
        ));
    }
    match args.first().map(String::as_str) {
        Some("edit") if args.len() >= 2 => Ok(2),
        Some("csv-to-table") => Ok(1),
        _ => Err(CliError::usage(
            "hwply edit 는 `-- edit <하위명령> …` 과 `-- csv-to-table …` 만 받습니다. 그 밖은 checkout/checkin 사이에서 rhwp 를 직접 쓰세요.",
        )),
    }
}

pub fn run(rhwp: &Path, args: &[String]) -> Result<(), CliError> {
    let status = std::process::Command::new(rhwp)
        .args(args)
        .status()
        .map_err(|e| CliError::Rhwp(format!("rhwp 를 실행하지 못했습니다: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(CliError::Rhwp(format!(
            "rhwp 가 실패했습니다 (종료 코드 {})",
            status.code().unwrap_or(-1)
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn insert_file_arg_places_file_after_command_words() {
        let args = strings(&["edit", "fill-fields", "--data", "{}"]);
        let out = insert_file_arg(&args, Path::new("/t/doc.hwp"), 2).unwrap();
        assert_eq!(
            out,
            strings(&["edit", "fill-fields", "/t/doc.hwp", "--data", "{}"])
        );
        let out = insert_file_arg(&strings(&["fields"]), Path::new("/t/doc.hwp"), 1).unwrap();
        assert_eq!(out, strings(&["fields", "/t/doc.hwp"]));
    }

    #[test]
    fn edit_words_accepts_only_edit_and_csv_to_table() {
        assert_eq!(edit_words(&strings(&["edit", "set-cell"])).unwrap(), 2);
        assert_eq!(
            edit_words(&strings(&["csv-to-table", "--table", "0"])).unwrap(),
            1
        );
        assert_eq!(edit_words(&strings(&["edit"])).unwrap_err().exit_code(), 2);
        assert_eq!(
            edit_words(&strings(&["export-pdf"]))
                .unwrap_err()
                .exit_code(),
            2
        );
        assert_eq!(
            edit_words(&strings(&["edit", "x", "--output=a.hwp"]))
                .unwrap_err()
                .exit_code(),
            2
        );
    }
    fn info_with_rhwp(path: &Path) -> InstallInfo {
        InstallInfo {
            app_version: "0.1.0".into(),
            rhwp_version: "v0.8.7".into(),
            app_exe: PathBuf::from("/A/hwply"),
            cli_exe: None,
            rhwp_exe: Some(path.to_path_buf()),
            skill_dir: None,
        }
    }

    fn file_in(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"").unwrap();
        path
    }

    #[test]
    fn rhwp_env_overrides_install_record() {
        let dir = tempfile::tempdir().unwrap();
        let bundled = file_in(dir.path(), "bundled-rhwp");
        let found = locate_with(
            Some("/env/rhwp".into()),
            Some(&info_with_rhwp(&bundled)),
            None,
        )
        .unwrap();
        assert_eq!(found, PathBuf::from("/env/rhwp"));
    }

    #[test]
    fn rhwp_comes_from_install_record_when_no_env() {
        let dir = tempfile::tempdir().unwrap();
        let bundled = file_in(dir.path(), "bundled-rhwp");
        let on_path = tempfile::tempdir().unwrap();
        file_in(on_path.path(), RHWP_NAME);
        let found = locate_with(
            None,
            Some(&info_with_rhwp(&bundled)),
            Some(on_path.path().as_os_str().to_owned()),
        )
        .unwrap();
        assert_eq!(found, bundled);
    }

    #[test]
    fn missing_install_record_falls_back_to_path() {
        let on_path = tempfile::tempdir().unwrap();
        let expected = file_in(on_path.path(), RHWP_NAME);
        let gone = info_with_rhwp(Path::new("/nonexistent/rhwp"));
        let path_var = Some(on_path.path().as_os_str().to_owned());
        assert_eq!(locate_with(None, None, path_var.clone()).unwrap(), expected);
        assert_eq!(locate_with(None, Some(&gone), path_var).unwrap(), expected);
        assert_eq!(locate_with(None, None, None).unwrap_err().exit_code(), 5);
    }
}
