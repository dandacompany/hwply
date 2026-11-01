use super::*;
use std::time::{Duration, Instant};

const SNAPSHOT_A: &str = "123e4567-e89b-42d3-a456-426614174000";
const SNAPSHOT_B: &str = "223e4567-e89b-42d3-a456-426614174000";

#[test]
fn valid_page_uses_normalized_svg_and_abort_cleans_temp() {
    let dir = tempfile::tempdir().unwrap();
    let mut jobs = PdfExportJobs::default();
    let job_id = jobs
        .begin("main", SNAPSHOT_A, dir.path().join("out.pdf"), 1)
        .unwrap();

    jobs.append_page(
        "main",
        &job_id,
        SNAPSHOT_A,
        0,
        r#"<svg><text font-family="HY헤드라인M">A</text></svg>"#,
    )
    .unwrap();
    let page_path = jobs.jobs[&job_id].page_paths[0].clone();
    let saved = std::fs::read_to_string(&page_path).unwrap();
    assert!(!saved.contains("HY헤드라인M"));
    assert!(saved.contains("함초롬돋움"));

    jobs.abort("main", &job_id, SNAPSHOT_A).unwrap();
    assert!(!page_path.exists());
}

#[test]
fn order_failure_discards_job_and_preserves_target() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("out.pdf");
    std::fs::write(&target, b"existing").unwrap();
    let mut jobs = PdfExportJobs::default();
    let job_id = jobs.begin("main", SNAPSHOT_A, target.clone(), 2).unwrap();
    let temp_path = jobs.jobs[&job_id].temp_dir.path().to_path_buf();

    assert!(jobs
        .append_page("main", &job_id, SNAPSHOT_A, 1, "<svg/>")
        .is_err());
    assert!(!jobs.jobs.contains_key(&job_id));
    assert!(!temp_path.exists());
    assert_eq!(std::fs::read(&target).unwrap(), b"existing");
}

#[test]
fn duplicate_page_discards_partial_job_and_preserves_target() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("out.pdf");
    std::fs::write(&target, b"existing").unwrap();
    let mut jobs = PdfExportJobs::default();
    let job_id = jobs.begin("main", SNAPSHOT_A, target.clone(), 2).unwrap();
    jobs.append_page("main", &job_id, SNAPSHOT_A, 0, "<svg/>")
        .unwrap();

    assert!(jobs
        .append_page("main", &job_id, SNAPSHOT_A, 0, "<svg/>")
        .is_err());
    assert!(!jobs.jobs.contains_key(&job_id));
    assert_eq!(std::fs::read(&target).unwrap(), b"existing");
}

#[test]
fn incomplete_commit_discards_job_and_preserves_target() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("out.pdf");
    std::fs::write(&target, b"existing").unwrap();
    let mut jobs = PdfExportJobs::default();
    let job_id = jobs.begin("main", SNAPSHOT_A, target.clone(), 2).unwrap();
    jobs.append_page("main", &job_id, SNAPSHOT_A, 0, "<svg/>")
        .unwrap();

    assert!(jobs.commit("main", &job_id, SNAPSHOT_A).is_err());
    assert!(!jobs.jobs.contains_key(&job_id));
    assert_eq!(std::fs::read(&target).unwrap(), b"existing");
}

#[test]
fn same_owner_begin_recovers_old_job_and_other_owner_keeps_target_lock() {
    let dir = tempfile::tempdir().unwrap();
    let mut jobs = PdfExportJobs::default();
    let first = jobs
        .begin("main", SNAPSHOT_A, dir.path().join("first.pdf"), 1)
        .unwrap();
    let first_temp = jobs.jobs[&first].temp_dir.path().to_path_buf();
    let second_target = dir.path().join("second.pdf");

    let second = jobs
        .begin("main", SNAPSHOT_B, second_target.clone(), 1)
        .unwrap();
    assert!(!jobs.jobs.contains_key(&first));
    assert!(!first_temp.exists());
    assert!(jobs.begin("other", SNAPSHOT_A, second_target, 1).is_err());
    assert!(jobs.jobs.contains_key(&second));
}

#[test]
fn foreign_owner_cannot_remove_job_but_owned_snapshot_mismatch_does() {
    let dir = tempfile::tempdir().unwrap();
    let mut jobs = PdfExportJobs::default();
    let job_id = jobs
        .begin("main", SNAPSHOT_A, dir.path().join("out.pdf"), 1)
        .unwrap();

    assert!(jobs
        .append_page("other", &job_id, SNAPSHOT_B, 0, "<svg/>")
        .is_err());
    assert!(jobs.jobs.contains_key(&job_id));
    assert!(jobs
        .append_page("main", &job_id, SNAPSHOT_B, 0, "<svg/>")
        .is_err());
    assert!(!jobs.jobs.contains_key(&job_id));
}

