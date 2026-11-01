use crate::pdf_export::{self, PdfExportResult};
use crate::pdf_font_fallbacks::add_font_fallbacks;
use crate::pdf_temp_cleanup::{PdfJobPolicy, PDF_TEMP_PREFIX};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;
use tempfile::{Builder, TempDir};
use uuid::Uuid;

struct PdfExportJob {
    owner_label: String,
    snapshot_id: Uuid,
    target_path: PathBuf,
    temp_dir: TempDir,
    page_count: u32,
    page_paths: Vec<PathBuf>,
    svg_bytes: usize,
    created_at: Instant,
    last_activity: Instant,
}

#[derive(Default)]
pub struct PdfExportJobs {
    jobs: HashMap<String, PdfExportJob>,
    policy: PdfJobPolicy,
}

impl PdfExportJobs {
    pub fn begin(
        &mut self,
        owner_label: &str,
        snapshot_id: &str,
        target_path: PathBuf,
        page_count: u32,
    ) -> Result<String, String> {
        self.begin_at(
            owner_label,
            snapshot_id,
            target_path,
            page_count,
            Instant::now(),
        )
    }

    fn begin_at(
        &mut self,
        owner_label: &str,
        snapshot_id: &str,
        target_path: PathBuf,
        page_count: u32,
        now: Instant,
    ) -> Result<String, String> {
        let snapshot_id = self.policy.parse_snapshot_id(snapshot_id)?;
        self.policy.validate_page_count(page_count)?;
        pdf_export::ensure_pdf_path(&target_path)?;
        let parent = target_path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .ok_or_else(|| "PDF 경로의 상위 디렉터리를 찾을 수 없습니다".to_string())?;
        if !parent.is_dir() {
            return Err("PDF 경로의 상위 디렉터리가 유효하지 않습니다".to_string());
        }

        self.prune_expired_at(now);
        self.discard_for_window(owner_label);
        if self.jobs.len() >= self.policy.max_active_jobs {
            return Err(format!(
                "동시에 진행할 수 있는 PDF 작업은 {}개까지입니다",
                self.policy.max_active_jobs
            ));
        }
        let policy = self.policy;
        if self
            .jobs
            .values()
            .any(|job| policy.same_target_path(&job.target_path, &target_path))
        {
            return Err(format!(
                "같은 PDF 대상 경로의 저장 작업이 이미 진행 중입니다: {}",
                target_path.display()
            ));
        }

        let temp_dir = Builder::new()
            .prefix(PDF_TEMP_PREFIX)
            .tempdir()
            .map_err(|e| format!("PDF 임시 디렉터리 생성 실패: {}", e))?;
        let job_id = Uuid::new_v4().to_string();
        self.jobs.insert(
            job_id.clone(),
            PdfExportJob {
                owner_label: owner_label.to_string(),
                snapshot_id,
                target_path,
                temp_dir,
                page_count,
                page_paths: Vec::with_capacity(page_count as usize),
                svg_bytes: 0,
                created_at: now,
                last_activity: now,
            },
        );
        Ok(job_id)
    }

    pub fn append_page(
        &mut self,
        owner_label: &str,
        job_id: &str,
        snapshot_id: &str,
        page_index: u32,
        svg: &str,
    ) -> Result<(), String> {
        self.append_page_at(
            owner_label,
            job_id,
            snapshot_id,
            page_index,
            svg,
            Instant::now(),
        )
    }

    fn append_page_at(
        &mut self,
        owner_label: &str,
        job_id: &str,
        snapshot_id: &str,
        page_index: u32,
        svg: &str,
        now: Instant,
    ) -> Result<(), String> {
        self.prune_expired_at(now);
        self.ensure_owner(owner_label, job_id)?;
        let result = self.append_owned_page(job_id, snapshot_id, page_index, svg, now);
        if result.is_err() {
            self.jobs.remove(job_id);
        }
        result
    }

