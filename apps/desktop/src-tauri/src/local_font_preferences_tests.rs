use super::*;

#[test]
fn local_font_preferences_restore_both_choices_from_disk_in_a_new_service() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("prefs.json");
    let service = LocalFontPreferences::default();
    assert_eq!(service.get(&path).unwrap().choice, FontChoice::Unset);
    for (action, choice) in [
        (FontAction::Enabled, FontChoice::Enabled),
        (FontAction::Disabled, FontChoice::Disabled),
    ] {
        let saved = service.set(&path, action).unwrap();
        assert!(saved.persisted);
        let restored = LocalFontPreferences::default().get(&path).unwrap();
        assert_eq!(restored.choice, choice);
        assert!(restored.persisted);
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 2);
        assert_eq!(value["version"], 1);
    }
}

#[test]
fn local_font_preferences_dismissal_is_shared_but_not_persisted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("prefs.json");
    let service = LocalFontPreferences::default();
    let dismissed = service.set(&path, FontAction::Dismiss).unwrap();
    assert!(dismissed.prompt_dismissed);
    assert!(service.get(&path).unwrap().prompt_dismissed);
    assert!(!path.exists());
    assert!(
        !LocalFontPreferences::default()
            .get(&path)
            .unwrap()
            .prompt_dismissed
    );
    assert!(
        !service
            .set(&path, FontAction::Enabled)
            .unwrap()
            .prompt_dismissed
    );
}

#[test]
fn local_font_preferences_reject_invalid_data_and_recover_explicitly() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("prefs.json");
    let service = LocalFontPreferences::default();
    for content in [
        "{",
        r#"{"version":2,"choice":"enabled"}"#,
        r#"{"version":1,"choice":"unset"}"#,
        r#"{"version":1,"choice":"enabled","fonts":[]}"#,
    ] {
        fs::write(&path, content).unwrap();
        let state = service.get(&path).unwrap();
        assert_eq!(state.choice, FontChoice::Unset);
        assert!(!state.persisted);
        assert_eq!(state.error, Some("font-settings-invalid"));
    }
    assert!(service
        .set(&path, FontAction::Disabled)
        .unwrap()
        .error
        .is_none());
}

#[test]
fn local_font_preferences_write_failure_never_claims_persistence_or_leaks_paths() {
    let dir = tempfile::tempdir().unwrap();
    let parent = dir.path().join("private-parent");
    fs::write(&parent, b"not a directory").unwrap();
    let service = LocalFontPreferences::default();
    let error = service
        .set(&parent.join("prefs.json"), FontAction::Enabled)
        .unwrap_err();
    assert_eq!(error, "font-settings-write-failed");
    let state = service.get(&parent.join("prefs.json")).unwrap();
    assert_ne!(state.choice, FontChoice::Enabled);
    assert!(!state.persisted);
}

#[test]
fn local_font_preferences_observe_external_deletion_and_monotonic_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("prefs.json");
    let service = LocalFontPreferences::default();
    let first = service.set(&path, FontAction::Enabled).unwrap();
    let second = service.set(&path, FontAction::Disabled).unwrap();
    assert!(second.revision > first.revision);
    assert_eq!(service.get(&path).unwrap(), second);
    fs::remove_file(&path).unwrap();
    let removed = service.get(&path).unwrap();
    assert!(removed.revision > second.revision);
    assert_eq!(removed.choice, FontChoice::Unset);
}

#[test]
fn local_font_preferences_serialize_concurrent_window_updates() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("prefs.json");
    let service = LocalFontPreferences::default();
    std::thread::scope(|scope| {
        let first = scope.spawn(|| service.set(&path, FontAction::Enabled).unwrap());
        let second = scope.spawn(|| service.set(&path, FontAction::Disabled).unwrap());
        let (first, second) = (first.join().unwrap(), second.join().unwrap());
        let last = if first.revision > second.revision {
            first
        } else {
            second
        };
        assert_eq!(service.get(&path).unwrap(), last);
        assert_eq!(
            LocalFontPreferences::default().get(&path).unwrap().choice,
            last.choice
        );
    });
}
