use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FontChoice {
    #[default]
    Unset,
    Enabled,
    Disabled,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FontAction {
    Enabled,
    Disabled,
    Dismiss,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontPreferenceSnapshot {
    pub choice: FontChoice,
    pub persisted: bool,
    pub revision: u64,
    pub prompt_dismissed: bool,
    pub error: Option<&'static str>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredPreference {
    version: u8,
    choice: FontChoice,
}

#[derive(Default)]
pub struct LocalFontPreferences(Mutex<FontPreferenceSnapshot>);

impl LocalFontPreferences {
    pub fn get(&self, path: &Path) -> Result<FontPreferenceSnapshot, &'static str> {
        let mut state = self.0.lock().map_err(|_| "font-settings-unavailable")?;
        refresh(&mut state, path);
        Ok(state.clone())
    }

    pub fn set(
        &self,
        path: &Path,
        action: FontAction,
    ) -> Result<FontPreferenceSnapshot, &'static str> {
        let mut state = self.0.lock().map_err(|_| "font-settings-unavailable")?;
        refresh(&mut state, path);
        let choice = match action {
            FontAction::Dismiss => {
                state.prompt_dismissed = true;
                state.revision += 1;
                return Ok(state.clone());
            }
            FontAction::Enabled => FontChoice::Enabled,
            FontAction::Disabled => FontChoice::Disabled,
        };
        write_preference(path, choice)?;
        state.choice = choice;
        state.persisted = true;
        state.prompt_dismissed = false;
        state.error = None;
        state.revision += 1;
        Ok(state.clone())
    }
}

fn refresh(state: &mut FontPreferenceSnapshot, path: &Path) {
    let (choice, persisted, error) = match read_preference(path) {
        Ok(Some(choice)) => (choice, true, None),
        Ok(None) => (FontChoice::Unset, false, None),
        Err(error) => (FontChoice::Unset, false, Some(error)),
    };
    if (state.choice, state.persisted, state.error) != (choice, persisted, error) {
        state.choice = choice;
        state.persisted = persisted;
        state.error = error;
        state.revision += 1;
    }
}

fn read_preference(path: &Path) -> Result<Option<FontChoice>, &'static str> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("font-settings-read-failed"),
    };
    if !metadata.is_file() || metadata.len() > 4096 {
        return Err("font-settings-invalid");
    }
    let bytes = fs::read(path).map_err(|_| "font-settings-read-failed")?;
    let stored: StoredPreference =
        serde_json::from_slice(&bytes).map_err(|_| "font-settings-invalid")?;
    if stored.version != 1 || stored.choice == FontChoice::Unset {
        return Err("font-settings-invalid");
    }
    Ok(Some(stored.choice))
}

fn write_preference(path: &Path, choice: FontChoice) -> Result<(), &'static str> {
    let parent = path.parent().ok_or("font-settings-write-failed")?;
    fs::create_dir_all(parent).map_err(|_| "font-settings-write-failed")?;
    let bytes = serde_json::to_vec(&StoredPreference { version: 1, choice })
        .map_err(|_| "font-settings-write-failed")?;
    crate::state::atomic_write(path, &bytes).map_err(|_| "font-settings-write-failed")
}

#[cfg(test)]
#[path = "local_font_preferences_tests.rs"]
mod tests;
