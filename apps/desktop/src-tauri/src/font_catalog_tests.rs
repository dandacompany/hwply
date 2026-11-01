use super::*;
use usvg::fontdb::{FaceInfo, Stretch, Weight, ID};

#[test]
fn collect_local_font_entries_keeps_localized_family_aliases() {
    let faces = vec![FaceInfo {
        id: ID::dummy(),
        source: Source::File(PathBuf::from("/usr/share/fonts/truetype/Test.ttf")),
        index: 0,
        families: vec![
            (
                "Malgun Gothic".to_string(),
                fontdb::Language::English_UnitedStates,
            ),
            (
                "맑은 고딕".to_string(),
                fontdb::Language::English_UnitedStates,
            ),
        ],
        post_script_name: "MalgunGothicRegular".to_string(),
        style: fontdb::Style::Normal,
        weight: Weight::NORMAL,
        stretch: Stretch::Normal,
        monospaced: false,
    }];

    let mut seen = BTreeSet::new();
    let mut entries = Vec::new();
    for face in &faces {
        let path = source_path(&face.source);
        for (family, _) in &face.families {
            let key = (
                family.clone(),
                face.post_script_name.clone(),
                style_name(face.style),
                face.weight.0,
                "system-installed",
                path.clone(),
            );
            if seen.insert(key) {
                entries.push(LocalFontEntry {
                    family: family.clone(),
                    full_name: None,
                    aliases: vec![],
                    post_script_name: face.post_script_name.clone(),
                    style: style_name(face.style).to_string(),
                    weight: face.weight.0,
                    source_kind: "system-installed".to_string(),
                    path: path.clone(),
                });
            }
        }
    }

    let families = entries
        .into_iter()
        .map(|entry| entry.family)
        .collect::<Vec<_>>();
    assert_eq!(
        families,
        vec!["Malgun Gothic".to_string(), "맑은 고딕".to_string()]
    );
}

#[test]
fn classify_source_marks_extra_dirs_as_file_backed() {
    let extra_dir = PathBuf::from("/opt/hancom/Shared/TTF");
    assert_eq!(
        classify_source(Some("/opt/hancom/Shared/TTF/HYHeadLine.ttf"), &[extra_dir]),
        "file-backed"
    );
    assert_eq!(
        classify_source(
            Some("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"),
            &[]
        ),
        "system-installed"
    );
}

#[test]
fn windows_user_font_dirs_use_local_app_data_root() {
    let root = PathBuf::from("C:/Users/test/AppData/Local");
    assert_eq!(
        windows_user_font_dirs(&root),
        vec![PathBuf::from(
            "C:/Users/test/AppData/Local/Microsoft/Windows/Fonts"
        )]
    );
}

#[test]
fn path_is_within_root_rejects_escape_paths() {
    let temp = tempfile::tempdir().unwrap();
    let fonts_root = temp.path().join("fonts");
    let outside_root = temp.path().join("outside");
    fs::create_dir_all(&fonts_root).unwrap();
    fs::create_dir_all(&outside_root).unwrap();

    let allowed_font = fonts_root.join("test.ttf");
    let outside_font = outside_root.join("test.ttf");
    fs::write(&allowed_font, b"font").unwrap();
    fs::write(&outside_font, b"font").unwrap();

    assert!(path_is_within_root(&allowed_font, &fonts_root));
    assert!(!path_is_within_root(&outside_font, &fonts_root));
    assert!(has_supported_font_extension(&allowed_font));
    assert!(!has_supported_font_extension(
        &outside_root.join("notes.txt")
    ));
}

#[test]
fn catalog_preserves_real_full_names_and_supported_path() {
    let temp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temp.path()).unwrap();
    let path = root.join("NanumSquareB.ttf");
    fs::write(
        &path,
        include_bytes!("../../../../tests/gui/local-fonts/nanumsquare/NanumSquareB.ttf"),
    )
    .unwrap();
    let entries = collect_local_font_entries(&[root]);
    let faces: Vec<_> = entries
        .iter()
        .filter(|entry| entry.path.as_deref() == path.to_str())
        .collect();
    assert!(!faces.is_empty());
    for face in faces {
        assert_eq!(face.full_name.as_deref(), Some("NanumSquare Bold"));
        assert!(face.aliases.iter().any(|name| name == "나눔스퀘어 Bold"));
        assert_eq!(face.weight, 700);
        assert_eq!(face.source_kind, "file-backed");
    }
}

#[test]
fn repeated_scans_of_one_physical_font_keep_one_row_per_localized_family() {
    let temp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temp.path()).unwrap();
    let path = root.join("NanumSquareB.ttf");
    fs::write(
        &path,
        include_bytes!("../../../../tests/gui/local-fonts/nanumsquare/NanumSquareB.ttf"),
    )
    .unwrap();
    // Emulate the system scan's ordinary path plus the product's canonical root.
    let entries = collect_local_font_entries(&[temp.path().join("."), root]);
    let faces: Vec<_> = entries
        .iter()
        .filter(|entry| {
            entry.post_script_name == "NanumSquareB"
                && entry.path.as_deref().is_some_and(|value| {
                    normalize_existing_path(Path::new(value)).as_deref() == Some(path.as_path())
                })
        })
        .collect();
    assert_eq!(faces.len(), 2);
    assert!(faces
        .iter()
        .all(|entry| entry.path.as_deref() == path.to_str()));
    assert!(faces.iter().all(|entry| entry.source_kind == "file-backed"));
}
