//! `praxis-cli.json`: the two per-user settings for how Quay reaches `praxis` (#228, #446).
//!
//! - `checkout` names the AI-WS-SDK checkout to run `praxis` from, in place of the one npm's
//!   global link points at.
//! - `installation` names the Praxis installation folder, passed as `--state` on every call. With
//!   none, Quay passes no `--state`, so it uses the installation `praxis` in a terminal uses.
//!
//! Both are parsed when written, and again on each use, because a folder can go away later.

use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::launch;

/// The settings as stored and as the frontend reads and writes them: each folder as typed, or
/// `null` when unset.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PraxisCliSettings {
    #[serde(default)]
    pub checkout: Option<String>,
    #[serde(default)]
    pub installation: Option<String>,
}

/// The settings once checked: each folder exists and is absolute, and the checkout holds a
/// `praxis` script.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CheckedSettings {
    /// The `praxis` script in the configured checkout.
    pub checkout_script: Option<PathBuf>,
    pub installation: Option<PathBuf>,
}

impl PraxisCliSettings {
    /// Checks both settings, refusing a bad one with a message that names it.
    pub fn check(&self) -> Result<CheckedSettings, String> {
        let checkout_script = match &self.checkout {
            Some(value) => Some(launch::script_in_checkout(&existing_folder("Praxis checkout folder", value)?)?),
            None => None,
        };
        let installation = match &self.installation {
            Some(value) => Some(existing_folder("Praxis installation folder", value)?),
            None => None,
        };
        Ok(CheckedSettings { checkout_script, installation })
    }
}

/// `value` as an existing absolute folder, or a message naming `what` and why it isn't one.
pub fn existing_folder(what: &str, value: &str) -> Result<PathBuf, String> {
    if value.trim().is_empty() {
        return Err(format!("The {what} is empty. Clear the setting instead."));
    }
    if value.trim() != value {
        return Err(format!("The {what} {value:?} starts or ends with a space."));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("The {what} must be an absolute path, not {value:?}."));
    }
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_dir() => Ok(path),
        Ok(_) => Err(format!("The {what} {value} is a file, not a folder.")),
        Err(_) => Err(format!("The {what} {value} doesn't exist.")),
    }
}

/// The settings file and what it holds.
pub struct SettingsStore {
    path: PathBuf,
    current: Mutex<PraxisCliSettings>,
}

impl SettingsStore {
    /// The store at `path`. A missing file holds no settings; one that can't be read is logged
    /// and treated the same, so a bad file never stops Quay from starting.
    pub fn at(path: PathBuf) -> Self {
        let current = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!("Ignoring {}, which isn't a Praxis CLI settings file: {}", path.display(), e);
                PraxisCliSettings::default()
            }),
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!("Failed to read {}: {}", path.display(), e);
                }
                PraxisCliSettings::default()
            }
        };
        Self { path, current: Mutex::new(current) }
    }

    pub fn read(&self) -> PraxisCliSettings {
        self.current.lock().clone()
    }

    /// Checks `settings` and, when they pass, stores them.
    pub fn write(&self, settings: PraxisCliSettings) -> Result<PraxisCliSettings, String> {
        settings.check()?;
        let mut current = self.current.lock();
        let json = serde_json::to_string_pretty(&settings).map_err(|e| format!("Failed to serialize the Praxis CLI settings: {e}"))?;
        crate::atomic_file::write_atomic(&self.path, json.as_bytes())
            .map_err(|e| format!("Failed to write {}: {}", self.path.display(), e))?;
        *current = settings.clone();
        Ok(settings)
    }
}
