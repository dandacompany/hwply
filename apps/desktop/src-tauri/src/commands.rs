use crate::font_catalog::LocalFontEntry;
use crate::recent_documents::{self, RecentDocument};
use crate::state::{
    AppState, DocumentFormat, DocumentOpenResult, ExternalModificationStatus, FileFingerprint,
    MutationResult, PageSvgResult, SaveResult,
};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_fs::FsExt;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitStagedDocumentSaveRequest {
    doc_id: String,
    staged_path: String,
    target_path: String,
    format: DocumentFormat,
    expected_revision: Option<u64>,
    allow_external_overwrite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginPdfExportRequest {
    snapshot_id: String,
    target_path: String,
    page_count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendPdfPageRequest {
    job_id: String,
    snapshot_id: String,
    page_index: u32,
    svg: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportJobRequest {
    job_id: String,
    snapshot_id: String,
}

#[tauri::command]
pub fn create_document(state: State<'_, AppState>) -> Result<DocumentOpenResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .create_document()
}

#[tauri::command]
pub fn open_document_tracking(
    path: String,
    source_fingerprint: Option<FileFingerprint>,
    state: State<'_, AppState>,
) -> Result<DocumentOpenResult, String> {
    let path = PathBuf::from(path);
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .open_document_tracking(path, source_fingerprint)
}

#[tauri::command]
pub fn take_pending_open_paths(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    state
        .startup_open_taken
        .store(true, std::sync::atomic::Ordering::Relaxed);
    state.pending_open_paths.take_for_window(window.label())
}

#[tauri::command]
pub fn set_window_title(window: WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn print_current_webview(window: WebviewWindow) -> Result<(), String> {
    crate::system_print::print_current_webview(window).await
}

#[tauri::command]
pub fn prepare_document_open(app: AppHandle, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    ensure_document_open_path(&path)?;
    allow_frontend_fs_file(&app, &path)
}

#[tauri::command]
pub fn close_document(doc_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .close_document(&doc_id)
}

#[tauri::command]
pub fn mark_document_dirty(doc_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .mark_document_dirty(&doc_id)
}

#[tauri::command]
pub fn prepare_staged_document_save(
    app: AppHandle,
    target_path: String,
    format: DocumentFormat,
) -> Result<String, String> {
    prepare_staged_file(
        &app,
        PathBuf::from(target_path),
        |path| ensure_document_target_path(path, format),
        staged_document_save_path,
    )
}

#[tauri::command]
pub fn commit_staged_document_save(
    app: AppHandle,
    request: CommitStagedDocumentSaveRequest,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    let CommitStagedDocumentSaveRequest {
        doc_id,
        staged_path,
        target_path,
        format,
        expected_revision,
        allow_external_overwrite,
    } = request;
    let target_path = PathBuf::from(target_path);
    let result = state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .commit_staged_document_save(
            &doc_id,
            PathBuf::from(staged_path),
            target_path.clone(),
            format,
            expected_revision,
            allow_external_overwrite.unwrap_or(false),
        )?;
    let _ = recent_documents::record_document(&app, &target_path);
    Ok(result)
}

#[tauri::command]
pub fn list_recent_documents(app: AppHandle) -> Result<Vec<RecentDocument>, String> {
    recent_documents::list_documents(&app)
}

#[tauri::command]
pub fn clear_recent_documents(app: AppHandle) -> Result<(), String> {
    recent_documents::clear_documents(&app)
}

#[tauri::command]
pub fn record_recent_document(app: AppHandle, path: String) -> Result<(), String> {
    recent_documents::record_document(&app, &PathBuf::from(path))
}

#[tauri::command]
pub fn remove_recent_document(app: AppHandle, path: String) -> Result<(), String> {
    recent_documents::remove_document(&app, &PathBuf::from(path))
}

#[tauri::command]
pub fn check_external_modification(
    doc_id: String,
    target_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<ExternalModificationStatus, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .external_modification_status(&doc_id, target_path.map(PathBuf::from))
}

#[tauri::command]
pub fn render_page_svg(
    doc_id: String,
    page_index: u32,
    revision: Option<u64>,
    state: State<'_, AppState>,
) -> Result<PageSvgResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .render_page_svg(&doc_id, page_index, revision)
}

#[tauri::command]
pub fn query_document(
    doc_id: String,
    query: String,
    args: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?;
    sessions.query_document(&doc_id, &query, args)
}

#[tauri::command]
pub fn mutate_document(
    doc_id: String,
    operation: String,
    args: Value,
    expected_revision: Option<u64>,
    state: State<'_, AppState>,
) -> Result<MutationResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .mutate_document(&doc_id, &operation, args, expected_revision)
}

#[tauri::command]
pub fn begin_pdf_export(
    request: BeginPdfExportRequest,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let BeginPdfExportRequest {
        snapshot_id,
        target_path,
        page_count,
    } = request;
    state
        .pdf_jobs
        .lock()
        .map_err(|_| "PDF 작업 잠금 실패".to_string())?
        .begin(
            window.label(),
            &snapshot_id,
            PathBuf::from(target_path),
            page_count,
        )
}

#[tauri::command]
pub fn append_pdf_page(
    request: AppendPdfPageRequest,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let AppendPdfPageRequest {
        job_id,
        snapshot_id,
        page_index,
        svg,
    } = request;
    state
        .pdf_jobs
        .lock()
        .map_err(|_| "PDF 작업 잠금 실패".to_string())?
        .append_page(window.label(), &job_id, &snapshot_id, page_index, &svg)
}

#[tauri::command]
pub fn commit_pdf_export(
    request: PdfExportJobRequest,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<crate::pdf_export::PdfExportResult, String> {
    let PdfExportJobRequest {
        job_id,
        snapshot_id,
    } = request;
    state
        .pdf_jobs
        .lock()
        .map_err(|_| "PDF 작업 잠금 실패".to_string())?
        .commit(window.label(), &job_id, &snapshot_id)
}

#[tauri::command]
pub fn abort_pdf_export(
    request: PdfExportJobRequest,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let PdfExportJobRequest {
        job_id,
        snapshot_id,
    } = request;
    state
        .pdf_jobs
        .lock()
        .map_err(|_| "PDF 작업 잠금 실패".to_string())?
        .abort(window.label(), &job_id, &snapshot_id)
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let reveal_path = if path.is_dir() {
        path.as_path()
    } else {
        path.parent()
            .ok_or_else(|| format!("파일 위치를 찾을 수 없습니다: {}", path.display()))?
    };
    if !reveal_path.is_dir() {
        return Err(format!(
            "파일 위치가 로컬 디렉터리가 아닙니다: {}",
            reveal_path.display()
        ));
    }
    open::that(reveal_path).map_err(|e| format!("파일 위치를 열 수 없습니다: {}", e))
}

#[tauri::command]
pub fn destroy_current_window(window: WebviewWindow) -> Result<(), String> {
    window
        .destroy()
        .map_err(|e| format!("창을 닫을 수 없습니다: {}", e))
}

#[tauri::command]
pub fn list_local_fonts() -> Result<Vec<LocalFontEntry>, String> {
    Ok(crate::font_catalog::collect_desktop_local_font_entries())
}

#[tauri::command]
pub fn read_local_font(path: String) -> Result<Vec<u8>, String> {
    crate::font_catalog::read_desktop_local_font(Path::new(&path))
}

fn allow_frontend_fs_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    let scope = app.fs_scope();
    scope
        .allow_file(path)
        .map_err(|e| format!("filesystem scope 갱신 실패: {}", e))?;
    Ok(())
}

fn prepare_staged_file<F>(
    app: &AppHandle,
    target_path: PathBuf,
    validate_target: F,
    build_staged_path: fn(&Path) -> Result<PathBuf, String>,
) -> Result<String, String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    validate_target(&target_path)?;
    let staged_path = build_staged_path(&target_path)?;
    allow_frontend_fs_file(app, &staged_path)?;
    Ok(staged_path.to_string_lossy().to_string())
}

fn ensure_document_open_path(path: &Path) -> Result<(), String> {
    DocumentFormat::from_path(path)?;
    if !path.is_file() {
        return Err(format!("문서 파일을 찾을 수 없습니다: {}", path.display()));
    }
    Ok(())
}

fn ensure_document_target_path(
    path: &Path,
    requested_format: DocumentFormat,
) -> Result<(), String> {
    ensure_target_parent(path, "저장 경로")?;
    let target_format = DocumentFormat::from_path(path)?;
    if target_format != requested_format {
        return Err(format!(
            "요청한 저장 형식({:?})과 대상 확장자({:?})가 일치하지 않습니다",
            requested_format, target_format
        ));
    }
    Ok(())
}

fn staged_document_save_path(target_path: &Path) -> Result<PathBuf, String> {
    staged_sibling_path(target_path, ".hwply-save-", ".tmp")
}

fn ensure_target_parent(path: &Path, context: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| {
            format!(
                "{}의 상위 디렉터리를 찾을 수 없습니다: {}",
                context,
                path.display()
            )
        })?;
    if !parent.is_dir() {
        return Err(format!(
            "{}의 상위 디렉터리가 유효하지 않습니다: {}",
            context,
            parent.display()
        ));
    }
    Ok(())
}

