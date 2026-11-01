use crate::pdf_jobs::PdfExportJobs;
use std::ffi::OsStr;
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, Weak};
use std::time::{Duration, Instant, SystemTime};
use uuid::Uuid;

pub(crate) const PDF_TEMP_PREFIX: &str = ".hwply-pdf-";
const MAX_PDF_EXPORT_PAGES: u32 = 4_096;
const MAX_PDF_PAGE_SVG_BYTES: usize = 16 * 1024 * 1024;
const MAX_PDF_JOB_SVG_BYTES: usize = 512 * 1024 * 1024;
const MAX_ACTIVE_PDF_JOBS: usize = 4;
const PDF_JOB_IDLE_TTL: Duration = Duration::from_secs(5 * 60);
const PDF_JOB_MAX_LIFETIME: Duration = Duration::from_secs(15 * 60);
const PDF_JOB_REAPER_INTERVAL: Duration = Duration::from_secs(30);
const ORPHAN_MIN_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_ORPHAN_SCAN_ENTRIES: usize = 4_096;
const MAX_ORPHAN_REMOVALS: usize = 64;
const MAX_ORPHAN_CHILD_ENTRIES: usize = 4_096;

#[derive(Clone, Copy)]
pub(crate) struct PdfJobPolicy {
    pub(crate) max_pages: u32,
    pub(crate) max_page_svg_bytes: usize,
    pub(crate) max_job_svg_bytes: usize,
    pub(crate) max_active_jobs: usize,
    pub(crate) idle_ttl: Duration,
    pub(crate) max_lifetime: Duration,
}

impl Default for PdfJobPolicy {
    fn default() -> Self {
        Self {
            max_pages: MAX_PDF_EXPORT_PAGES,
            max_page_svg_bytes: MAX_PDF_PAGE_SVG_BYTES,
            max_job_svg_bytes: MAX_PDF_JOB_SVG_BYTES,
            max_active_jobs: MAX_ACTIVE_PDF_JOBS,
            idle_ttl: PDF_JOB_IDLE_TTL,
            max_lifetime: PDF_JOB_MAX_LIFETIME,
        }
    }
}

impl PdfJobPolicy {
    pub(crate) fn validate_page_count(self, page_count: u32) -> Result<(), String> {
        if page_count == 0 {
            return Err("PDF로 저장할 페이지가 없습니다".to_string());
        }
        if page_count > self.max_pages {
            return Err(format!(
                "PDF 페이지는 {}쪽까지 저장할 수 있습니다",
                self.max_pages
            ));
        }
        Ok(())
    }

    pub(crate) fn parse_snapshot_id(self, snapshot_id: &str) -> Result<Uuid, String> {
        Uuid::parse_str(snapshot_id).map_err(|_| "PDF snapshot ID가 올바르지 않습니다".to_string())
    }

    pub(crate) fn same_target_path(self, left: &Path, right: &Path) -> bool {
        if cfg!(windows) {
            left.to_string_lossy()
                .eq_ignore_ascii_case(&right.to_string_lossy())
        } else {
            left == right
        }
    }

    pub(crate) fn is_job_expired(
        self,
        created_at: Instant,
        last_activity: Instant,
        now: Instant,
    ) -> bool {
        elapsed(now, last_activity) >= self.idle_ttl
            || elapsed(now, created_at) >= self.max_lifetime
    }
}

#[derive(Clone, Copy)]
struct OrphanCleanupPolicy {
    min_age: Duration,
    max_scan_entries: usize,
    max_removals: usize,
    max_child_entries: usize,
}

impl Default for OrphanCleanupPolicy {
    fn default() -> Self {
        Self {
            min_age: ORPHAN_MIN_AGE,
            max_scan_entries: MAX_ORPHAN_SCAN_ENTRIES,
            max_removals: MAX_ORPHAN_REMOVALS,
            max_child_entries: MAX_ORPHAN_CHILD_ENTRIES,
        }
    }
}

