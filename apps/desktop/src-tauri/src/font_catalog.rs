use crate::bundled_pdf_fonts;
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use usvg::fontdb::{self, Source};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalFontEntry {
    pub family: String,
    pub full_name: Option<String>,
    pub aliases: Vec<String>,
    pub post_script_name: String,
    pub style: String,
    pub weight: u16,
    pub source_kind: String,
    pub path: Option<String>,
}

pub fn desktop_extra_font_dirs() -> Vec<PathBuf> {
    #[cfg_attr(target_os = "macos", allow(unused_mut))]
    let mut dirs = Vec::new();

    #[cfg(target_os = "linux")]
    {
        if let Some(home_dir) = env_path("HOME") {
            dirs.push(home_dir.join(".local/share/fonts"));
            dirs.push(home_dir.join(".fonts"));
        }

        let wsl_windows_fonts = PathBuf::from("/mnt/c/Windows/Fonts");
        if wsl_windows_fonts.is_dir() {
            dirs.push(wsl_windows_fonts);
        }
    }

    #[cfg(windows)]
    {
        if let Some(local_app_data) = env_path("LOCALAPPDATA") {
            dirs.extend(windows_user_font_dirs(&local_app_data));
        }
    }

    dedupe_existing_dirs(dirs)
}

pub fn collect_desktop_local_font_entries() -> Vec<LocalFontEntry> {
    collect_local_font_entries(&desktop_extra_font_dirs())
}

pub fn create_pdf_font_database() -> fontdb::Database {
    let mut fontdb = create_font_database(&desktop_extra_font_dirs());
    bundled_pdf_fonts::load_into(&mut fontdb);
    bundled_pdf_fonts::apply_generic_defaults(&mut fontdb);
    fontdb
}

pub fn read_desktop_local_font(path: &Path) -> Result<Vec<u8>, String> {
    let path = normalize_existing_path(path)
        .ok_or_else(|| format!("로컬 폰트 파일을 찾을 수 없습니다: {}", path.display()))?;

    if !has_supported_font_extension(&path) {
        return Err(format!(
            "지원하지 않는 로컬 폰트 확장자입니다: {}",
            path.display()
        ));
    }

    let allowed_roots = desktop_extra_font_dirs();
    if !allowed_roots
        .iter()
        .any(|root| path_is_within_root(&path, root))
    {
        return Err(format!(
            "지원된 로컬 폰트 디렉터리 밖의 파일입니다: {}",
            path.display()
        ));
    }

    fs::read(&path).map_err(|error| {
        format!(
            "로컬 폰트 파일을 읽을 수 없습니다: {} ({})",
            path.display(),
            error
        )
    })
}

pub fn create_font_database(extra_font_dirs: &[PathBuf]) -> fontdb::Database {
    let mut fontdb = fontdb::Database::new();
    fontdb.load_system_fonts();

    for dir in extra_font_dirs {
        if dir.is_dir() {
            fontdb.load_fonts_dir(dir);
        }
    }

    fontdb
}

pub fn collect_local_font_entries(extra_font_dirs: &[PathBuf]) -> Vec<LocalFontEntry> {
    let fontdb = create_font_database(extra_font_dirs);
    let file_backed_dirs = extra_font_dirs
        .iter()
        .filter(|dir| dir.is_dir())
        .cloned()
        .collect::<Vec<_>>();

    let mut seen = BTreeSet::new();
    let mut entries = Vec::new();

    for face in fontdb.faces() {
        let path = source_path(&face.source);
        let source_kind = classify_source(path.as_deref(), &file_backed_dirs);
        let style = style_name(face.style);

        let names = fontdb
            .with_face_data(face.id, crate::font_names::read_face_names)
            .unwrap_or_default();
        let mut families = BTreeSet::new();
        for (family, _) in &face.families {
            let family = family.trim();
            if !family.is_empty() {
                families.insert(family.to_string());
            }
        }

        for family in families {
            let key = (
                family.clone(),
                face.post_script_name.clone(),
                style,
                face.weight.0,
                source_kind,
                path.clone(),
            );
            if !seen.insert(key) {
                continue;
            }

            entries.push(LocalFontEntry {
                family,
                full_name: names.full_name.clone(),
                aliases: names.aliases.clone(),
                post_script_name: face.post_script_name.clone(),
                style: style.to_string(),
                weight: face.weight.0,
                source_kind: source_kind.to_string(),
                path: path.clone(),
            });
        }
    }

    entries.sort_by(|left, right| {
        left.family
            .cmp(&right.family)
            .then(left.weight.cmp(&right.weight))
            .then(left.style.cmp(&right.style))
            .then(left.post_script_name.cmp(&right.post_script_name))
    });
    entries
}

fn source_path(source: &Source) -> Option<String> {
    match source {
        Source::File(path) | Source::SharedFile(path, _) => Some(
            normalize_existing_path(path)
                .unwrap_or_else(|| path.to_path_buf())
                .to_string_lossy()
                .to_string(),
        ),
        Source::Binary(_) => None,
    }
}

fn classify_source(path: Option<&str>, file_backed_dirs: &[PathBuf]) -> &'static str {
    let Some(path) = path else {
        return "system-installed";
    };
    let normalized_path = normalize_existing_path(Path::new(path));
    let path = normalized_path
        .as_deref()
        .unwrap_or_else(|| Path::new(path));
    if file_backed_dirs.iter().any(|dir| path.starts_with(dir)) {
        "file-backed"
    } else {
        "system-installed"
    }
}

fn style_name(style: fontdb::Style) -> &'static str {
    match style {
        fontdb::Style::Normal => "normal",
        fontdb::Style::Italic => "italic",
        fontdb::Style::Oblique => "oblique",
    }
}

#[cfg(any(windows, target_os = "linux"))]
fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

#[cfg(any(windows, test))]
fn windows_user_font_dirs(local_app_data: &Path) -> Vec<PathBuf> {
    vec![local_app_data.join("Microsoft/Windows/Fonts")]
}

fn dedupe_existing_dirs(dirs: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    let mut deduped = Vec::new();

    for dir in dirs {
        let Some(normalized_dir) = normalize_existing_path(&dir) else {
            continue;
        };
        if seen.insert(normalized_dir.clone()) {
            deduped.push(normalized_dir);
        }
    }

    deduped
}

fn normalize_existing_path(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok()
}

fn path_is_within_root(path: &Path, root: &Path) -> bool {
    let Some(normalized_path) = normalize_existing_path(path) else {
        return false;
    };
    let Some(normalized_root) = normalize_existing_path(root) else {
        return false;
    };
    normalized_path.starts_with(&normalized_root)
}

fn has_supported_font_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "ttf" | "otf" | "ttc" | "otc" | "woff" | "woff2"
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
#[path = "font_catalog_tests.rs"]
mod tests;
