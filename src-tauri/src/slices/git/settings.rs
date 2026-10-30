//! `topos.json`: Topos's user prefs and per-repo state (#369, #384).

use std::ops::RangeInclusive;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::error::GitError;

/// What Topos reads at start-up and after each write.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToposSettings {
    pub graph_column_width: u32,
    pub inspector_width: u32,
    pub diff_mode: DiffMode,
    pub file_list_mode: FileListMode,
}

/// `DiffMode` in `src/slices/git/topos/FileDiffView.tsx`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffMode {
    Unified,
    Split,
}

/// `ListMode` in `src/slices/git/topos/stagingLists.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileListMode {
    Flat,
    Tree,
}

impl Default for ToposSettings {
    fn default() -> Self {
        Self {
            graph_column_width: DEFAULT_GRAPH_COLUMN_WIDTH,
            inspector_width: DEFAULT_INSPECTOR_WIDTH,
            diff_mode: DiffMode::Unified,
            file_list_mode: FileListMode::Flat,
        }
    }
}

/// `DEFAULT_COLUMN_WIDTH` in `src/slices/git/topos/graphColumn.ts`.
pub const DEFAULT_GRAPH_COLUMN_WIDTH: u32 = 220;
/// `DEFAULT_INSPECTOR_WIDTH` in `src/slices/git/topos/stagingKeys.ts`.
pub const DEFAULT_INSPECTOR_WIDTH: u32 = 400;
/// `MIN_COLUMN_WIDTH..=MAX_COLUMN_WIDTH` in `src/slices/git/topos/graphColumn.ts`.
pub const GRAPH_COLUMN_WIDTHS: RangeInclusive<u32> = 48..=656;
/// `MIN_INSPECTOR_WIDTH..=MAX_INSPECTOR_WIDTH` in `src/slices/git/topos/stagingKeys.ts`.
pub const INSPECTOR_WIDTHS: RangeInclusive<u32> = 280..=720;

/// A whole number of px inside `range`, or None for anything else: a string, a fraction, a negative
/// or a width the frontend's resize handle can't reach.
fn width_in(value: &Value, range: &RangeInclusive<u32>) -> Option<u32> {
    let width = u32::try_from(value.as_u64()?).ok()?;
    range.contains(&width).then_some(width)
}

/// Reads `topos.json` text field by field. A field that is missing or holds a bad value takes its
/// default, and text that isn't a JSON object reads as all defaults.
pub fn parse_settings(text: &str) -> ToposSettings {
    let mut settings = ToposSettings::default();
    let Ok(Value::Object(file)) = serde_json::from_str::<Value>(text) else {
        return settings;
    };
    if let Some(width) = file.get("graphColumnWidth").and_then(|v| width_in(v, &GRAPH_COLUMN_WIDTHS)) {
        settings.graph_column_width = width;
    }
    if let Some(width) = file.get("inspectorWidth").and_then(|v| width_in(v, &INSPECTOR_WIDTHS)) {
        settings.inspector_width = width;
    }
    if let Some(mode) = file.get("diffMode").and_then(|v| DiffMode::deserialize(v).ok()) {
        settings.diff_mode = mode;
    }
    if let Some(mode) = file.get("fileListMode").and_then(|v| FileListMode::deserialize(v).ok()) {
        settings.file_list_mode = mode;
    }
    settings
}

/// A change to the prefs from `topos_settings_write`. A field left out keeps its value.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToposSettingsPatch {
    pub graph_column_width: Option<u32>,
    pub inspector_width: Option<u32>,
    pub diff_mode: Option<DiffMode>,
    pub file_list_mode: Option<FileListMode>,
}

/// How long writes must be quiet before `topos.json` is written (#369).
pub const WRITE_DEBOUNCE: Duration = Duration::from_millis(500);

/// `topos.json` in Quay's storage directory. Reads come from memory; each write changes memory at
/// once and reaches the file through `atomic_file::write_atomic` after [`WRITE_DEBOUNCE`] of quiet.
pub struct ToposSettingsStore {
    shared: Arc<Shared>,
}