    fn append_owned_page(
        &mut self,
        job_id: &str,
        snapshot_id: &str,
        page_index: u32,
        svg: &str,
        now: Instant,
    ) -> Result<(), String> {
        let policy = self.policy;
        let snapshot_id = policy.parse_snapshot_id(snapshot_id)?;
        let job = self.jobs.get_mut(job_id).expect("owner-checked PDF job");
        ensure_snapshot(job, snapshot_id)?;

        let expected_index = job.page_paths.len() as u32;
        if page_index != expected_index || page_index >= job.page_count {
            return Err(format!(
                "PDF 페이지 순서가 올바르지 않습니다: expected {}, got {}",
                expected_index, page_index
            ));
        }
        if svg.len() > policy.max_page_svg_bytes {
            return Err("PDF 페이지 SVG가 16 MiB 제한을 초과했습니다".to_string());
        }
        let normalized = add_font_fallbacks(svg);
        if normalized.len() > policy.max_page_svg_bytes {
            return Err("PDF 페이지 normalized SVG가 16 MiB 제한을 초과했습니다".to_string());
        }
        let total_bytes = job
            .svg_bytes
            .checked_add(normalized.len())
            .filter(|total| *total <= policy.max_job_svg_bytes)
            .ok_or_else(|| "PDF 작업 SVG가 누적 512 MiB 제한을 초과했습니다".to_string())?;
        let path = job
            .temp_dir
            .path()
            .join(format!("page-{page_index:08}.svg"));
        std::fs::write(&path, normalized.as_bytes()).map_err(|e| {
            format!(
                "PDF 페이지 {} 임시 저장 실패: {} ({})",
                page_index + 1,
                path.display(),
                e
            )
        })?;
        job.page_paths.push(path);
        job.svg_bytes = total_bytes;
        job.last_activity = now;
        Ok(())
    }

    pub fn commit(
        &mut self,
        owner_label: &str,
        job_id: &str,
        snapshot_id: &str,
    ) -> Result<PdfExportResult, String> {
        self.prune_expired_at(Instant::now());
        self.ensure_owner(owner_label, job_id)?;
        let validation = self.validate_commit(job_id, snapshot_id);
        if let Err(error) = validation {
            self.jobs.remove(job_id);
            return Err(error);
        }
        let job = self.jobs.remove(job_id).expect("validated PDF job");
        pdf_export::export_svg_pages_to_pdf(&job.page_paths, &job.target_path)
    }

    fn validate_commit(&self, job_id: &str, snapshot_id: &str) -> Result<(), String> {
        let snapshot_id = self.policy.parse_snapshot_id(snapshot_id)?;
        let job = self.jobs.get(job_id).expect("owner-checked PDF job");
        ensure_snapshot(job, snapshot_id)?;
        if job.page_paths.len() != job.page_count as usize {
            return Err(format!(
                "PDF 페이지가 모두 준비되지 않았습니다: {} / {}",
                job.page_paths.len(),
                job.page_count
            ));
        }
        Ok(())
    }

    pub fn abort(
        &mut self,
        owner_label: &str,
        job_id: &str,
        snapshot_id: &str,
    ) -> Result<(), String> {
        self.prune_expired_at(Instant::now());
        self.ensure_owner(owner_label, job_id)?;
        let snapshot_id = self.policy.parse_snapshot_id(snapshot_id);
        let result = snapshot_id.and_then(|id| {
            ensure_snapshot(self.jobs.get(job_id).expect("owner-checked PDF job"), id)
        });
        self.jobs.remove(job_id);
        result
    }

    pub fn discard_for_window(&mut self, owner_label: &str) -> usize {
        let before = self.jobs.len();
        self.jobs
            .retain(|_, job| job.owner_label.as_str() != owner_label);
        before - self.jobs.len()
    }

    pub(crate) fn prune_expired(&mut self) -> usize {
        self.prune_expired_at(Instant::now())
    }

    fn prune_expired_at(&mut self, now: Instant) -> usize {
        let before = self.jobs.len();
        let policy = self.policy;
        self.jobs
            .retain(|_, job| !policy.is_job_expired(job.created_at, job.last_activity, now));
        before - self.jobs.len()
    }

    fn ensure_owner(&self, owner_label: &str, job_id: &str) -> Result<(), String> {
        let job = self
            .jobs
            .get(job_id)
            .ok_or_else(|| format!("PDF 작업을 찾을 수 없습니다: {}", job_id))?;
        if job.owner_label != owner_label {
            return Err(format!(
                "다른 창의 PDF 작업에는 접근할 수 없습니다: {}",
                job_id
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn with_policy(policy: PdfJobPolicy) -> Self {
        Self {
            jobs: HashMap::new(),
            policy,
        }
    }
}

fn ensure_snapshot(job: &PdfExportJob, snapshot_id: Uuid) -> Result<(), String> {
    if job.snapshot_id != snapshot_id {
        return Err("PDF 작업과 snapshot ID가 일치하지 않습니다".to_string());
    }
    Ok(())
}

#[cfg(test)]
#[path = "pdf_jobs_tests.rs"]
mod tests;
