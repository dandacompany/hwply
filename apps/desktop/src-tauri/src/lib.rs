mod agent;
mod bundled_pdf_fonts;
mod commands;
mod font_catalog;
mod font_names;
mod local_font_commands;
mod local_font_preferences;
mod pdf_export;
mod pdf_font_fallbacks;
mod pdf_jobs;
mod pdf_temp_cleanup;
mod pdf_text_audit;
mod pending_open;
mod recent_documents;
mod state;
mod system_print;
mod install_record;
mod setup_commands;
mod updater;
mod window_geometry;
mod windows;

use std::path::{Path, PathBuf};
use std::{env, ffi::OsStr};
use tauri::{AppHandle, Emitter, Manager};

use agent::tauri_port::{
    agent_attach_document, agent_detach_document, agent_respond, agent_take_new_document_request,
    AgentHub,
};
use commands::{
    abort_pdf_export, append_pdf_page, begin_pdf_export, check_external_modification,
    clear_recent_documents, close_document, commit_pdf_export, commit_staged_document_save,
    create_document, create_editor_window, destroy_current_window, list_local_fonts,
    list_recent_documents, mark_document_dirty, mutate_document, open_document_tracking,
    prepare_document_open, prepare_staged_document_save, print_current_webview, query_document,
    read_local_font, record_recent_document, remove_recent_document, render_page_svg,
    reveal_in_folder, set_window_title, take_pending_open_paths,
};
use local_font_commands::{get_local_font_preferences, set_local_font_preferences};
use state::AppState;
use updater::commands::{
    updater_apply, updater_check, updater_get_state, updater_open_manual_downloads, updater_restart,
};

pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState::default())
        .manage(local_font_preferences::LocalFontPreferences::default())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = document_paths_from_args(&args, &cwd);
            if paths.is_empty() {
                return;
            }
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                open_paths_in_new_windows(&app, paths);
            });
        }))
        .setup(|app| {
            if let Err(error) = pdf_temp_cleanup::cleanup_orphan_pdf_temp_dirs() {
                eprintln!("[pdf] 오래된 임시 디렉터리 정리를 건너뜁니다: {error}");
            }
            let pdf_jobs = app.state::<AppState>().pdf_jobs.clone();
            pdf_temp_cleanup::spawn_pdf_job_reaper(std::sync::Arc::downgrade(&pdf_jobs))?;
            app.set_menu(tauri::menu::Menu::new(app)?)?;
            updater::commands::setup(app)?;
            // 브리지는 덧붙은 기능이다. 못 띄워도 편집기는 뜬다(`hwply status` 는 exit 4).
            if let Some(hub) = optional_service("에이전트 브리지", AgentHub::start(app.handle()))
            {
                app.manage(hub);
            }
            record_install(app.handle());
            route_open_paths(app.handle(), false, startup_document_paths());
            if let Some(window) = app.get_webview_window("main") {
                windows::install_editor_window_minimum(&window);
                windows::attach_document_drop_handler(app.handle(), &window);
                windows::attach_window_cleanup(app.handle(), &window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_document,
            create_editor_window,
            print_current_webview,
            close_document,
            mark_document_dirty,
            render_page_svg,
            query_document,
            mutate_document,
            begin_pdf_export,
            append_pdf_page,
            commit_pdf_export,
            abort_pdf_export,
            destroy_current_window,
            list_local_fonts,
            read_local_font,
            get_local_font_preferences,
            set_local_font_preferences,
            prepare_document_open,
            open_document_tracking,
            prepare_staged_document_save,
            commit_staged_document_save,
            check_external_modification,
            take_pending_open_paths,
            set_window_title,
            reveal_in_folder,
            list_recent_documents,
            clear_recent_documents,
            record_recent_document,
            remove_recent_document,
            updater_get_state,
            updater_check,
            updater_apply,
            updater_open_manual_downloads,
            updater_restart,
            setup_commands::setup_status,
            setup_commands::setup_apply,
            setup_commands::setup_dismiss,
            agent_attach_document,
            agent_detach_document,
            agent_respond,
            agent_take_new_document_request,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build hwply desktop app");

    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => handle_opened_urls(app, &urls),
        tauri::RunEvent::Exit => {
            if let Some(hub) = app.try_state::<AgentHub>() {
                hub.shutdown();
            }
        }
        _ => {}
    });
}

/// macOS 가 Finder 더블클릭·`open -a`·드래그로 넘긴 file URL. 시작 직후(main 창이 아직 대기열을
/// 안 가져갔으면) 대기열로 보내 main 창이 열고, 그 뒤에는 파일마다 새 창을 연다(Windows 의 single-instance 경로와 같다).
#[cfg(target_os = "macos")]
fn handle_opened_urls(app: &AppHandle, urls: &[tauri::Url]) {
    let paths = opened_urls_to_paths(urls);
    if paths.is_empty() {
        return;
    }
    let startup_taken = app
        .state::<AppState>()
        .startup_open_taken
        .load(std::sync::atomic::Ordering::Relaxed);
    route_open_paths(app, startup_taken, paths);
}

/// macOS `RunEvent::Opened` 의 file URL → 문서 경로. 다른 OS 에서는 쓰이지 않는다(인수 전달은 single-instance 경로).
#[cfg(target_os = "macos")]
fn opened_urls_to_paths(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(document_path_from_path)
        .collect()
}

/// 실패해도 앱 시작을 막지 않는 부가 서비스: 실패는 로그로 남기고 None.
/// 설치 위치를 `install.json` 에 적는다. 실패해도 앱은 뜬다(CLI 는 PATH 로 대신 찾는다).
fn record_install(app: &tauri::AppHandle) {
    let (Ok(exe), Ok(resources), Ok(data)) = (
        std::env::current_exe(),
        app.path().resource_dir(),
        app.path().app_data_dir(),
    ) else {
        eprintln!("[install] 설치 위치를 알 수 없어 install.json 을 건너뜁니다");
        return;
    };
    if install_record::is_translocated(&exe) {
        eprintln!("[install] 디스크 이미지 안에서 실행 중이라 install.json 을 갱신하지 않습니다");
        return;
    }
    let record = install_record::collect(
        &exe,
        &resources,
        &app.package_info().version.to_string(),
        env!("HWPLY_RHWP_TAG"),
    );
    optional_service("install.json", install_record::write(&data, &record));
}

fn optional_service<T, E: std::fmt::Display>(name: &str, result: Result<T, E>) -> Option<T> {
    match result {
        Ok(service) => Some(service),
        Err(error) => {
            eprintln!("[{name}] 시작하지 못했습니다(앱은 계속): {error}");
            None
        }
    }
}

/// 여러 문서를 한 번에 열 때의 배분: 시작 직후면 첫 문서는 main 창 대기열, 나머지는 새 창. 그 뒤면 전부 새 창.
/// (창 = 문서. 예전에는 시작 경로의 대기열이 마지막 하나만 열고 나머지를 조용히 버렸다.)
fn split_open_paths(startup_taken: bool, mut paths: Vec<String>) -> (Vec<String>, Vec<String>) {
    if startup_taken || paths.is_empty() {
        return (Vec::new(), paths);
    }
    let rest = paths.split_off(1);
    (paths, rest)
}

fn route_open_paths(app: &AppHandle, startup_taken: bool, paths: Vec<String>) {
    let (to_main, to_new_windows) = split_open_paths(startup_taken, paths);
    queue_open_paths(app, to_main);
    if !to_new_windows.is_empty() {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            open_paths_in_new_windows(&app, to_new_windows);
        });
    }
}

