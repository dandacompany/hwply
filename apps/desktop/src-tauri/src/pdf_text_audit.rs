use usvg::{Group, ImageKind, Node, Tree};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SvgTextAudit {
    pub source_elements: usize,
    pub parsed_elements: usize,
    pub positioned_glyphs: usize,
}

pub(crate) fn audit_svg_text(svg: &str, tree: &Tree) -> Result<SvgTextAudit, String> {
    let source_elements = source_text_element_count(svg)?;
    let mut audit = SvgTextAudit {
        source_elements,
        parsed_elements: 0,
        positioned_glyphs: 0,
    };
    let mut missing_glyphs = 0;
    inspect_group(tree.root(), &mut audit, &mut missing_glyphs);

    if audit.parsed_elements < audit.source_elements {
        return Err(format!(
            "SVG 텍스트가 font 해석 중 누락됐습니다: source {}, parsed {}",
            audit.source_elements, audit.parsed_elements
        ));
    }
    if audit.source_elements > 0 && audit.positioned_glyphs == 0 {
        return Err("SVG 텍스트에 배치 가능한 glyph가 없습니다".to_string());
    }
    if missing_glyphs > 0 {
        return Err(format!(
            "SVG 텍스트에 표시할 수 없는 glyph가 있습니다: {}개",
            missing_glyphs
        ));
    }

    Ok(audit)
}

pub(crate) fn pdf_has_to_unicode(bytes: &[u8]) -> bool {
    bytes
        .windows(b"/ToUnicode".len())
        .any(|window| window == b"/ToUnicode")
}

fn source_text_element_count(svg: &str) -> Result<usize, String> {
    let document = roxmltree::Document::parse(svg)
        .map_err(|error| format!("SVG text audit 파싱 실패: {}", error))?;
    Ok(document
        .descendants()
        .filter(|node| {
            node.is_element()
                && node.tag_name().name() == "text"
                && node
                    .descendants()
                    .filter_map(|descendant| descendant.text())
                    .any(|text| !text.trim().is_empty())
        })
        .count())
}

fn inspect_group(group: &Group, audit: &mut SvgTextAudit, missing_glyphs: &mut usize) {
    for node in group.children() {
        match node {
            Node::Group(group) => inspect_group(group, audit, missing_glyphs),
            Node::Image(image) => {
                if let ImageKind::SVG(tree) = image.kind() {
                    inspect_group(tree.root(), audit, missing_glyphs);
                }
            }
            Node::Text(text) => {
                audit.parsed_elements += 1;
                for span in text.layouted() {
                    audit.positioned_glyphs += span.positioned_glyphs.len();
                    *missing_glyphs += span
                        .positioned_glyphs
                        .iter()
                        .filter(|glyph| glyph.id.0 == 0)
                        .count();
                }
            }
            Node::Path(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_rejects_text_dropped_when_no_font_can_be_resolved() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><text x="0" y="30" font-family="없는 글꼴">한글</text></svg>"#;
        let tree = Tree::from_str(svg, &usvg::Options::default()).unwrap();

        let error = audit_svg_text(svg, &tree).unwrap_err();

        assert!(error.contains("font 해석 중 누락"));
    }

    #[test]
    fn to_unicode_marker_is_required_for_searchable_output() {
        assert!(pdf_has_to_unicode(b"<</ToUnicode 10 0 R>>"));
        assert!(!pdf_has_to_unicode(b"<</Subtype /Type3>>"));
    }
}
