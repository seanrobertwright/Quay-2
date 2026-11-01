//! Quay's global settings, kept in `settings.json` in Quay's storage folder. A missing
//! file, key or unreadable file leaves every setting at its default.

use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Whether agent terminals stamp their commits with a `Quay-Agent` trailer. Read
    /// when a terminal launches, so a change reaches new terminals only.
    pub agent_commit_stamping: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings { agent_commit_stamping: true }
    }
}

/// The settings saved in Quay's storage folder.
pub fn load() -> AppSettings {
    read_from(&super::manager::storage_dir().join("settings.json"))
}

fn read_from(path: &Path) -> AppSettings {
    let content = match std::fs::read(path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return AppSettings::default(),
        Err(e) => {
            tracing::error!("Could not read settings from {}: {}; using defaults", path.display(), e);
            return AppSettings::default();
        }
    };
    serde_json::from_slice(&content).unwrap_or_else(|e| {
        tracing::error!("Settings in {} are unreadable ({}); using defaults", path.display(), e);
        AppSettings::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `settings.json` path holding `body`, if given, in a folder that goes when the
    /// returned `TempDir` drops.
    fn settings_file(body: Option<&str>) -> (crate::test_support::TempDir, std::path::PathBuf) {
        let dir = crate::test_support::TempDir::new("settings");
        let path = dir.join("settings.json");
        if let Some(body) = body {
            std::fs::write(&path, body).unwrap();
        }
        (dir, path)
    }

    #[test]
    fn stamping_is_on_with_no_settings_file() {
        assert!(read_from(&settings_file(None).1).agent_commit_stamping);
    }

    #[test]
    fn stamping_is_on_when_the_file_does_not_mention_it() {
        assert!(read_from(&settings_file(Some(r#"{"somethingElse": 1}"#)).1).agent_commit_stamping);
    }

    #[test]
    fn the_setting_turns_stamping_off() {
        let (_dir, path) = settings_file(Some(r#"{"agentCommitStamping": false}"#));
        assert!(!read_from(&path).agent_commit_stamping);
    }

    #[test]
    fn an_unreadable_file_leaves_stamping_on() {
        assert!(read_from(&settings_file(Some("{not json")).1).agent_commit_stamping);
    }
}
