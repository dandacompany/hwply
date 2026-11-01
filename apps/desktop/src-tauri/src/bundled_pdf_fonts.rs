use usvg::fontdb;

pub(crate) const PDF_SANS_FAMILY: &str = "Noto Sans KR";
pub(crate) const PDF_SERIF_FAMILY: &str = "Noto Serif KR";

const PDF_SANS_BYTES: &[u8] = include_bytes!("../../../../assets/fonts/pdf/NotoSansKR-Regular.otf");
const PDF_SERIF_BYTES: &[u8] =
    include_bytes!("../../../../assets/fonts/pdf/NotoSerifKR-Regular.otf");

pub(crate) fn load_into(fontdb: &mut fontdb::Database) {
    fontdb.load_font_data(PDF_SANS_BYTES.to_vec());
    fontdb.load_font_data(PDF_SERIF_BYTES.to_vec());
}

pub(crate) fn apply_generic_defaults(fontdb: &mut fontdb::Database) {
    fontdb.set_serif_family(PDF_SERIF_FAMILY);
    fontdb.set_sans_serif_family(PDF_SANS_FAMILY);
    fontdb.set_monospace_family(PDF_SANS_FAMILY);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use usvg::fontdb::{Family, Query};

    #[test]
    fn bundled_pdf_fonts_cover_korean_without_system_fonts() {
        let mut database = fontdb::Database::new();
        load_into(&mut database);
        apply_generic_defaults(&mut database);

        let serif = database
            .query(&Query {
                families: &[Family::Serif],
                ..Query::default()
            })
            .expect("bundled serif family");
        let sans = database
            .query(&Query {
                families: &[Family::SansSerif],
                ..Query::default()
            })
            .expect("bundled sans family");
        let monospace = database
            .query(&Query {
                families: &[Family::Monospace],
                ..Query::default()
            })
            .expect("bundled monospace coverage fallback");

        assert!(database
            .face(serif)
            .unwrap()
            .families
            .iter()
            .any(|(family, _)| family == PDF_SERIF_FAMILY));
        assert!(database
            .face(sans)
            .unwrap()
            .families
            .iter()
            .any(|(family, _)| family == PDF_SANS_FAMILY));
        assert!(database
            .face(monospace)
            .unwrap()
            .families
            .iter()
            .any(|(family, _)| family == PDF_SANS_FAMILY));

        let options = usvg::Options {
            fontdb: Arc::new(database),
            ..Default::default()
        };
        let tree = usvg::Tree::from_str(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><text x="0" y="20" font-family="serif">한글</text></svg>"#,
            &options,
        )
        .unwrap();
        let usvg::Node::Text(text) = &tree.root().children()[0] else {
            panic!("bundled serif did not preserve Korean text");
        };
        assert!(text
            .layouted()
            .iter()
            .flat_map(|span| &span.positioned_glyphs)
            .all(|glyph| glyph.id.0 != 0));
    }
}