struct Shared {
    path: PathBuf,
    state: Mutex<State>,
    /// Held across a file write, so two writes land in the order their snapshots were taken.
    write_lock: Mutex<()>,
}

struct State {
    settings: ToposSettings,
    /// Whether memory holds a change the file doesn't.
    dirty: bool,
    /// When the pending file write is due, or None when none is.
    due: Option<Instant>,
    /// Whether a timer thread is waiting for `due`.
    timer: bool,
}

impl ToposSettingsStore {
    pub fn new() -> Self {
        Self::at(crate::slices::workspace::manager::storage_dir().join("topos.json"))
    }

    pub fn at(path: PathBuf) -> Self {
        let settings = match std::fs::read_to_string(&path) {
            Ok(text) => parse_settings(&text),
            Err(_) => ToposSettings::default(),
        };
        Self {
            shared: Arc::new(Shared {
                path,
                state: Mutex::new(State { settings, dirty: false, due: None, timer: false }),
                write_lock: Mutex::new(()),
            }),
        }
    }

    pub fn read(&self) -> ToposSettings {
        self.shared.state.lock().settings.clone()
    }

    /// Applies `patch` and returns the prefs it leaves, or refuses the whole patch when a width is
    /// out of range. The file is written once writes have been
    /// quiet for [`WRITE_DEBOUNCE`].
    pub fn write(&self, patch: ToposSettingsPatch) -> Result<ToposSettings, GitError> {
        for (name, width, range) in [
            ("graph column width", patch.graph_column_width, &GRAPH_COLUMN_WIDTHS),
            ("inspector width", patch.inspector_width, &INSPECTOR_WIDTHS),
        ] {
            if let Some(width) = width.filter(|w| !range.contains(w)) {
                return Err(GitError::Other {
                    stderr: format!("A {name} of {width} px is outside {}..={} px.", range.start(), range.end()),
                });
            }
        }
        let mut state = self.shared.state.lock();
        let settings = &mut state.settings;
        if let Some(width) = patch.graph_column_width {
            settings.graph_column_width = width;
        }
        if let Some(width) = patch.inspector_width {
            settings.inspector_width = width;
        }
        if let Some(mode) = patch.diff_mode {
            settings.diff_mode = mode;
        }
        if let Some(mode) = patch.file_list_mode {
            settings.file_list_mode = mode;
        }
        let result = settings.clone();
        state.dirty = true;
        state.due = Some(Instant::now() + WRITE_DEBOUNCE);
        if !state.timer {
            state.timer = true;
            let shared = Arc::clone(&self.shared);
            std::thread::spawn(move || shared.write_when_due());
        }
        Ok(result)
    }

    /// Writes a pending change now, without waiting out the debounce. Quay calls this as it exits.
    pub fn flush(&self) -> Result<(), String> {
        self.shared.state.lock().due = None;
        self.shared.write_file()
    }
}

impl Default for ToposSettingsStore {
    fn default() -> Self {
        Self::new()
    }
}

impl Shared {
    /// The timer thread: sleeps until the pending write is due, moving with each later write.
    fn write_when_due(&self) {
        loop {
            let mut state = self.state.lock();
            let Some(due) = state.due else {
                state.timer = false;
                return;
            };
            let now = Instant::now();
            if now < due {
                drop(state);
                std::thread::sleep(due - now);
                continue;
            }
            state.due = None;
            state.timer = false;
            drop(state);
            if let Err(e) = self.write_file() {
                tracing::warn!("{}", e);
            }
            return;
        }
    }

    fn write_file(&self) -> Result<(), String> {
        let _guard = self.write_lock.lock();
        let json = {
            let mut state = self.state.lock();
            if !state.dirty {
                return Ok(());
            }
            state.dirty = false;
            serde_json::to_string_pretty(&state.settings)
        }
        .map_err(|e| format!("Failed to serialize the Topos settings: {}", e))?;
        crate::atomic_file::write_atomic(&self.path, json.as_bytes())
            .map_err(|e| format!("Failed to write {}: {}", self.path.display(), e))
    }
}
