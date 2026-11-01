use std::io;
use std::path::{Path, PathBuf};

/// 창과 바이트를 주고받는 임시 폴더(`<app_cache_dir>/agent/`). 앱이 시작할 때 비운다.
#[derive(Debug)]
pub struct StagingDir {
    dir: PathBuf,
}

impl StagingDir {
    pub fn new(dir: &Path) -> io::Result<StagingDir> {
        std::fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            if path.is_file() {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok(StagingDir {
            dir: dir.to_path_buf(),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn new_path(&self, extension: &str) -> PathBuf {
        self.dir
            .join(format!("{}.{}", uuid::Uuid::new_v4().simple(), extension))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staging_dir_is_private_and_cleared_on_start() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("agent");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("old.hwp"), b"x").unwrap();
        let staging = StagingDir::new(&dir).unwrap();
        assert!(!dir.join("old.hwp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        let a = staging.new_path("hwp");
        assert_eq!(a.parent().unwrap(), dir);
        assert_eq!(a.extension().unwrap(), "hwp");
        assert_ne!(a, staging.new_path("hwp"));
    }
}
