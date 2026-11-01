use super::*;
use std::sync::Arc;

const SNAPSHOT: &str = "123e4567-e89b-42d3-a456-426614174000";

#[test]
fn old_safe_product_directory_is_removed() {
    let root = tempfile::tempdir().unwrap();
    let candidate = product_dir(root.path(), "old");
    std::fs::create_dir(&candidate).unwrap();
    std::fs::write(candidate.join("page-00000000.svg"), b"<svg/>").unwrap();

    let removed = cleanup_orphan_pdf_temp_dirs_at(
        root.path(),
        SystemTime::now() + Duration::from_secs(2 * 24 * 60 * 60),
        OrphanCleanupPolicy::default(),
    )
    .unwrap();

    assert_eq!(removed, 1);
    assert!(!candidate.exists());
}

#[test]
fn recent_product_directory_is_preserved() {
    let root = tempfile::tempdir().unwrap();
    let candidate = product_dir(root.path(), "recent");
    std::fs::create_dir(&candidate).unwrap();

    let removed = cleanup_orphan_pdf_temp_dirs_at(
        root.path(),
        SystemTime::now(),
        OrphanCleanupPolicy::default(),
    )
    .unwrap();

    assert_eq!(removed, 0);
    assert!(candidate.exists());
}

#[test]
fn unknown_nested_and_non_product_entries_are_preserved() {
    let root = tempfile::tempdir().unwrap();
    let unknown = product_dir(root.path(), "unknown");
    std::fs::create_dir(&unknown).unwrap();
    std::fs::write(unknown.join("notes.txt"), b"keep").unwrap();
    let nested = root
        .path()
        .join("container")
        .join(format!("{PDF_TEMP_PREFIX}nested"));
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(nested.join("page-00000000.svg"), b"<svg/>").unwrap();
    let other = root.path().join("unrelated");
    std::fs::create_dir(&other).unwrap();

    let removed = cleanup_orphan_pdf_temp_dirs_at(
        root.path(),
        SystemTime::now() + Duration::from_secs(2 * 24 * 60 * 60),
        OrphanCleanupPolicy::default(),
    )
    .unwrap();

    assert_eq!(removed, 0);
    assert!(unknown.exists());
    assert!(nested.exists());
    assert!(other.exists());
}

#[test]
fn removal_and_child_entry_limits_are_enforced() {
    let root = tempfile::tempdir().unwrap();
    for index in 0..3 {
        std::fs::create_dir(product_dir(root.path(), &format!("safe{index}"))).unwrap();
    }
    let crowded = product_dir(root.path(), "crowded");
    std::fs::create_dir(&crowded).unwrap();
    std::fs::write(crowded.join("page-00000000.svg"), b"<svg/>").unwrap();
    std::fs::write(crowded.join("page-00000001.svg"), b"<svg/>").unwrap();
    let policy = OrphanCleanupPolicy {
        min_age: Duration::from_secs(1),
        max_removals: 2,
        max_child_entries: 1,
        ..OrphanCleanupPolicy::default()
    };

    let removed = cleanup_orphan_pdf_temp_dirs_at(
        root.path(),
        SystemTime::now() + Duration::from_secs(2),
        policy,
    )
    .unwrap();

    assert_eq!(removed, 2);
    assert!(crowded.exists());
    let safe_remaining = (0..3)
        .filter(|index| product_dir(root.path(), &format!("safe{index}")).exists())
        .count();
    assert_eq!(safe_remaining, 1);
}

#[cfg(unix)]
#[test]
fn symlink_candidate_is_preserved_without_touching_target() {
    use std::os::unix::fs::symlink;

    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("target");
    std::fs::create_dir(&target).unwrap();
    let sentinel = target.join("page-00000000.svg");
    std::fs::write(&sentinel, b"keep").unwrap();
    let link = product_dir(root.path(), "link");
    symlink(&target, &link).unwrap();

    let removed = cleanup_orphan_pdf_temp_dirs_at(
        root.path(),
        SystemTime::now() + Duration::from_secs(2 * 24 * 60 * 60),
        OrphanCleanupPolicy::default(),
    )
    .unwrap();

    assert_eq!(removed, 0);
    assert!(link.exists());
    assert_eq!(std::fs::read(&sentinel).unwrap(), b"keep");
}

#[test]
fn reaper_releases_expired_jobs_and_stops_after_state_drop() {
    let root = tempfile::tempdir().unwrap();
    let policy = PdfJobPolicy {
        idle_ttl: Duration::ZERO,
        ..PdfJobPolicy::default()
    };
    let jobs = Arc::new(Mutex::new(PdfExportJobs::with_policy(policy)));
    jobs.lock()
        .unwrap()
        .begin("main", SNAPSHOT, root.path().join("out.pdf"), 1)
        .unwrap();
    let weak = Arc::downgrade(&jobs);

    assert!(reap_once(&weak));
    assert_eq!(jobs.lock().unwrap().discard_for_window("main"), 0);
    drop(jobs);
    assert!(!reap_once(&weak));
}

#[cfg(windows)]
#[test]
fn windows_junctions_are_preserved_without_touching_target() {
    use std::os::windows::fs::MetadataExt;

    for nested in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let sentinel = target.path().join("page-00000000.svg");
        std::fs::write(&sentinel, b"keep-target").unwrap();
        let candidate = product_dir(root.path(), "junction");
        let link = if nested {
            std::fs::create_dir(&candidate).unwrap();
            std::fs::write(candidate.join("page-00000000.svg"), b"keep-local").unwrap();
            candidate.join("page-00000001.svg")
        } else {
            candidate.clone()
        };
        create_windows_junction(&link, target.path());
        let safe = product_dir(root.path(), "safe-control");
        std::fs::create_dir(&safe).unwrap();
        std::fs::write(safe.join("page-00000000.svg"), b"remove-control").unwrap();

        let removed = cleanup_orphan_pdf_temp_dirs_at(
            root.path(),
            SystemTime::now() + Duration::from_secs(2 * 24 * 60 * 60),
            OrphanCleanupPolicy::default(),
        )
        .unwrap();

        assert_eq!(removed, 1);
        assert!(!safe.exists());
        let metadata = std::fs::symlink_metadata(&link).unwrap();
        assert_ne!(metadata.file_attributes() & 0x400, 0);
        assert!(is_link_or_reparse(&metadata));
        assert_eq!(std::fs::read(&sentinel).unwrap(), b"keep-target");
        if nested {
            assert_eq!(
                std::fs::read(candidate.join("page-00000000.svg")).unwrap(),
                b"keep-local"
            );
        }
        // Remove only the test junction, never recurse into its target.
        std::fs::remove_dir(&link).unwrap();
        assert_eq!(std::fs::read(&sentinel).unwrap(), b"keep-target");
    }
}

#[cfg(windows)]
fn create_windows_junction(link: &Path, target: &Path) {
    let status = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command",
            "New-Item -ItemType Junction -Path $env:HWPLY_TEST_LINK -Target $env:HWPLY_TEST_TARGET -ErrorAction Stop | Out-Null"])
        .env("HWPLY_TEST_LINK", link)
        .env("HWPLY_TEST_TARGET", target)
        .status()
        .unwrap();
    assert!(status.success(), "Windows junction fixture creation failed");
}

fn product_dir(root: &Path, suffix: &str) -> PathBuf {
    root.join(format!("{PDF_TEMP_PREFIX}{suffix}"))
}
