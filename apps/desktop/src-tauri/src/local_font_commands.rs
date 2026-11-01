use crate::local_font_preferences::{FontAction, FontPreferenceSnapshot, LocalFontPreferences};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

fn preference_path(app: &AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("local-font-preferences.json"))
        .map_err(|_| "font-settings-unavailable")
}

#[tauri::command]
pub fn get_local_font_preferences(
    app: AppHandle,
    state: State<'_, LocalFontPreferences>,
) -> Result<FontPreferenceSnapshot, &'static str> {
    state.get(&preference_path(&app)?)
}

#[tauri::command]
pub fn set_local_font_preferences(
    app: AppHandle,
    state: State<'_, LocalFontPreferences>,
    action: FontAction,
) -> Result<FontPreferenceSnapshot, &'static str> {
    let snapshot = state.set(&preference_path(&app)?, action)?;
    // Disk success remains success if a closing window misses the notification.
    // Windows read the current snapshot again on document entry and focus.
    let _ = app.emit("hwply-local-font-preferences-changed", &snapshot);
    Ok(snapshot)
}