#[test]
fn page_count_and_active_job_limits_are_enforced() {
    let dir = tempfile::tempdir().unwrap();
    let policy = PdfJobPolicy {
        max_pages: 2,
        max_active_jobs: 2,
        ..PdfJobPolicy::default()
    };
    let mut jobs = PdfExportJobs::with_policy(policy);

    assert!(jobs
        .begin("invalid", "not-a-uuid", dir.path().join("invalid.pdf"), 1)
        .is_err());
    assert!(jobs
        .begin("empty", SNAPSHOT_A, dir.path().join("empty.pdf"), 0)
        .is_err());
    assert!(jobs
        .begin("oversized", SNAPSHOT_A, dir.path().join("large.pdf"), 3)
        .is_err());
    jobs.begin("one", SNAPSHOT_A, dir.path().join("one.pdf"), 2)
        .unwrap();
    jobs.begin("two", SNAPSHOT_B, dir.path().join("two.pdf"), 1)
        .unwrap();
    assert!(jobs
        .begin("three", SNAPSHOT_A, dir.path().join("three.pdf"), 1)
        .is_err());
}

#[test]
fn page_and_cumulative_svg_limits_discard_partial_jobs() {
    let dir = tempfile::tempdir().unwrap();
    let policy = PdfJobPolicy {
        max_pages: 3,
        max_page_svg_bytes: 6,
        max_job_svg_bytes: 12,
        ..PdfJobPolicy::default()
    };
    let mut jobs = PdfExportJobs::with_policy(policy);
    let large_target = dir.path().join("large.pdf");
    std::fs::write(&large_target, b"existing-large").unwrap();
    let oversized = jobs
        .begin("large", SNAPSHOT_A, large_target.clone(), 1)
        .unwrap();
    assert!(jobs
        .append_page("large", &oversized, SNAPSHOT_A, 0, "1234567")
        .is_err());
    assert!(!jobs.jobs.contains_key(&oversized));
    assert_eq!(std::fs::read(&large_target).unwrap(), b"existing-large");

    let total_target = dir.path().join("total.pdf");
    std::fs::write(&total_target, b"existing-total").unwrap();
    let cumulative = jobs
        .begin("total", SNAPSHOT_A, total_target.clone(), 3)
        .unwrap();
    jobs.append_page("total", &cumulative, SNAPSHOT_A, 0, "<svg/>")
        .unwrap();
    jobs.append_page("total", &cumulative, SNAPSHOT_A, 1, "<svg/>")
        .unwrap();
    assert!(jobs
        .append_page("total", &cumulative, SNAPSHOT_A, 2, "<svg/>")
        .is_err());
    assert!(!jobs.jobs.contains_key(&cumulative));
    assert_eq!(std::fs::read(&total_target).unwrap(), b"existing-total");
}

#[test]
fn idle_and_absolute_expiry_release_jobs_without_sleeping() {
    let dir = tempfile::tempdir().unwrap();
    let policy = PdfJobPolicy {
        max_pages: 4,
        idle_ttl: Duration::from_secs(5),
        max_lifetime: Duration::from_secs(15),
        ..PdfJobPolicy::default()
    };
    let started = Instant::now();
    let mut jobs = PdfExportJobs::with_policy(policy);
    let idle = jobs
        .begin_at("idle", SNAPSHOT_A, dir.path().join("idle.pdf"), 1, started)
        .unwrap();
    let idle_temp = jobs.jobs[&idle].temp_dir.path().to_path_buf();
    jobs.append_page_at(
        "idle",
        &idle,
        SNAPSHOT_A,
        0,
        "<svg/>",
        started + Duration::from_secs(4),
    )
    .unwrap();
    assert_eq!(jobs.prune_expired_at(started + Duration::from_secs(8)), 0);
    assert_eq!(jobs.prune_expired_at(started + Duration::from_secs(9)), 1);
    assert!(!idle_temp.exists());

    let absolute = jobs
        .begin_at(
            "absolute",
            SNAPSHOT_A,
            dir.path().join("absolute.pdf"),
            4,
            started,
        )
        .unwrap();
    for (index, seconds) in [4, 8, 12].into_iter().enumerate() {
        jobs.append_page_at(
            "absolute",
            &absolute,
            SNAPSHOT_A,
            index as u32,
            "<svg/>",
            started + Duration::from_secs(seconds),
        )
        .unwrap();
    }
    assert_eq!(jobs.prune_expired_at(started + Duration::from_secs(15)), 1);
}

#[test]
fn window_cleanup_releases_only_owned_jobs() {
    let dir = tempfile::tempdir().unwrap();
    let mut jobs = PdfExportJobs::default();
    let first = jobs
        .begin("main", SNAPSHOT_A, dir.path().join("out.pdf"), 1)
        .unwrap();
    let second = jobs
        .begin("other", SNAPSHOT_B, dir.path().join("other.pdf"), 1)
        .unwrap();

    assert_eq!(jobs.discard_for_window("main"), 1);
    assert!(!jobs.jobs.contains_key(&first));
    assert!(jobs.jobs.contains_key(&second));
}
