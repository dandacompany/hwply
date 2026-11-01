//! skill 설치: 하니스마다 `<root>/skills/hwply` 에 **복사본**을 둔다. 표시 파일이 있는 폴더만 우리 것으로 본다.

use super::{version_key, Action, Op, SetupEnv};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const MARKER_FILE: &str = ".hwply-skill.json";

/// (id, 표시 이름, 홈 아래 루트 폴더)
pub const HARNESSES: [(&str, &str, &str); 2] = [
    ("claude", "Claude Code", ".claude"),
    ("agents", "Codex·기타", ".agents"),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Harness {
    pub id: &'static str,
    pub label: &'static str,
    pub root: String,
    pub dest: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
}

fn dest_for(env: &SetupEnv, root: &str) -> PathBuf {
    env.home.join(root).join("skills").join("hwply")
}

/// 우리 표시 파일의 버전. 링크이거나 표시 파일이 없으면 `None`.
pub fn marker_version(dir: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(dir).ok()?;
    if meta.file_type().is_symlink() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join(MARKER_FILE)).ok()?).ok()?;
    (v["name"] == "hwply" && v["installedBy"] == "hwply-setup")
        .then(|| v["version"].as_str().map(str::to_string))
        .flatten()
}

pub fn harnesses(env: &SetupEnv) -> Vec<Harness> {
    HARNESSES
        .iter()
        .map(|(id, label, root)| {
            let dest = dest_for(env, root);
            Harness {
                id,
                label,
                root: env.home.join(root).display().to_string(),
                dest: dest.display().to_string(),
                exists: env.home.join(root).is_dir(),
                installed_version: marker_version(&dest),
            }
        })
        .collect()
}

fn root_of(id: &str) -> &'static str {
    HARNESSES.iter().find(|(known, _, _)| *known == id).map(|(_, _, r)| *r).unwrap_or(".agents")
}

pub fn plan(env: &SetupEnv, ids: &[String], force: bool) -> Vec<Action> {
    ids.iter()
        .map(|id| {
            let dest = dest_for(env, root_of(id));
            let Some(src) = env.sources.skill.as_ref().filter(|s| s.join("SKILL.md").is_file()) else {
                return Action::skipped("skill", None, &dest, "앱 번들에서 skill 을 찾지 못했습니다(--from 으로 지정)");
            };
            let op = Op::InstallSkill {
                src: src.clone(),
                dest: dest.clone(),
                version: env.app_version.clone(),
            };
            let Ok(meta) = std::fs::symlink_metadata(&dest) else {
                return Action::planned("skill", Some(src), &dest, op);
            };
            let foreign = |what: &str| {
                if force {
                    Action::planned("skill", Some(src), &dest, op.clone()).with_reason(format!("--force: {what}을 교체"))
                } else {
                    Action::skipped("skill", Some(src), &dest, format!("{what}이 있어 건드리지 않음(--force 로 교체)"))
                }
            };
            if meta.file_type().is_symlink() {
                return foreign("심볼릭 링크로 된 skill");
            }
            let Some(installed) = marker_version(&dest) else {
                return foreign("hwply setup 이 설치하지 않은 skill");
            };
            match version_key(&installed).cmp(&version_key(&env.app_version)) {
                std::cmp::Ordering::Greater => Action::skipped(
                    "skill",
                    Some(src),
                    &dest,
                    format!("더 새 버전 {installed} 이 설치돼 있음"),
                ),
                std::cmp::Ordering::Equal if !force => {
                    Action::skipped("skill", Some(src), &dest, format!("이미 {installed} 설치됨"))
                }
                _ => Action::planned("skill", Some(src), &dest, op)
                    .with_reason(format!("{installed} → {}", env.app_version)),
            }
        })
        .collect()
}

pub fn plan_remove(env: &SetupEnv, ids: &[String]) -> Vec<Action> {
    ids.iter()
        .filter_map(|id| {
            let dest = dest_for(env, root_of(id));
            marker_version(&dest)?;
            Some(Action::planned("remove-skill", None, &dest, Op::RemoveDir { dest: dest.clone() }))
        })
        .collect()
}

