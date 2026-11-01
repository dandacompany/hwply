use super::model::{ArtifactKind, UpdaterBlocker, UpdaterTarget};
use super::target::{
    detect_updater_target, LinuxEvidence, MacOsEvidence, TargetEligibility, TargetEvidence, TargetProbeError,
    TargetReason, UpdaterTargetProbe, WindowsEvidence, WindowsProductRecord, WindowsRegistryHive,
    WindowsRegistryView, WindowsUninstallEntry,
};
use std::path::PathBuf;

struct FixtureProbe(Result<TargetEvidence, TargetProbeError>);

impl UpdaterTargetProbe for FixtureProbe {
    fn evidence(&self) -> Result<TargetEvidence, TargetProbeError> {
        self.0.clone()
    }
}

fn detected(evidence: TargetEvidence) -> TargetEligibility {
    detect_updater_target(&FixtureProbe(Ok(evidence)))
}

fn windows_fixture(kind: ArtifactKind) -> WindowsEvidence {
    let root = "C:/Program Files/hwply";
    let (record, entry) = match kind {
        ArtifactKind::Msi => (
            WindowsProductRecord {
                hive: WindowsRegistryHive::CurrentUser,
                view: WindowsRegistryView::Registry64,
                default_install_dir: None,
                install_dir: Some(root.into()),
            },
            WindowsUninstallEntry {
                hive: WindowsRegistryHive::LocalMachine,
                view: WindowsRegistryView::Registry64,
                key_name: "{12345678-1234-1234-1234-123456789ABC}".into(),
                display_name: Some("hwply".into()),
                publisher: Some("Dante Labs".into()),
                install_location: Some(root.into()),
                uninstall_string: Some(
                    "MsiExec.exe /I{12345678-1234-1234-1234-123456789ABC}".into(),
                ),
                main_binary_name: None,
                windows_installer: Some(1),
            },
        ),
        ArtifactKind::Nsis => (
            WindowsProductRecord {
                hive: WindowsRegistryHive::CurrentUser,
                view: WindowsRegistryView::Registry64,
                default_install_dir: Some(root.into()),
                install_dir: None,
            },
            WindowsUninstallEntry {
                hive: WindowsRegistryHive::CurrentUser,
                view: WindowsRegistryView::Registry64,
                key_name: "hwply".into(),
                display_name: Some("hwply".into()),
                publisher: Some("Dante Labs".into()),
                install_location: Some(root.into()),
                uninstall_string: Some(format!("\"{root}/uninstall.exe\" /S")),
                main_binary_name: Some("hwply.exe".into()),
                windows_installer: None,
            },
        ),
        ArtifactKind::AppImage | ArtifactKind::MacAppAarch64 | ArtifactKind::MacAppX64 => unreachable!(),
    };
    WindowsEvidence {
        architecture: "x86_64".into(),
        current_executable: PathBuf::from(format!("{root}/hwply.exe")),
        product_records: vec![record],
        uninstall_entries: vec![entry],
    }
}

fn linux_fixture() -> LinuxEvidence {
    LinuxEvidence {
        architecture: "x86_64".into(),
        current_executable: PathBuf::from("/tmp/.mount_hwply/usr/bin/hwply"),
        appimage_path: Some(PathBuf::from("/opt/hwply.AppImage")),
        appdir_path: Some(PathBuf::from("/tmp/.mount_hwply")),
        appimage_exists: true,
        appdir_exists: true,
        appimage_writable: true,
        parent_writable: true,
    }
}

fn assert_supported(eligibility: TargetEligibility, kind: ArtifactKind) {
    assert_eq!(
        eligibility,
        TargetEligibility::Supported(UpdaterTarget::for_kind(kind))
    );
}

fn assert_manual(eligibility: TargetEligibility, reason: TargetReason) {
    match eligibility {
        TargetEligibility::ManualOnly {
            blocker,
            reason: actual,
            downloads_url,
        } => {
            assert_eq!(actual, reason);
            assert_eq!(blocker, UpdaterBlocker::UnsupportedInstall);
            assert!(downloads_url.ends_with("/hwply/releases"));
        }
        TargetEligibility::Supported(target) => panic!("unexpected supported target: {target:?}"),
    }
}

#[test]
fn windows_msi_and_nsis_require_converging_owned_evidence() {
    assert_supported(
        detected(TargetEvidence::Windows(windows_fixture(ArtifactKind::Msi))),
        ArtifactKind::Msi,
    );
    assert_supported(
        detected(TargetEvidence::Windows(windows_fixture(ArtifactKind::Nsis))),
        ArtifactKind::Nsis,
    );
}

#[test]
fn windows_missing_conflicting_and_path_mismatch_are_manual_only() {
    let mut missing = windows_fixture(ArtifactKind::Msi);
    missing.product_records.clear();
    assert_manual(
        detected(TargetEvidence::Windows(missing)),
        TargetReason::MissingInstallEvidence,
    );

    let mut conflicting = windows_fixture(ArtifactKind::Msi);
    conflicting.product_records.push(WindowsProductRecord {
        hive: WindowsRegistryHive::CurrentUser,
        view: WindowsRegistryView::Registry64,
        default_install_dir: Some("C:/Program Files/hwply".into()),
        install_dir: None,
    });
    assert_manual(
        detected(TargetEvidence::Windows(conflicting)),
        TargetReason::ConflictingInstallEvidence,
    );

    let mut mismatch = windows_fixture(ArtifactKind::Nsis);
    mismatch.product_records[0].default_install_dir = Some("D:/Other/hwply".into());
    assert_manual(
        detected(TargetEvidence::Windows(mismatch)),
        TargetReason::InstallPathMismatch,
    );
}

