use crate::window_geometry::{
    new_window_geometry, MIN_EDITOR_WINDOW_HEIGHT, MIN_EDITOR_WINDOW_WIDTH,
    NEW_WINDOW_WORK_AREA_MARGIN,
};
use std::path::PathBuf;
use tauri::{
    AppHandle, DragDropEvent, Emitter, LogicalSize, Manager, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use uuid::Uuid;

pub fn create_editor_window(app: &AppHandle) -> Result<String, String> {
    let label = new_editor_window_label();
    create_editor_window_with_label(app, &label)?;
    Ok(label)
}

pub fn new_editor_window_label() -> String {
    format!("main{}", Uuid::new_v4().simple())
}

pub fn create_editor_window_with_label(app: &AppHandle, label: &str) -> Result<(), String> {
    let geometry = new_window_geometry(app);

    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("hwply")
        .inner_size(geometry.width, geometry.height)
        .min_inner_size(geometry.min_width, geometry.min_height)
        .prevent_overflow_with_margin(Size::Logical(LogicalSize::new(
            NEW_WINDOW_WORK_AREA_MARGIN,
            NEW_WINDOW_WORK_AREA_MARGIN,
        )));
    let builder = if let Some((x, y)) = geometry.position {
        builder.position(x, y)
    } else {
        builder.center()
    };
    #[cfg(windows)]
    let builder = builder.zoom_hotkeys_enabled(true);

    let window = builder
        .build()
        .map_err(|e| format!("새 창 생성 실패: {}", e))?;
    install_editor_window_minimum_with_size(&window, geometry.min_width, geometry.min_height);
    attach_document_drop_handler(app, &window);
    attach_window_cleanup(app, &window);
    let _ = window.set_focus();

    Ok(())
}

pub fn install_editor_window_minimum(window: &WebviewWindow) {
    install_editor_window_minimum_with_size(
        window,
        MIN_EDITOR_WINDOW_WIDTH,
        MIN_EDITOR_WINDOW_HEIGHT,
    );
}

fn install_editor_window_minimum_with_size(
    window: &WebviewWindow,
    min_width: f64,
    min_height: f64,
) {
    let minimum = LogicalSize::new(min_width, min_height);
    let _ = window.set_min_size(Some(Size::Logical(minimum)));
}

pub fn attach_document_drop_handler(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event else {
            return;
        };
        let paths = document_paths(paths);
        if paths.is_empty() {
            return;
        }
        let _ = app.emit_to(
            label.as_str(),
            "hwply-open-paths",
            serde_json::json!({ "paths": paths }),
        );
    });
}

pub fn attach_window_cleanup(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(true) = event {
            if let Some(hub) = app.try_state::<crate::agent::tauri_port::AgentHub>() {
                hub.core.note_focus(&label);
            }
        }
        if matches!(event, WindowEvent::Destroyed) {
            if let Some(hub) = app.try_state::<crate::agent::tauri_port::AgentHub>() {
                hub.core.window_destroyed(&label);
            }
            app.state::<crate::state::AppState>()
                .pending_open_paths
                .discard_for_window(&label);
            if let Ok(mut jobs) = app.state::<crate::state::AppState>().pdf_jobs.lock() {
                jobs.discard_for_window(&label);
            }
        }
    });
}

fn document_paths(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .filter_map(super::document_path_from_path)
        .collect()
}

pub fn target_window_label(app: &AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone())
        .or_else(|| windows.keys().next().cloned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_paths_keeps_only_supported_documents() {
        let a = PathBuf::from("/tmp/a.hwp");
        let b = PathBuf::from("/tmp/b.HWPX");
        let paths = document_paths(&[
            a.clone(),
            b.clone(),
            PathBuf::from("/tmp/c.pdf"),
            PathBuf::from("/tmp/no-extension"),
        ]);

        assert_eq!(
            paths,
            vec![
                a.to_string_lossy().to_string(),
                b.to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn document_paths_preserves_input_order() {
        let first = PathBuf::from("/tmp/first.hwp");
        let second = PathBuf::from("/tmp/second.hwpx");
        let paths = document_paths(&[first.clone(), second.clone()]);

        assert_eq!(
            paths,
            vec![
                first.to_string_lossy().to_string(),
                second.to_string_lossy().to_string()
            ]
        );
    }
}
