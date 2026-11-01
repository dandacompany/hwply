use pdf_writer::{Finish, Pdf, Ref};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::font_catalog;
use crate::pdf_text_audit;
use crate::state::atomic_write;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PdfTextMode {
    Searchable,
    OutlinedFallback,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportResult {
    pub path: String,
    pub page_count: u32,
    pub text_mode: PdfTextMode,
    pub warning: Option<String>,
}

struct PreparedPage {
    tree: usvg::Tree,
    width: f32,
    height: f32,
    source_text_elements: usize,
}

pub fn export_svg_pages_to_pdf(
    svg_paths: &[PathBuf],
    target_path: &Path,
) -> Result<PdfExportResult, String> {
    ensure_pdf_path(target_path)?;
    let pages = prepare_pdf_pages(svg_paths)?;
    let (bytes, text_mode, warning) = match render_pdf(&pages, true) {
        Ok(bytes) => (bytes, PdfTextMode::Searchable, None),
        Err(searchable_error) => {
            let bytes = render_pdf(&pages, false).map_err(|fallback_error| {
                format!(
                    "검색 가능한 PDF 변환 실패: {}; 글자 윤곽선 fallback 실패: {}",
                    searchable_error, fallback_error
                )
            })?;
            (
                bytes,
                PdfTextMode::OutlinedFallback,
                Some(format!(
                    "검색 가능한 텍스트 변환에 실패해 글자 윤곽선으로 저장했습니다: {}",
                    searchable_error
                )),
            )
        }
    };
    atomic_write(target_path, &bytes)?;
    Ok(PdfExportResult {
        path: target_path.to_string_lossy().to_string(),
        page_count: svg_paths.len() as u32,
        text_mode,
        warning,
    })
}

pub(crate) fn ensure_pdf_path(path: &Path) -> Result<(), String> {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        != Some(true)
    {
        return Err("PDF 파일 경로는 .pdf 확장자여야 합니다".to_string());
    }
    Ok(())
}

fn conversion_options(embed_text: bool) -> svg2pdf::ConversionOptions {
    svg2pdf::ConversionOptions {
        embed_text,
        ..svg2pdf::ConversionOptions::default()
    }
}

fn pdf_usvg_options() -> usvg::Options<'static> {
    usvg::Options {
        fontdb: std::sync::Arc::new(font_catalog::create_pdf_font_database()),
        ..Default::default()
    }
}

fn parse_svg_tree_for_pdf(
    svg_content: &str,
    options: &usvg::Options<'static>,
) -> Result<usvg::Tree, String> {
    usvg::Tree::from_str(svg_content, options).map_err(|e| format!("SVG 파싱 실패: {}", e))
}

fn prepare_pdf_pages(svg_paths: &[PathBuf]) -> Result<Vec<PreparedPage>, String> {
    if svg_paths.is_empty() {
        return Err("페이지가 없습니다".to_string());
    }
    let options = pdf_usvg_options();
    let mut pages = Vec::with_capacity(svg_paths.len());
    for path in svg_paths {
        let svg = std::fs::read_to_string(path)
            .map_err(|e| format!("PDF 페이지 SVG 읽기 실패: {} ({})", path.display(), e))?;
        let tree = parse_svg_tree_for_pdf(&svg, &options)?;
        let audit = pdf_text_audit::audit_svg_text(&svg, &tree).map_err(|error| {
            format!(
                "PDF 페이지 SVG text audit 실패: {} ({})",
                path.display(),
                error
            )
        })?;
        let dpi_ratio = 72.0 / 96.0;
        let width = tree.size().width() * dpi_ratio;
        let height = tree.size().height() * dpi_ratio;
        pages.push(PreparedPage {
            tree,
            width,
            height,
            source_text_elements: audit.source_elements,
        });
    }
    Ok(pages)
}