fn queue_open_paths(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    app.state::<AppState>()
        .pending_open_paths
        .queue_global(paths.iter().cloned());

    let payload = serde_json::json!({ "paths": paths });
    if let Some(label) = crate::windows::target_window_label(app) {
        let _ = app.emit_to(label, "hwply-open-paths", payload);
    } else {
        let _ = app.emit("hwply-open-paths", payload);
    }
}

fn open_paths_in_new_windows(app: &AppHandle, paths: Vec<String>) {
    for path in paths {
        if let Err(error) = open_path_in_new_window(app, path) {
            eprintln!("[open] 새 창 파일 열기 준비 실패: {}", error);
        }
    }
}

pub(crate) fn open_path_in_new_window(app: &AppHandle, path: String) -> Result<(), String> {
    let label = crate::windows::new_editor_window_label();
    app.state::<AppState>()
        .pending_open_paths
        .queue_for_window(&label, [path]);
    if let Err(error) = crate::windows::create_editor_window_with_label(app, &label) {
        app.state::<AppState>()
            .pending_open_paths
            .discard_for_window(&label);
        return Err(error);
    }
    Ok(())
}

fn document_paths_from_args(args: &[String], cwd: &str) -> Vec<String> {
    let cwd = Path::new(cwd);
    args.iter()
        .skip(1)
        .filter_map(|arg| document_path_from_os_arg(OsStr::new(arg), Some(cwd)))
        .collect()
}

fn startup_document_paths() -> Vec<String> {
    let cwd = env::current_dir().ok();
    env::args_os()
        .skip(1)
        .filter_map(|arg| document_path_from_os_arg(&arg, cwd.as_deref()))
        .collect()
}

fn document_path_from_os_arg(arg: &OsStr, cwd: Option<&Path>) -> Option<String> {
    if let Some(arg) = arg.to_str() {
        if let Ok(url) = tauri::Url::parse(arg) {
            if let Ok(path) = url.to_file_path() {
                return document_path_from_path(path);
            }
        }
    }

    let path = PathBuf::from(arg);
    let resolved = match cwd {
        Some(cwd) if !path.is_absolute() => cwd.join(path),
        _ => path,
    };
    document_path_from_path(resolved)
}

