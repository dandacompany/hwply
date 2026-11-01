#[cfg(target_os = "macos")]
use super::MacOsEvidence;
use super::{
    LinuxEvidence, TargetEvidence, TargetProbeError, UpdaterTargetProbe, WindowsEvidence,
    WindowsProductRecord, WindowsRegistryHive, WindowsRegistryView, WindowsUninstallEntry,
};

pub(crate) struct NativeTargetProbe;

#[cfg(target_os = "windows")]
impl UpdaterTargetProbe for NativeTargetProbe {
    fn evidence(&self) -> Result<TargetEvidence, TargetProbeError> {
        windows_evidence().map(TargetEvidence::Windows)
    }
}

#[cfg(target_os = "linux")]
impl UpdaterTargetProbe for NativeTargetProbe {
    fn evidence(&self) -> Result<TargetEvidence, TargetProbeError> {
        linux_evidence().map(TargetEvidence::Linux)
    }
}

#[cfg(target_os = "macos")]
impl UpdaterTargetProbe for NativeTargetProbe {
    fn evidence(&self) -> Result<TargetEvidence, TargetProbeError> {
        let exe = std::env::current_exe().map_err(|_| TargetProbeError)?;
        Ok(TargetEvidence::MacOs(macos_evidence_for(
            &exe,
            std::env::consts::ARCH,
        )))
    }
}

/// `<X>.app/Contents/MacOS/<exe>` 에서 번들을 찾고, 번들을 바꿔 끼울 수 있는지(부모 폴더 쓰기) 본다.
#[cfg(target_os = "macos")]
fn macos_evidence_for(exe: &std::path::Path, arch: &str) -> MacOsEvidence {
    let bundle = exe
        .ancestors()
        .nth(3)
        .filter(|b| b.extension().is_some_and(|e| e == "app"))
        .map(std::path::Path::to_path_buf);
    let writable = bundle
        .as_deref()
        .and_then(std::path::Path::parent)
        .is_some_and(|parent| tempfile::tempfile_in(parent).is_ok());
    MacOsEvidence {
        architecture: arch.to_string(),
        current_executable: exe.to_path_buf(),
        translocated: exe.to_string_lossy().contains("/AppTranslocation/"),
        bundle_path: bundle,
        bundle_parent_writable: writable,
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
impl UpdaterTargetProbe for NativeTargetProbe {
    fn evidence(&self) -> Result<TargetEvidence, TargetProbeError> {
        Ok(TargetEvidence::UnsupportedPlatform)
    }
}

#[cfg(target_os = "windows")]
fn windows_evidence() -> Result<WindowsEvidence, TargetProbeError> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
    use winreg::RegKey;

    // tauri.conf.json bundle.publisher 와 같아야 한다 (NSIS 가 이 키를 쓴다). tests/release-config.test.mjs 가 고정.
    const PRODUCT_KEY: &str = r"Software\Dante Labs\hwply";
    const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let local_machine = RegKey::predef(HKEY_LOCAL_MACHINE);
    let mut product_records = Vec::new();
    if let Ok(key) = current_user.open_subkey_with_flags(PRODUCT_KEY, KEY_READ | KEY_WOW64_64KEY) {
        product_records.push(WindowsProductRecord {
            hive: WindowsRegistryHive::CurrentUser,
            view: WindowsRegistryView::Registry64,
            default_install_dir: optional_string(&key, ""),
            install_dir: optional_string(&key, "InstallDir"),
        });
    }
    let mut uninstall_entries = Vec::new();
    for (hive, root) in [
        (WindowsRegistryHive::CurrentUser, &current_user),
        (WindowsRegistryHive::LocalMachine, &local_machine),
    ] {
        let Ok(uninstall) = root.open_subkey_with_flags(UNINSTALL_KEY, KEY_READ | KEY_WOW64_64KEY)
        else {
            continue;
        };
        for key_name in uninstall.enum_keys().flatten() {
            let Ok(entry) = uninstall.open_subkey_with_flags(&key_name, KEY_READ | KEY_WOW64_64KEY)
            else {
                continue;
            };
            let display_name = optional_string(&entry, "DisplayName");
            if !display_name
                .as_deref()
                .is_some_and(|name| name.eq_ignore_ascii_case("hwply"))
            {
                continue;
            }
            uninstall_entries.push(WindowsUninstallEntry {
                hive,
                view: WindowsRegistryView::Registry64,
                key_name,
                display_name,
                publisher: optional_string(&entry, "Publisher"),
                install_location: optional_string(&entry, "InstallLocation"),
                uninstall_string: optional_string(&entry, "UninstallString"),
                main_binary_name: optional_string(&entry, "MainBinaryName"),
                windows_installer: entry.get_value("WindowsInstaller").ok(),
            });
        }
    }
    Ok(WindowsEvidence {
        architecture: std::env::consts::ARCH.to_string(),
        current_executable: std::env::current_exe()
            .and_then(std::fs::canonicalize)
            .map_err(|_| TargetProbeError)?,
        product_records,
        uninstall_entries,
    })
}

#[cfg(target_os = "windows")]
fn optional_string(key: &winreg::RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

#[cfg(target_os = "linux")]
fn linux_evidence() -> Result<LinuxEvidence, TargetProbeError> {
    let current_executable = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|_| TargetProbeError)?;
    let appimage_path = canonical_env_path("APPIMAGE");
    let appdir_path = canonical_env_path("APPDIR");
    let appimage_metadata = appimage_path
        .as_ref()
        .and_then(|path| std::fs::metadata(path).ok());
    let appdir_metadata = appdir_path
        .as_ref()
        .and_then(|path| std::fs::metadata(path).ok());
    let parent_metadata = appimage_path
        .as_ref()
        .and_then(|path| path.parent())
        .and_then(|path| std::fs::metadata(path).ok());
    let appimage_writable = appimage_metadata
        .as_ref()
        .is_some_and(|meta| meta.is_file())
        && appimage_path
            .as_deref()
            .is_some_and(has_effective_write_access);
    let parent_writable = parent_metadata.as_ref().is_some_and(|meta| meta.is_dir())
        && appimage_path
            .as_deref()
            .and_then(std::path::Path::parent)
            .is_some_and(has_effective_write_access);
    Ok(LinuxEvidence {
        architecture: std::env::consts::ARCH.to_string(),
        current_executable,
        appimage_path,
        appdir_path,
        appimage_exists: appimage_metadata
            .as_ref()
            .is_some_and(|meta| meta.is_file()),
        appdir_exists: appdir_metadata.as_ref().is_some_and(|meta| meta.is_dir()),
        appimage_writable,
        parent_writable,
    })
}

#[cfg(target_os = "linux")]
fn has_effective_write_access(path: &std::path::Path) -> bool {
    use rustix::fs::{accessat, Access, AtFlags, CWD};

    accessat(CWD, path, Access::WRITE_OK, AtFlags::EACCESS).is_ok()
}

#[cfg(target_os = "linux")]
fn canonical_env_path(name: &str) -> Option<std::path::PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .and_then(|value| std::fs::canonicalize(value).ok())
}

