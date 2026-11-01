//! PATH 연결: Unix 는 bin 폴더에 번들 파일을 가리키는 심볼릭 링크, Windows 는 우리 bin 폴더에 복사 + 사용자 PATH.

use super::{winpath, Action, Op, Platform, SetupEnv};
use std::path::{Path, PathBuf};

const BUNDLE_MARK: &str = ".app/Contents/MacOS/";

/// 링크 이름 → 번들 원천.
fn entries(env: &SetupEnv) -> [(&'static str, Option<&PathBuf>); 2] {
    [("hwply", env.sources.cli.as_ref()), ("rhwp", env.sources.rhwp.as_ref())]
}

/// dmg 안에서 바로 실행(App Translocation)했거나 마운트된 볼륨 위의 앱. 링크가 곧 끊긴다.
pub fn is_transient(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.contains("/AppTranslocation/") || s.starts_with("/Volumes/")
}

pub fn plan(env: &SetupEnv, force: bool) -> Vec<Action> {
    match env.platform {
        Platform::Unix => entries(env)
            .into_iter()
            .map(|(name, src)| plan_link(name, src, &env.bin_dir.join(name), force))
            .collect(),
        Platform::Windows => plan_windows(env),
    }
}

fn plan_link(name: &str, src: Option<&PathBuf>, dest: &Path, force: bool) -> Action {
    let Some(src) = src.filter(|s| s.is_file()) else {
        return Action::skipped(
            "link",
            None,
            dest,
            format!("앱 번들에서 {name} 을 찾지 못했습니다(앱을 한 번 실행한 뒤 다시)"),
        );
    };
    if is_transient(src) {
        return Action::skipped(
            "link",
            Some(src),
            dest,
            "앱을 응용 프로그램 폴더로 옮긴 뒤 다시 실행하세요(디스크 이미지 안의 앱은 연결이 곧 끊깁니다)",
        );
    }
    let op = Op::Symlink { src: src.clone(), dest: dest.to_path_buf() };
    let Ok(meta) = std::fs::symlink_metadata(dest) else {
        return Action::planned("link", Some(src), dest, op);
    };
    if meta.file_type().is_symlink() {
        let current = std::fs::read_link(dest).unwrap_or_default();
        if current == *src {
            return Action::skipped("link", Some(src), dest, "이미 연결됨");
        }
        if current.to_string_lossy().contains(BUNDLE_MARK) {
            return Action::planned("link", Some(src), dest, op)
                .with_reason(format!("옛 위치({}) 연결을 바꿈", current.display()));
        }
    }
    if force {
        return Action::planned("link", Some(src), dest, op).with_reason("--force: 기존 파일을 교체");
    }
    Action::skipped("link", Some(src), dest, "기존 파일 유지(--force 로 교체)")
}

fn plan_windows(env: &SetupEnv) -> Vec<Action> {
    let mut actions: Vec<Action> = entries(env)
        .into_iter()
        .map(|(name, src)| {
            let dest = env.bin_dir.join(format!("{name}.exe"));
            match src.filter(|s| s.is_file()) {
                Some(src) if same_bytes(src, &dest) => {
                    Action::skipped("copy", Some(src), &dest, "이미 최신")
                }
                Some(src) => Action::planned(
                    "copy",
                    Some(src),
                    &dest,
                    Op::CopyFile { src: src.clone(), dest: dest.clone() },
                ),
                None => Action::skipped("copy", None, &dest, format!("설치 폴더에서 {name} 을 찾지 못했습니다")),
            }
        })
        .collect();
    let dir = env.bin_dir.display().to_string();
    let current = env.user_path.clone().unwrap_or_default();
    actions.push(match winpath::add_entry(&current, &dir) {
        Some(_) => Action::planned("user-path", None, &env.bin_dir, Op::AddUserPath { dir }),
        None => Action::skipped("user-path", None, &env.bin_dir, "이미 사용자 PATH 에 있음"),
    });
    actions
}

fn same_bytes(a: &Path, b: &Path) -> bool {
    match (std::fs::read(a), std::fs::read(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

pub fn plan_remove(env: &SetupEnv) -> Vec<Action> {
    match env.platform {
        Platform::Unix => entries(env)
            .into_iter()
            .filter_map(|(name, src)| {
                let dest = env.bin_dir.join(name);
                let target = std::fs::read_link(&dest).ok()?;
                let ours = src == Some(&target)
                    || target.to_string_lossy().contains(BUNDLE_MARK);
                ours.then(|| Action::planned("remove-link", Some(&target), &dest, Op::RemoveFile { dest: dest.clone() }))
            })
            .collect(),
        Platform::Windows => {
            let mut actions = Vec::new();
            if env.bin_dir.is_dir() {
                actions.push(Action::planned("remove-bin", None, &env.bin_dir, Op::RemoveDir { dest: env.bin_dir.clone() }));
            }
            let dir = env.bin_dir.display().to_string();
            if winpath::remove_entry(env.user_path.as_deref().unwrap_or(""), &dir).is_some() {
                actions.push(Action::planned("remove-path", None, &env.bin_dir, Op::RemoveUserPath { dir }));
            }
            actions
        }
    }
}

pub fn symlink(src: &Path, dest: &Path) -> std::io::Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::symlink_metadata(dest).is_ok() {
        std::fs::remove_file(dest)?;
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(src, dest)
    }
    #[cfg(not(unix))]
    {
        let _ = src;
        Err(std::io::Error::other("이 OS 에서는 심볼릭 링크를 만들지 않습니다"))
    }
}

/// 같은 폴더의 임시 파일에 복사한 뒤 rename. 실행 중이라 바꿀 수 없으면 알기 쉬운 오류로.
pub fn copy_file(src: &Path, dest: &Path) -> std::io::Result<()> {
    let parent = dest.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let staged = parent.join(format!(".{}.new", dest.file_name().unwrap_or_default().to_string_lossy()));
    std::fs::copy(src, &staged)?;
    std::fs::rename(&staged, dest).map_err(|e| {
        let _ = std::fs::remove_file(&staged);
        std::io::Error::new(
            e.kind(),
            format!("{} 를 바꾸지 못했습니다. hwply 를 쓰는 터미널 작업을 끝내고 다시 하세요: {e}", dest.display()),
        )
    })
}

pub fn add_user_path(dir: &str) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let (current, vtype) = winpath::read()?;
        match winpath::add_entry(&current, dir) {
            Some(next) => winpath::write(&next, vtype),
            None => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        Err(std::io::Error::other("사용자 PATH 등록은 Windows 에서만 합니다"))
    }
}

pub fn remove_user_path(dir: &str) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let (current, vtype) = winpath::read()?;
        match winpath::remove_entry(&current, dir) {
            Some(next) => winpath::write(&next, vtype),
            None => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        Err(std::io::Error::other("사용자 PATH 등록은 Windows 에서만 합니다"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup::{Sources, Status};

    fn windows_env(dir: &Path) -> SetupEnv {
        let install = dir.join("install");
        std::fs::create_dir_all(&install).unwrap();
        std::fs::write(install.join("hwply-cli.exe"), b"cli v2").unwrap();
        std::fs::write(install.join("rhwp.exe"), b"rhwp").unwrap();
        SetupEnv {
            platform: Platform::Windows,
            home: dir.join("home"),
            bin_dir: dir.join("bin"),
            sources: Sources {
                cli: Some(install.join("hwply-cli.exe")),
                rhwp: Some(install.join("rhwp.exe")),
                skill: None,
            },
            path_var: None,
            user_path: Some(dir.join("bin").display().to_string()),
            app_version: "0.1.0".into(),
        }
    }

    #[test]
    fn windows_copy_skips_identical_file() {
        let dir = tempfile::tempdir().unwrap();
        let env = windows_env(dir.path());
        std::fs::create_dir_all(&env.bin_dir).unwrap();
        std::fs::write(env.bin_dir.join("rhwp.exe"), b"rhwp").unwrap();
        std::fs::write(env.bin_dir.join("hwply.exe"), b"cli v1").unwrap();
        let actions = plan(&env, false);
        let by_dest = |name: &str| {
            actions
                .iter()
                .find(|a| a.dest.ends_with(name))
                .unwrap_or_else(|| panic!("{name}: {actions:?}"))
        };
        assert_eq!(by_dest("rhwp.exe").status, Status::Skipped);
        assert_eq!(by_dest("hwply.exe").status, Status::Planned);
        assert_eq!(actions.iter().find(|a| a.kind == "user-path").unwrap().status, Status::Skipped);
    }
}