#[test]
fn windows_product_record_requires_owned_hkcu_registry64_location() {
    let mut wrong_hive = windows_fixture(ArtifactKind::Msi);
    wrong_hive.product_records[0].hive = WindowsRegistryHive::LocalMachine;
    assert_manual(
        detected(TargetEvidence::Windows(wrong_hive)),
        TargetReason::ConflictingInstallEvidence,
    );

    let mut wrong_view = windows_fixture(ArtifactKind::Nsis);
    wrong_view.product_records[0].view = WindowsRegistryView::Registry32;
    assert_manual(
        detected(TargetEvidence::Windows(wrong_view)),
        TargetReason::ConflictingInstallEvidence,
    );
}

#[test]
fn display_name_without_installer_proof_is_not_accepted() {
    let mut evidence = windows_fixture(ArtifactKind::Msi);
    evidence.uninstall_entries[0].key_name = "hwply".into();
    evidence.uninstall_entries[0].windows_installer = None;
    assert_manual(
        detected(TargetEvidence::Windows(evidence)),
        TargetReason::MissingInstallEvidence,
    );
}

#[test]
fn appimage_requires_x64_runtime_linkage_and_writable_target() {
    assert_supported(
        detected(TargetEvidence::Linux(linux_fixture())),
        ArtifactKind::AppImage,
    );

    let mut read_only = linux_fixture();
    read_only.appimage_writable = false;
    match detected(TargetEvidence::Linux(read_only)) {
        TargetEligibility::ManualOnly {
            blocker, reason, ..
        } => {
            assert_eq!(blocker, UpdaterBlocker::ReadOnlyAppImage);
            assert_eq!(reason, TargetReason::ReadOnlyAppImage);
        }
        result => panic!("unexpected result: {result:?}"),
    }

    let mut forged_environment = linux_fixture();
    forged_environment.current_executable = PathBuf::from("/usr/bin/hwply");
    assert_manual(
        detected(TargetEvidence::Linux(forged_environment)),
        TargetReason::InstallPathMismatch,
    );

    let mut relative_appimage = linux_fixture();
    relative_appimage.appimage_path = Some(PathBuf::from("opt/hwply.AppImage"));
    assert_manual(
        detected(TargetEvidence::Linux(relative_appimage)),
        TargetReason::InstallPathMismatch,
    );

    let mut sibling_appdir = linux_fixture();
    sibling_appdir.current_executable = PathBuf::from("/tmp/.mount_hwply-other/usr/bin/hwply");
    assert_manual(
        detected(TargetEvidence::Linux(sibling_appdir)),
        TargetReason::InstallPathMismatch,
    );
}

#[test]
fn deb_rpm_arm64_and_probe_failure_are_manual_only() {
    let mut deb_or_rpm = linux_fixture();
    deb_or_rpm.appimage_path = None;
    deb_or_rpm.appdir_path = None;
    assert_manual(
        detected(TargetEvidence::Linux(deb_or_rpm)),
        TargetReason::MissingInstallEvidence,
    );

    let mut arm64 = linux_fixture();
    arm64.architecture = "aarch64".into();
    assert_manual(
        detected(TargetEvidence::Linux(arm64)),
        TargetReason::UnsupportedArchitecture,
    );

    assert_manual(
        detect_updater_target(&FixtureProbe(Err(TargetProbeError))),
        TargetReason::ProbeFailed,
    );
}

fn macos_fixture(arch: &str) -> MacOsEvidence {
    MacOsEvidence {
        architecture: arch.into(),
        current_executable: PathBuf::from("/Applications/hwply.app/Contents/MacOS/hwply"),
        bundle_path: Some(PathBuf::from("/Applications/hwply.app")),
        bundle_parent_writable: true,
        translocated: false,
    }
}

#[test]
fn macos_bundle_in_writable_folder_is_supported() {
    assert_supported(
        detected(TargetEvidence::MacOs(macos_fixture("aarch64"))),
        ArtifactKind::MacAppAarch64,
    );
    assert_supported(
        detected(TargetEvidence::MacOs(macos_fixture("x86_64"))),
        ArtifactKind::MacAppX64,
    );
}

#[test]
fn macos_translocated_is_manual_only() {
    let mut evidence = macos_fixture("aarch64");
    evidence.translocated = true;
    assert_manual(
        detected(TargetEvidence::MacOs(evidence)),
        TargetReason::TranslocatedApp,
    );
}

#[test]
fn macos_read_only_bundle_is_manual_only() {
    let mut evidence = macos_fixture("aarch64");
    evidence.bundle_parent_writable = false;
    assert_manual(
        detected(TargetEvidence::MacOs(evidence)),
        TargetReason::ReadOnlyBundle,
    );
    let mut loose = macos_fixture("aarch64");
    loose.bundle_path = None;
    assert_manual(
        detected(TargetEvidence::MacOs(loose)),
        TargetReason::MissingInstallEvidence,
    );
}

#[test]
fn macos_unknown_arch_is_unsupported() {
    assert_manual(
        detected(TargetEvidence::MacOs(macos_fixture("powerpc"))),
        TargetReason::UnsupportedArchitecture,
    );
}

#[test]
fn macos_targets_use_darwin_names() {
    assert_eq!(ArtifactKind::MacAppAarch64.target(), "darwin-aarch64");
    assert_eq!(ArtifactKind::MacAppX64.target(), "darwin-x86_64");
    assert!(ArtifactKind::MacAppAarch64.accepts_asset_path("v0.1.0/hwply_aarch64.app.tar.gz"));
    assert!(!ArtifactKind::MacAppAarch64.accepts_asset_path("v0.1.0/hwply_x64.app.tar.gz"));
    assert!(ArtifactKind::MacAppX64.accepts_asset_path("hwply_x64.app.tar.gz"));
}