fn render_pdf(pages: &[PreparedPage], embed_text: bool) -> Result<Vec<u8>, String> {
    let mut alloc = Ref::new(1);
    let catalog_ref = alloc.bump();
    let page_tree_ref = alloc.bump();

    struct PageData {
        chunk: pdf_writer::Chunk,
        svg_ref: Ref,
        width: f32,
        height: f32,
    }

    let mut page_data = Vec::with_capacity(pages.len());
    for page in pages {
        let (chunk, svg_ref) = svg2pdf::to_chunk(&page.tree, conversion_options(embed_text))
            .map_err(|e| format!("SVG->PDF chunk 변환 실패: {:?}", e))?;
        page_data.push(PageData {
            chunk,
            svg_ref,
            width: page.width,
            height: page.height,
        });
    }

    let mut page_refs = Vec::with_capacity(page_data.len());
    let mut renumbered_chunks = Vec::with_capacity(page_data.len());
    let mut remapped_svg_refs = Vec::with_capacity(page_data.len());
    for data in &page_data {
        page_refs.push(alloc.bump());
        let mut map = HashMap::new();
        let chunk = data
            .chunk
            .renumber(|old| *map.entry(old).or_insert_with(|| alloc.bump()));
        remapped_svg_refs.push(map.get(&data.svg_ref).copied().unwrap_or(data.svg_ref));
        renumbered_chunks.push(chunk);
    }

    let mut pdf = Pdf::new();
    pdf.catalog(catalog_ref).pages(page_tree_ref);
    pdf.pages(page_tree_ref)
        .count(page_refs.len() as i32)
        .kids(page_refs.iter().copied());
    let svg_name = pdf_writer::Name(b"S1");

    for (index, data) in page_data.iter().enumerate() {
        let content_ref = alloc.bump();
        let mut page = pdf.page(page_refs[index]);
        page.media_box(pdf_writer::Rect::new(0.0, 0.0, data.width, data.height));
        page.parent(page_tree_ref);
        page.contents(content_ref);
        let mut resources = page.resources();
        resources
            .x_objects()
            .pair(svg_name, remapped_svg_refs[index]);
        resources.finish();
        page.finish();

        let mut content = pdf_writer::Content::new();
        content.transform([data.width, 0.0, 0.0, data.height, 0.0, 0.0]);
        content.x_object(svg_name);
        pdf.stream(content_ref, &content.finish());
    }
    for chunk in &renumbered_chunks {
        pdf.extend(chunk);
    }
    let info_ref = alloc.bump();
    pdf.document_info(info_ref)
        .producer(pdf_writer::TextStr("hwply-desktop"));
    let bytes = pdf.finish();
    if embed_text
        && pages.iter().any(|page| page.source_text_elements > 0)
        && !pdf_text_audit::pdf_has_to_unicode(&bytes)
    {
        return Err("검색 가능한 PDF에 ToUnicode mapping이 없습니다".to_string());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_pdf_path_accepts_pdf_case_insensitively() {
        assert!(ensure_pdf_path(Path::new("out.pdf")).is_ok());
        assert!(ensure_pdf_path(Path::new("out.PDF")).is_ok());
    }

    #[test]
    fn ensure_pdf_path_rejects_non_pdf_paths() {
        assert_eq!(
            ensure_pdf_path(Path::new("out.hwp")).unwrap_err(),
            "PDF 파일 경로는 .pdf 확장자여야 합니다"
        );
    }

    #[test]
    fn render_pdf_rejects_an_empty_page_list() {
        let error = prepare_pdf_pages(&[]).err().unwrap();
        assert_eq!(error, "페이지가 없습니다");
    }

    #[test]
    fn searchable_conversion_is_the_primary_mode() {
        assert!(conversion_options(true).embed_text);
        assert!(!conversion_options(false).embed_text);
    }

    #[test]
    fn bundled_fonts_preserve_korean_text_and_to_unicode_mapping() {
        let dir = tempfile::tempdir().unwrap();
        let svg_path = dir.path().join("page.svg");
        std::fs::write(
            &svg_path,
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><text x="10" y="35" font-family="함초롬바탕, 바탕, serif">한글 Serif</text><text x="10" y="75" font-family="함초롬돋움, 맑은 고딕, sans-serif">한글 Sans</text></svg>"#,
        )
        .unwrap();

        let pages = prepare_pdf_pages(&[svg_path]).unwrap();
        let bytes = render_pdf(&pages, true).unwrap();

        assert_eq!(pages[0].source_text_elements, 2);
        assert!(pdf_text_audit::pdf_has_to_unicode(&bytes));
    }
}