fn staged_sibling_path(target_path: &Path, marker: &str, suffix: &str) -> Result<PathBuf, String> {
    let file_name = target_path.file_name().ok_or_else(|| {
        format!(
            "저장 경로의 파일 이름을 찾을 수 없습니다: {}",
            target_path.display()
        )
    })?;
    let mut staged_name = file_name.to_os_string();
    staged_name.push(format!("{}{}{}", marker, Uuid::new_v4().simple(), suffix));
    Ok(target_path.with_file_name(staged_name))
}

#[tauri::command]
pub async fn create_editor_window(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::windows::create_editor_window(&app))
        .await
        .map_err(|e| format!("새 창 생성 작업 실패: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_document_target_path_accepts_matching_hwp_and_hwpx_extensions() {
        let dir = tempfile::tempdir().unwrap();

        assert!(
            ensure_document_target_path(&dir.path().join("saved.hwp"), DocumentFormat::Hwp).is_ok()
        );
        assert!(
            ensure_document_target_path(&dir.path().join("saved.hwpx"), DocumentFormat::Hwpx)
                .is_ok()
        );
    }

    #[test]
    fn ensure_document_open_path_accepts_existing_hwp_and_hwpx_files() {
        let dir = tempfile::tempdir().unwrap();
        let hwp = dir.path().join("source.hwp");
        let hwpx = dir.path().join("source.hwpx");
        std::fs::write(&hwp, b"hwp").unwrap();
        std::fs::write(&hwpx, b"hwpx").unwrap();

        assert!(ensure_document_open_path(&hwp).is_ok());
        assert!(ensure_document_open_path(&hwpx).is_ok());
    }

    #[test]
    fn ensure_document_open_path_rejects_missing_and_unsupported_files() {
        let dir = tempfile::tempdir().unwrap();
        let txt = dir.path().join("source.txt");
        std::fs::write(&txt, b"text").unwrap();

        assert!(ensure_document_open_path(&dir.path().join("missing.hwp")).is_err());
        assert!(ensure_document_open_path(&txt).is_err());
    }

    #[test]
    fn ensure_document_target_path_rejects_invalid_parent_and_format_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let missing_parent = dir.path().join("missing").join("saved.hwp");

        assert!(ensure_document_target_path(&missing_parent, DocumentFormat::Hwp).is_err());
        assert!(
            ensure_document_target_path(&dir.path().join("saved.hwpx"), DocumentFormat::Hwp)
                .is_err()
        );
    }

    #[test]
    fn staged_document_save_path_keeps_parent_and_adds_unique_suffix() {
        let dir = tempfile::tempdir().unwrap();
        let target_path = dir.path().join("saved.hwp");

        let staged_path = staged_document_save_path(&target_path).unwrap();

        assert_eq!(staged_path.parent(), target_path.parent());
        assert_ne!(staged_path, target_path);
        assert!(staged_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("saved.hwp.hwply-save-"));
        assert!(staged_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".tmp"));
    }
}