/// 형제 임시 폴더에 복사 → 표시 파일 → 옛 폴더를 비켜 두고 → rename → 옛 폴더 삭제.
/// 중간에 실패하면 옛 폴더가 제자리에 남는다. 옛 폴더만 못 지웠으면 성공 + 경고.
pub fn install(src: &Path, dest: &Path, version: &str) -> std::io::Result<Option<String>> {
    install_with(src, dest, version, |from: &Path, to: &Path| std::fs::rename(from, to))
}

fn install_with(
    src: &Path,
    dest: &Path,
    version: &str,
    rename: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> std::io::Result<Option<String>> {
    let parent = dest.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let staging = tempfile::Builder::new().prefix(".hwply-skill-new-").tempdir_in(parent)?;
    copy_dir(src, staging.path())?;
    let marker = serde_json::json!({ "name": "hwply", "version": version, "installedBy": "hwply-setup" });
    std::fs::write(staging.path().join(MARKER_FILE), serde_json::to_vec_pretty(&marker)?)?;

    let old = match std::fs::symlink_metadata(dest) {
        Ok(meta) if meta.file_type().is_symlink() => {
            std::fs::remove_file(dest)?;
            None
        }
        Ok(_) => {
            let old = tempfile::Builder::new().prefix(".hwply-skill-old-").tempdir_in(parent)?.keep();
            std::fs::remove_dir(&old)?;
            rename(dest, &old)?;
            Some(old)
        }
        Err(_) => None,
    };
    if let Err(error) = rename(staging.path(), dest) {
        if let Some(old) = &old {
            let _ = rename(old, dest);
        }
        return Err(error); // staging 은 drop 때 지워진다
    }
    let _ = staging.keep();
    Ok(old.and_then(|old| {
        std::fs::remove_dir_all(&old).err().map(|e| {
            format!("새 skill 은 설치됐지만 옛 폴더 {} 를 지우지 못했습니다: {e}", old.display())
        })
    }))
}

fn copy_dir(src: &Path, dest: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            std::fs::create_dir_all(&target)?;
            copy_dir(&entry.path(), &target)?;
        } else if entry.file_name() != MARKER_FILE {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn source(dir: &Path) -> PathBuf {
        let src = dir.join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("SKILL.md"), b"new").unwrap();
        src
    }

    fn old_install(dest: &Path) {
        std::fs::create_dir_all(dest).unwrap();
        std::fs::write(dest.join("SKILL.md"), b"old").unwrap();
    }

    fn siblings(dest: &Path) -> Vec<String> {
        std::fs::read_dir(dest.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| n != "hwply")
            .collect()
    }

    #[test]
    fn failed_swap_restores_old_skill() {
        let dir = tempfile::tempdir().unwrap();
        let src = source(dir.path());
        let dest = dir.path().join("skills/hwply");
        old_install(&dest);
        // 새 폴더를 제자리에 넣는 rename 만 실패시킨다.
        let flaky = |from: &Path, to: &Path| {
            if to == dest && from.to_string_lossy().contains(".hwply-skill-new-") {
                Err(std::io::Error::other("injected"))
            } else {
                std::fs::rename(from, to)
            }
        };
        assert!(install_with(&src, &dest, "0.2.0", flaky).is_err());
        assert_eq!(std::fs::read(dest.join("SKILL.md")).unwrap(), b"old", "옛 skill 이 돌아와야 한다");
        assert!(siblings(&dest).is_empty(), "임시 폴더가 남았다: {:?}", siblings(&dest));
    }

    #[test]
    fn old_folder_cleanup_failure_is_a_warning() {
        let dir = tempfile::tempdir().unwrap();
        let src = source(dir.path());
        let dest = dir.path().join("skills/hwply");
        old_install(&dest);
        let locked = dest.join("locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::write(locked.join("f"), b"x").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();

        let warning = install_with(&src, &dest, "0.2.0", |a: &Path, b: &Path| std::fs::rename(a, b))
            .expect("새 skill 은 설치됐으므로 성공");
        assert_eq!(std::fs::read(dest.join("SKILL.md")).unwrap(), b"new");
        assert!(warning.is_some_and(|w| w.contains("옛 폴더")));

        for name in siblings(&dest) {
            let old = dest.parent().unwrap().join(name).join("locked");
            let _ = std::fs::set_permissions(&old, std::fs::Permissions::from_mode(0o755));
        }
    }
}
