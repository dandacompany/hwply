mod native;
use super::model::{ArtifactKind, UpdaterBlocker, UpdaterTarget};
pub(crate) use native::NativeTargetProbe;
use std::path::{Path, PathBuf};
const MANUAL_DOWNLOADS_URL: &str = "https://github.com/dandacompany/hwply/releases";
pub(crate) trait UpdaterTargetProbe {
    fn evidence(&self) -> Result<TargetEvidence, TargetProbeError>;
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TargetProbeError;
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TargetEvidence {
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    Windows(WindowsEvidence),
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Linux(LinuxEvidence),
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    MacOs(MacOsEvidence),
    #[cfg_attr(
        any(target_os = "windows", target_os = "linux", target_os = "macos"),
        allow(dead_code)
    )]
    UnsupportedPlatform,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WindowsEvidence {
    pub architecture: String,
    pub current_executable: PathBuf,
    pub product_records: Vec<WindowsProductRecord>,
    pub uninstall_entries: Vec<WindowsUninstallEntry>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WindowsProductRecord {
    pub hive: WindowsRegistryHive,
    pub view: WindowsRegistryView,
    pub default_install_dir: Option<String>,
    pub install_dir: Option<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WindowsRegistryHive {
    CurrentUser,
    LocalMachine,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WindowsRegistryView {
    // Native discovery intentionally reads only the 64-bit view. Keep the
    // rejected 32-bit value so eligibility tests can prove that boundary.
    #[allow(dead_code)]
    Registry32,
    Registry64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WindowsUninstallEntry {
    pub hive: WindowsRegistryHive,
    pub view: WindowsRegistryView,
    pub key_name: String,
    pub display_name: Option<String>,
    pub publisher: Option<String>,
    pub install_location: Option<String>,
    pub uninstall_string: Option<String>,
    pub main_binary_name: Option<String>,
    pub windows_installer: Option<u32>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LinuxEvidence {
    pub architecture: String,
    pub current_executable: PathBuf,
    pub appimage_path: Option<PathBuf>,
    pub appdir_path: Option<PathBuf>,
    pub appimage_exists: bool,
    pub appdir_exists: bool,
    pub appimage_writable: bool,
    pub parent_writable: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MacOsEvidence {
    pub architecture: String,
    pub current_executable: PathBuf,
    /// 실행 파일을 담은 `.app` 번들. 번들 밖에서 실행 중이면 `None`.
    pub bundle_path: Option<PathBuf>,
    pub bundle_parent_writable: bool,
    /// 디스크 이미지 등에서 바로 실행돼 격리 경로(App Translocation)에 있다.
    pub translocated: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TargetReason {
    UnsupportedPlatform,
    UnsupportedArchitecture,
    MissingInstallEvidence,
    ConflictingInstallEvidence,
    InstallPathMismatch,
    ReadOnlyAppImage,
    TranslocatedApp,
    ReadOnlyBundle,
    ProbeFailed,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TargetEligibility {
    Supported(UpdaterTarget),
    ManualOnly {
        blocker: UpdaterBlocker,
        reason: TargetReason,
        downloads_url: String,
    },
}
impl TargetEligibility {
    fn manual(blocker: UpdaterBlocker, reason: TargetReason) -> Self {
        Self::ManualOnly {
            blocker,
            reason,
            downloads_url: MANUAL_DOWNLOADS_URL.to_string(),
        }
    }
}
pub(crate) fn detect_updater_target(probe: &impl UpdaterTargetProbe) -> TargetEligibility {
    match probe.evidence() {
        Ok(TargetEvidence::Windows(evidence)) => resolve_windows(&evidence),
        Ok(TargetEvidence::Linux(evidence)) => resolve_linux(&evidence),
        Ok(TargetEvidence::MacOs(evidence)) => resolve_macos(&evidence),
        Ok(TargetEvidence::UnsupportedPlatform) => TargetEligibility::manual(
            UpdaterBlocker::UnsupportedInstall,
            TargetReason::UnsupportedPlatform,
        ),
        Err(_) => TargetEligibility::manual(
            UpdaterBlocker::UnsupportedInstall,
            TargetReason::ProbeFailed,
        ),
    }
}
fn resolve_windows(evidence: &WindowsEvidence) -> TargetEligibility {
    if evidence.architecture != "x86_64" {
        return unsupported_architecture();
    }
    let Some(install_root) = evidence.current_executable.parent() else {
        return unsupported(TargetReason::InstallPathMismatch);
    };
    let matching_records: Vec<_> = evidence
        .product_records
        .iter()
        .filter(|record| product_record_matches(record, install_root))
        .collect();
    if matching_records.is_empty() {
        let reason = if evidence.product_records.is_empty() {
            TargetReason::MissingInstallEvidence
        } else {
            TargetReason::InstallPathMismatch
        };
        return unsupported(reason);
    }
    if matching_records.len() != 1 {
        return unsupported(TargetReason::ConflictingInstallEvidence);
    }
    let kind = match matching_records[0] {
        WindowsProductRecord {
            hive: WindowsRegistryHive::CurrentUser,
            view: WindowsRegistryView::Registry64,
            default_install_dir: Some(_),
            install_dir: None,
        } => ArtifactKind::Nsis,
        WindowsProductRecord {
            hive: WindowsRegistryHive::CurrentUser,
            view: WindowsRegistryView::Registry64,
            default_install_dir: None,
            install_dir: Some(_),
        } => ArtifactKind::Msi,
        _ => return unsupported(TargetReason::ConflictingInstallEvidence),
    };
    let matching_entries: Vec<_> = evidence
        .uninstall_entries
        .iter()
        .filter(|entry| uninstall_entry_matches(entry, install_root, kind))
        .collect();
    if matching_entries.len() != 1 {
        let reason = if matching_entries.is_empty() {
            TargetReason::MissingInstallEvidence
        } else {
            TargetReason::ConflictingInstallEvidence
        };
        return unsupported(reason);
    }
    TargetEligibility::Supported(UpdaterTarget::for_kind(kind))
}
fn product_record_matches(record: &WindowsProductRecord, root: &Path) -> bool {
    let default_matches = record
        .default_install_dir
        .as_deref()
        .is_some_and(|path| same_windows_path(path, &root.to_string_lossy()));
    let install_matches = record
        .install_dir
        .as_deref()
        .is_some_and(|path| same_windows_path(path, &root.to_string_lossy()));
    default_matches || install_matches
}

fn uninstall_entry_matches(
    entry: &WindowsUninstallEntry,
    root: &Path,
    expected_kind: ArtifactKind,
) -> bool {
    if !entry
        .display_name
        .as_deref()
        .is_some_and(|name| name.eq_ignore_ascii_case("hwply"))
        || !entry
            .publisher
            .as_deref()
            .is_some_and(|publisher| publisher.eq_ignore_ascii_case("Dante Labs"))
        || !entry_root_matches(entry, root)
    {
        return false;
    }
    match expected_kind {
        ArtifactKind::Msi => {
            entry.hive == WindowsRegistryHive::LocalMachine
                && entry.view == WindowsRegistryView::Registry64
                && looks_like_product_code(&entry.key_name)
                && entry.windows_installer == Some(1)
                && entry
                    .uninstall_string
                    .as_deref()
                    .is_some_and(|value| value.to_ascii_lowercase().contains("msiexec"))
        }
        ArtifactKind::Nsis => {
            entry.hive == WindowsRegistryHive::CurrentUser
                && entry.windows_installer != Some(1)
                && entry
                    .main_binary_name
                    .as_deref()
                    .is_some_and(|name| name.eq_ignore_ascii_case("hwply.exe"))
                && uninstaller_root(entry).is_some_and(|path| {
                    same_windows_path(&path.to_string_lossy(), &root.to_string_lossy())
                })
        }
        ArtifactKind::AppImage | ArtifactKind::MacAppAarch64 | ArtifactKind::MacAppX64 => false,
    }
}

fn looks_like_product_code(value: &str) -> bool {
    let Some(value) = value
        .strip_prefix('{')
        .and_then(|value| value.strip_suffix('}'))
    else {
        return false;
    };
    value.len() == 36
        && value
            .chars()
            .enumerate()
            .all(|(index, character)| match index {
                8 | 13 | 18 | 23 => character == '-',
                _ => character.is_ascii_hexdigit(),
            })
}

fn entry_root_matches(entry: &WindowsUninstallEntry, root: &Path) -> bool {
    entry
        .install_location
        .as_deref()
        .is_some_and(|path| same_windows_path(path, &root.to_string_lossy()))
        || uninstaller_root(entry)
            .is_some_and(|path| same_windows_path(&path.to_string_lossy(), &root.to_string_lossy()))
}

fn uninstaller_root(entry: &WindowsUninstallEntry) -> Option<PathBuf> {
    let command = entry.uninstall_string.as_deref()?.trim();
    let executable = if let Some(quoted) = command.strip_prefix('"') {
        quoted.split('"').next()?
    } else {
        command.split_whitespace().next()?
    };
    let path = Path::new(executable);
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.eq_ignore_ascii_case("uninstall.exe"))?;
    path.parent().map(Path::to_path_buf)
}

fn same_windows_path(left: &str, right: &str) -> bool {
    normalize_windows_path(left) == normalize_windows_path(right)
}

fn normalize_windows_path(path: &str) -> String {
    let normalized = path
        .trim()
        .trim_matches('"')
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();
    if let Some(unc) = normalized.strip_prefix(r"\\?\unc\") {
        format!(r"\\{unc}")
    } else {
        normalized
            .strip_prefix(r"\\?\")
            .unwrap_or(&normalized)
            .to_string()
    }
}

fn resolve_linux(evidence: &LinuxEvidence) -> TargetEligibility {
    if evidence.architecture != "x86_64" {
        return unsupported_architecture();
    }
    let (Some(appimage), Some(appdir)) = (&evidence.appimage_path, &evidence.appdir_path) else {
        return unsupported(TargetReason::MissingInstallEvidence);
    };
    if !appimage.to_string_lossy().starts_with('/')
        || !appdir.to_string_lossy().starts_with('/')
        || !evidence.appimage_exists
        || !evidence.appdir_exists
        || !evidence.current_executable.starts_with(appdir)
    {
        return unsupported(TargetReason::InstallPathMismatch);
    }
    if !evidence.appimage_writable || !evidence.parent_writable {
        return TargetEligibility::manual(
            UpdaterBlocker::ReadOnlyAppImage,
            TargetReason::ReadOnlyAppImage,
        );
    }
    TargetEligibility::Supported(UpdaterTarget::for_kind(ArtifactKind::AppImage))
}

fn resolve_macos(evidence: &MacOsEvidence) -> TargetEligibility {
    let kind = match evidence.architecture.as_str() {
        "aarch64" => ArtifactKind::MacAppAarch64,
        "x86_64" => ArtifactKind::MacAppX64,
        _ => return unsupported_architecture(),
    };
    if evidence.bundle_path.is_none() {
        return unsupported(TargetReason::MissingInstallEvidence);
    }
    if evidence.translocated {
        return unsupported(TargetReason::TranslocatedApp);
    }
    if !evidence.bundle_parent_writable {
        return unsupported(TargetReason::ReadOnlyBundle);
    }
    TargetEligibility::Supported(UpdaterTarget::for_kind(kind))
}

fn unsupported_architecture() -> TargetEligibility {
    unsupported(TargetReason::UnsupportedArchitecture)
}

fn unsupported(reason: TargetReason) -> TargetEligibility {
    TargetEligibility::manual(UpdaterBlocker::UnsupportedInstall, reason)
}