#[cfg(not(target_os = "windows"))]
fn _keep_windows_types_linked(
    _: (
        WindowsEvidence,
        WindowsProductRecord,
        WindowsRegistryHive,
        WindowsRegistryView,
        WindowsUninstallEntry,
    ),
) {
}

#[cfg(not(target_os = "linux"))]
fn _keep_linux_type_linked(_: LinuxEvidence) {}

#[cfg(all(test, target_os = "linux"))]
mod linux_tests {
    use super::has_effective_write_access;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn effective_write_probe_tracks_current_user_file_and_directory_access() {
        let root = tempfile::tempdir().expect("temporary directory");
        let file = root.path().join("hwply.AppImage");
        std::fs::write(&file, b"fixture").expect("fixture AppImage");

        assert!(has_effective_write_access(root.path()));
        assert!(has_effective_write_access(&file));

        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o400))
            .expect("read-only fixture");
        assert!(!has_effective_write_access(&file));
        assert!(!has_effective_write_access(&root.path().join("missing")));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::macos_evidence_for;
    use std::path::Path;

    #[test]
    fn macos_evidence_finds_bundle_and_writable_parent() {
        let root = tempfile::tempdir().expect("temporary directory");
        let exe = root.path().join("hwply.app/Contents/MacOS/hwply");
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        std::fs::write(&exe, b"").unwrap();
        let evidence = macos_evidence_for(&exe, "aarch64");
        assert_eq!(evidence.bundle_path.as_deref(), Some(root.path().join("hwply.app").as_path()));
        assert!(evidence.bundle_parent_writable);
        assert!(!evidence.translocated);
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1, "쓰기 확인 파일이 남았다");

        let loose = macos_evidence_for(Path::new("/tmp/target/debug/hwply"), "aarch64");
        assert!(loose.bundle_path.is_none());
        let moved = macos_evidence_for(
            Path::new("/private/var/folders/x/AppTranslocation/ABC/d/hwply.app/Contents/MacOS/hwply"),
            "aarch64",
        );
        assert!(moved.translocated);
    }
}