pub(crate) fn document_path_from_path(path: impl AsRef<Path>) -> Option<String> {
    let path = path.as_ref();
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if ext != "hwp" && ext != "hwpx" {
        return None;
    }
    Some(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_path_from_path_accepts_hwp_and_hwpx_case_insensitively() {
        assert!(document_path_from_path(PathBuf::from("/tmp/doc.hwp")).is_some());
        assert!(document_path_from_path(PathBuf::from("/tmp/doc.HWPX")).is_some());
    }

    #[test]
    fn document_path_from_path_rejects_other_extensions() {
        assert!(document_path_from_path(PathBuf::from("/tmp/doc.pdf")).is_none());
        assert!(document_path_from_path(PathBuf::from("/tmp/doc")).is_none());
    }

    #[test]
    fn document_path_from_arg_resolves_relative_paths_against_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path();
        let expected = dir.path().join("docs/sample.hwp");

        assert_eq!(
            document_path_from_os_arg(OsStr::new("docs/sample.hwp"), Some(cwd)),
            Some(expected.to_string_lossy().to_string())
        );
    }

    #[test]
    fn document_path_from_arg_accepts_file_urls() {
        let path = std::env::temp_dir().join("sample.hwpx");
        let url = tauri::Url::from_file_path(&path).unwrap().to_string();

        assert_eq!(
            document_path_from_os_arg(OsStr::new(&url), Some(Path::new("/ignored"))),
            Some(path.to_string_lossy().to_string())
        );
    }

    #[test]
    fn document_paths_from_args_skip_executable_and_filter_unsupported_args() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy();
        let paths = document_paths_from_args(
            &[
                dir.path().join("hwply.exe").to_string_lossy().to_string(),
                "first.hwp".to_string(),
                "notes.txt".to_string(),
                "second.HWPX".to_string(),
            ],
            &cwd,
        );

        assert_eq!(
            paths,
            vec![
                dir.path().join("first.hwp").to_string_lossy().to_string(),
                dir.path().join("second.HWPX").to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn startup_like_args_skip_the_executable_path() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path();
        let executable = dir.path().join("sample.hwp");
        let document = dir.path().join("opened.hwpx");
        let args = [executable.as_os_str(), document.as_os_str()];

        let paths = args
            .iter()
            .skip(1)
            .filter_map(|arg| document_path_from_os_arg(arg, Some(cwd)))
            .collect::<Vec<_>>();

        assert_eq!(paths, vec![document.to_string_lossy().to_string()]);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod opened_urls_tests {
    use super::*;

    #[test]
    fn opened_urls_to_paths_decodes_file_urls_and_drops_others() {
        let urls = [
            tauri::Url::parse("file:///Users/d/%EB%B3%B4%EA%B3%A0%EC%84%9C.hwp").unwrap(),
            tauri::Url::parse("https://example.com/doc.hwp").unwrap(),
            tauri::Url::parse("file:///Users/d/notes.txt").unwrap(),
            tauri::Url::parse("file:///Users/d/form.HWPX").unwrap(),
        ];
        assert_eq!(
            opened_urls_to_paths(&urls),
            vec![
                "/Users/d/보고서.hwp".to_string(),
                "/Users/d/form.HWPX".to_string()
            ]
        );
    }
}

#[cfg(test)]
mod optional_service_tests {
    use super::optional_service;

    #[test]
    fn bridge_failure_does_not_stop_the_editor() {
        let failed: Result<u8, std::io::Error> = Err(std::io::Error::other("포트 없음"));
        assert_eq!(optional_service("에이전트 브리지", failed), None);
        assert_eq!(
            optional_service("에이전트 브리지", Ok::<u8, std::io::Error>(7)),
            Some(7)
        );
    }
}

#[cfg(test)]
mod split_open_paths_tests {
    use super::*;

    fn p(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn before_startup_first_goes_to_main_and_rest_to_new_windows() {
        let (main, new) = split_open_paths(false, p(&["a.hwp", "b.hwp", "c.hwpx"]));
        assert_eq!(main, p(&["a.hwp"]));
        assert_eq!(new, p(&["b.hwp", "c.hwpx"]));
    }

    #[test]
    fn after_startup_all_go_to_new_windows() {
        let (main, new) = split_open_paths(true, p(&["a.hwp", "b.hwp"]));
        assert!(main.is_empty());
        assert_eq!(new, p(&["a.hwp", "b.hwp"]));
    }

    #[test]
    fn empty_input_routes_nothing() {
        let (main, new) = split_open_paths(false, vec![]);
        assert!(main.is_empty() && new.is_empty());
    }
}
