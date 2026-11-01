use std::collections::BTreeSet;
use ttf_parser::{name_id, Face, Language};

#[derive(Default)]
pub(crate) struct FaceNames {
    pub full_name: Option<String>,
    pub aliases: Vec<String>,
}

/// Keep legacy/full face names alongside fontdb's preferred typographic family.
/// A family such as NanumSquare alone cannot identify its Bold face.
pub(crate) fn read_face_names(data: &[u8], index: u32) -> FaceNames {
    let Ok(face) = Face::parse(data, index) else {
        return FaceNames::default();
    };
    let mut aliases = BTreeSet::new();
    let mut full_name = None;
    for name in face.names() {
        if !matches!(
            name.name_id,
            name_id::FAMILY
                | name_id::FULL_NAME
                | name_id::TYPOGRAPHIC_FAMILY
                | name_id::POST_SCRIPT_NAME
        ) {
            continue;
        }
        let Some(value) = name.to_string() else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() || value.chars().any(char::is_control) {
            continue;
        }
        aliases.insert(value.to_string());
        if name.name_id == name_id::FULL_NAME
            && (full_name.is_none() || name.language() == Language::English_UnitedStates)
        {
            full_name = Some(value.to_string());
        }
    }
    FaceNames {
        full_name,
        aliases: aliases.into_iter().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const BOLD: &[u8] =
        include_bytes!("../../../../tests/gui/local-fonts/nanumsquare/NanumSquareB.ttf");

    #[test]
    fn preserves_actual_korean_and_english_bold_face_names() {
        let names = read_face_names(BOLD, 0);
        assert_eq!(names.full_name.as_deref(), Some("NanumSquare Bold"));
        for alias in [
            "나눔스퀘어 Bold",
            "NanumSquare Bold",
            "나눔스퀘어",
            "NanumSquare",
            "NanumSquareB",
        ] {
            assert!(names.aliases.iter().any(|value| value == alias), "{alias}");
        }
        assert!(!names.aliases.iter().any(|value| value.contains("Regular")));
        assert_eq!(Face::parse(BOLD, 0).unwrap().weight().to_number(), 700);
    }

    #[test]
    fn malformed_data_has_no_invented_names() {
        let names = read_face_names(b"not a font", 0);
        assert!(names.aliases.is_empty());
        assert!(names.full_name.is_none());
    }
}