pub(crate) fn spawn_pdf_job_reaper(jobs: Weak<Mutex<PdfExportJobs>>) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("hwply-pdf-job-reaper".to_string())
        .spawn(move || loop {
            std::thread::sleep(PDF_JOB_REAPER_INTERVAL);
            if !reap_once(&jobs) {
                break;
            }
        })
        .map(|_| ())
}

fn reap_once(jobs: &Weak<Mutex<PdfExportJobs>>) -> bool {
    let Some(jobs) = jobs.upgrade() else {
        return false;
    };
    let Ok(mut jobs) = jobs.lock() else {
        return false;
    };
    jobs.prune_expired();
    true
}

pub(crate) fn cleanup_orphan_pdf_temp_dirs() -> Result<usize, String> {
    cleanup_orphan_pdf_temp_dirs_at(
        &std::env::temp_dir(),
        SystemTime::now(),
        OrphanCleanupPolicy::default(),
    )
}

fn cleanup_orphan_pdf_temp_dirs_at(
    temp_root: &Path,
    now: SystemTime,
    policy: OrphanCleanupPolicy,
) -> Result<usize, String> {
    let entries = fs::read_dir(temp_root)
        .map_err(|_| "PDF 임시 디렉터리 목록을 읽을 수 없습니다".to_string())?;
    let mut removed = 0;
    for entry in entries.take(policy.max_scan_entries) {
        if removed >= policy.max_removals {
            break;
        }
        let Ok(entry) = entry else {
            continue;
        };
        if !is_product_temp_name(&entry.file_name()) {
            continue;
        }
        let path = entry.path();
        let Some(page_files) = safe_orphan_page_files(&path, now, policy) else {
            continue;
        };
        if remove_safe_orphan(&path, &page_files).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

fn safe_orphan_page_files(
    path: &Path,
    now: SystemTime,
    policy: OrphanCleanupPolicy,
) -> Option<Vec<PathBuf>> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if is_link_or_reparse(&metadata) || !metadata.is_dir() {
        return None;
    }
    let age = now.duration_since(metadata.modified().ok()?).ok()?;
    if age < policy.min_age {
        return None;
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(path).ok()? {
        if files.len() >= policy.max_child_entries {
            return None;
        }
        let entry = entry.ok()?;
        let metadata = fs::symlink_metadata(entry.path()).ok()?;
        if is_link_or_reparse(&metadata)
            || !metadata.is_file()
            || !is_page_svg_name(&entry.file_name())
        {
            return None;
        }
        files.push(entry.path());
    }
    Some(files)
}

fn remove_safe_orphan(directory: &Path, page_files: &[PathBuf]) -> std::io::Result<()> {
    for page_file in page_files {
        assert_real_directory(directory)?;
        let metadata = fs::symlink_metadata(page_file)?;
        if is_link_or_reparse(&metadata)
            || !metadata.is_file()
            || !is_page_svg_name(page_file.file_name().unwrap_or_default())
        {
            return Err(std::io::Error::other("unsafe PDF orphan entry"));
        }
        fs::remove_file(page_file)?;
    }
    assert_real_directory(directory)?;
    fs::remove_dir(directory)
}

fn assert_real_directory(path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if is_link_or_reparse(&metadata) || !metadata.is_dir() {
        return Err(std::io::Error::other("unsafe PDF orphan directory"));
    }
    Ok(())
}

fn is_product_temp_name(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    let Some(suffix) = name.strip_prefix(PDF_TEMP_PREFIX) else {
        return false;
    };
    !suffix.is_empty()
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn is_page_svg_name(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    name.len() == 17
        && name.starts_with("page-")
        && name.ends_with(".svg")
        && name[5..13].bytes().all(|byte| byte.is_ascii_digit())
}

fn is_link_or_reparse(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn elapsed(now: Instant, earlier: Instant) -> Duration {
    now.checked_duration_since(earlier).unwrap_or_default()
}

#[cfg(test)]
#[path = "pdf_temp_cleanup_tests.rs"]
mod tests;
