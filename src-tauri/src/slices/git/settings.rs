//! `topos.json`: Topos's user prefs and per-repo state (#369, #384).

use std::collections::BTreeMap;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::error::GitError;
use super::rev_set::{check_branches, existing_branches, MAX_REFS};

/// What Topos reads at start-up and after each write.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToposSettings {
    pub graph_column_width: u32,
    pub inspector_width: u32,
    pub diff_mode: DiffMode,
    pub file_list_mode: FileListMode,
    /// Per-repo state, keyed by [`repo_key`]. The store keeps at most [`MAX_REPOS`] entries.
    pub repos: BTreeMap<String, RepoState>,
}

/// What Topos remembers about one repo (#369).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoState {
    /// When Topos last opened the repo, in ms since the Unix epoch.
    pub last_opened: i64,
    /// Whether the operator chose "Don't suggest for this repo" on the speed-up banner (#385).
    pub suppress_speedup: bool,
    /// The branch filter and toggles (#401), stored as the entry's own `branches`, `remotes` and
    /// `tags` fields.
    #[serde(flatten)]
    pub filters: RepoFilters,
}

impl RepoState {
    fn opened_at(last_opened: i64) -> Self {
        Self { last_opened, suppress_speedup: false, filters: RepoFilters::default() }
    }
}

/// A repo's branch filter and toggles, what `topos_repo_filters` returns (#401). Agent highlights
/// and the Find text are never stored (#369).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepoFilters {
    /// Full branch names such as `refs/heads/main`; empty for every branch.
    pub branches: Vec<String>,
    /// The Remotes toggle: whether remote-tracking branches are walked.
    pub remotes: bool,
    /// The Tags toggle: whether tags are walked.
    pub tags: bool,
}

impl Default for RepoFilters {
    /// Every branch and remote, no tags: the graph's ref set before any filter (#370), as
    /// `NO_FILTERS` in `src/slices/git/topos/graphFilters.ts` has it.
    fn default() -> Self {
        Self { branches: Vec::new(), remotes: true, tags: false }
    }
}

/// A repo's filters from `topos_settings_write`: the whole set, replacing what was stored.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepoFiltersPatch {
    /// A repo or worktree path; its repo's entry takes the filters.
    pub repo_path: String,
    pub filters: RepoFilters,
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
            repos: BTreeMap::new(),
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

/// A whole number of px, or None for anything else: a string, a fraction or a negative.
fn whole_px(value: &Value) -> Option<u32> {
    u32::try_from(value.as_u64()?).ok()
}

/// Reads `topos.json` text field by field. A field that is missing or holds a bad value takes its
/// default, and text that isn't a JSON object reads as all defaults.
pub fn parse_settings(text: &str) -> ToposSettings {
    let mut settings = ToposSettings::default();
    let Ok(Value::Object(file)) = serde_json::from_str::<Value>(text) else {
        return settings;
    };
    let mut prefs = ToposSettingsPatch {
        graph_column_width: file.get("graphColumnWidth").and_then(whole_px),
        inspector_width: file.get("inspectorWidth").and_then(whole_px),
        diff_mode: file.get("diffMode").and_then(|v| DiffMode::deserialize(v).ok()),
        file_list_mode: file.get("fileListMode").and_then(|v| FileListMode::deserialize(v).ok()),
        opened_repo: None,
        suppress_speedup: None,
        repo_filters: None,
    };
    for (_, width, range) in prefs.widths() {
        *width = width.filter(|w| range.contains(w));
    }
    prefs.apply_prefs(&mut settings);
    if let Some(Value::Object(repos)) = file.get("repos") {
        for (key, entry) in repos {
            let Some(last_opened) = entry.get("lastOpened").and_then(Value::as_i64).filter(|ms| *ms >= 0) else {
                continue;
            };
            let repo = record_open(&mut settings.repos, comparable_key(key), last_opened);
            // Only `true` suppresses; any other value reads as the default, still suggesting.
            if entry.get("suppressSpeedup") == Some(&Value::Bool(true)) {
                repo.suppress_speedup = true;
            }
            // A bad name is dropped alone; a toggle that isn't a boolean keeps its default.
            let filters = &mut repo.filters;
            if let Some(Value::Array(names)) = entry.get("branches") {
                let names = names.iter().filter_map(Value::as_str).filter(|n| check_branches(&[n.to_string()]).is_ok());
                filters.branches = names.take(MAX_REFS).map(str::to_string).collect();
            }
            if let Some(Value::Bool(remotes)) = entry.get("remotes") {
                filters.remotes = *remotes;
            }
            if let Some(Value::Bool(tags)) = entry.get("tags") {
                filters.tags = *tags;
            }
        }
        cap_repos(&mut settings.repos);
    }
    settings
}

/// A key read from the file in the form [`repo_key`] gives, so two spellings of one repo that a
/// hand edit or an older Quay left behind become one entry.
fn comparable_key(key: &str) -> String {
    let slashed = key.replace('\\', "/");
    if cfg!(any(windows, target_os = "macos")) {
        slashed.to_lowercase()
    } else {
        slashed
    }
}

/// Records that `key` was opened at `last_opened`, keeping the later time when it already has one,
/// and returns its entry.
fn record_open(repos: &mut BTreeMap<String, RepoState>, key: String, last_opened: i64) -> &mut RepoState {
    let entry = repos.entry(key).or_insert_with(|| RepoState::opened_at(last_opened));
    entry.last_opened = entry.last_opened.max(last_opened);
    entry
}

/// Keeps the [`MAX_REPOS`] most recently opened repos and evicts the rest. Among equal times the
/// key that sorts last goes first.
fn cap_repos(repos: &mut BTreeMap<String, RepoState>) {
    if repos.len() <= MAX_REPOS {
        return;
    }
    let mut by_age: Vec<(i64, String)> = repos.iter().map(|(key, r)| (r.last_opened, key.clone())).collect();
    by_age.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    for (_, key) in by_age.drain(MAX_REPOS..) {
        repos.remove(&key);
    }
}

/// The key of the repo holding `path`, a repo or any of its worktrees: git's common dir in the
/// form two spellings of it share, so each repo has one entry and, on Windows, the key ignores
/// case.
pub fn repo_key(path: &Path) -> Result<String, GitError> {
    let out = super::op_runner::headless_git()
        .arg("-C")
        .arg(path)
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .output()
        .map_err(|e| GitError::Other { stderr: format!("could not run git rev-parse: {e}") })?;
    if !out.status.success() {
        return Err(GitError::Other { stderr: String::from_utf8_lossy(&out.stderr).trim().to_string() });
    }
    let common_dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if common_dir.is_empty() {
        return Err(GitError::Other { stderr: format!("git rev-parse printed no git dir for {}", path.display()) });
    }
    Ok(super::commands::comparable_path(&common_dir))
}

/// A change to the prefs from `topos_settings_write`. A field left out keeps its value.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToposSettingsPatch {
    pub graph_column_width: Option<u32>,
    pub inspector_width: Option<u32>,
    pub diff_mode: Option<DiffMode>,
    pub file_list_mode: Option<FileListMode>,
    /// A repo or worktree path Topos has just opened, which records its repo's last-opened time.
    pub opened_repo: Option<String>,
    /// A repo or worktree path whose repo the speed-up banner no longer suggests for (#385). It
    /// counts as an open too, so the entry is kept among the most recently opened.
    pub suppress_speedup: Option<String>,
    /// A repo's branch filter and toggles (#401), which count as an open too.
    pub repo_filters: Option<RepoFiltersPatch>,
}

impl ToposSettingsPatch {
    /// The patch's widths, each with its name and the range the frontend's resize handle reaches.
    fn widths(&mut self) -> [(&'static str, &mut Option<u32>, &'static RangeInclusive<u32>); 2] {
        [
            ("graph column width", &mut self.graph_column_width, &GRAPH_COLUMN_WIDTHS),
            ("inspector width", &mut self.inspector_width, &INSPECTOR_WIDTHS),
        ]
    }

    /// Sets each pref the patch carries. Recording `opened_repo` and `suppress_speedup` is the
    /// store's job.
    fn apply_prefs(&self, settings: &mut ToposSettings) {
        if let Some(width) = self.graph_column_width {
            settings.graph_column_width = width;
        }
        if let Some(width) = self.inspector_width {
            settings.inspector_width = width;
        }
        if let Some(mode) = self.diff_mode {
            settings.diff_mode = mode;
        }
        if let Some(mode) = self.file_list_mode {
            settings.file_list_mode = mode;
        }
    }
}

/// The most repo entries `topos.json` keeps (#369).
pub const MAX_REPOS: usize = 200;

/// How long writes must be quiet before `topos.json` is written (#369).
pub const WRITE_DEBOUNCE: Duration = Duration::from_millis(500);

/// `topos.json` in Quay's storage directory. Clones share one store. Reads come from memory; each
/// write changes memory at once and reaches the file through `atomic_file::write_atomic` after
/// [`WRITE_DEBOUNCE`] of quiet.
#[derive(Clone)]
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
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!("Failed to read {}, so Topos opens with its defaults: {}", path.display(), e);
                }
                ToposSettings::default()
            }
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

    /// Whether the speed-up banner was turned away for the repo whose [`repo_key`] is `key`.
    pub fn speedup_suppressed(&self, key: &str) -> bool {
        self.shared.state.lock().settings.repos.get(key).is_some_and(|r| r.suppress_speedup)
    }

    /// Applies `patch` and returns the prefs it leaves, or refuses the whole patch when a width is
    /// out of range. The file is written once writes have been quiet for [`WRITE_DEBOUNCE`].
    pub fn write(&self, mut patch: ToposSettingsPatch) -> Result<ToposSettings, GitError> {
        for (name, width, range) in patch.widths() {
            if let Some(width) = width.filter(|w| !range.contains(w)) {
                return Err(GitError::Other {
                    stderr: format!("A {name} of {width} px is outside {}..={} px.", range.start(), range.end()),
                });
            }
        }
        let opened = patch.opened_repo.as_deref().map(|path| repo_key(Path::new(path))).transpose()?;
        let suppressed = patch.suppress_speedup.as_deref().map(|path| repo_key(Path::new(path))).transpose()?;
        if let Some(repo_filters) = &patch.repo_filters {
            check_branches(&repo_filters.filters.branches)?;
        }
        let filtered = patch.repo_filters.as_ref().map(|f| repo_key(Path::new(&f.repo_path))).transpose()?;
        let mut state = self.shared.state.lock();
        let settings = &mut state.settings;
        let now = crate::dates::now_ms();
        if let Some(key) = opened {
            record_open(&mut settings.repos, key, now);
        }
        if let Some(key) = suppressed {
            record_open(&mut settings.repos, key, now).suppress_speedup = true;
        }
        if let (Some(key), Some(RepoFiltersPatch { mut filters, .. })) = (filtered, patch.repo_filters.take()) {
            let mut seen = std::collections::HashSet::new();
            filters.branches.retain(|b| seen.insert(b.clone()));
            record_open(&mut settings.repos, key, now).filters = filters;
        }
        cap_repos(&mut settings.repos);
        patch.apply_prefs(settings);
        let result = settings.clone();
        state.mark_dirty(&self.shared);
        Ok(result)
    }

    /// The branch filter and toggles stored for the repo holding `path`, with every branch that no
    /// longer exists pruned (#369). A pruned entry is written back, debounced like any write.
    pub fn repo_filters(&self, path: &Path) -> Result<RepoFilters, GitError> {
        let key = repo_key(path)?;
        let stored = self.shared.state.lock().settings.repos.get(&key).map(|r| r.filters.clone());
        let Some(mut filters) = stored else {
            return Ok(RepoFilters::default());
        };
        if filters.branches.is_empty() {
            return Ok(filters);
        }
        let existing = existing_branches(path)?;
        let before = filters.branches.len();
        filters.branches.retain(|b| existing.contains(b));
        if filters.branches.len() != before {
            let mut state = self.shared.state.lock();
            if let Some(repo) = state.settings.repos.get_mut(&key) {
                // Only names that are gone go, so a filter set meanwhile keeps its new names.
                repo.filters.branches.retain(|b| existing.contains(b));
                state.mark_dirty(&self.shared);
            }
        }
        Ok(filters)
    }

    /// Writes a pending change now, without waiting out the debounce. Quay calls this as it exits.
    pub fn flush(&self) -> Result<(), String> {
        self.shared.state.lock().due = None;
        self.shared.write_file()
    }
}

impl State {
    /// Records a change memory holds and the file doesn't, and schedules its write.
    fn mark_dirty(&mut self, shared: &Arc<Shared>) {
        self.dirty = true;
        self.due = Some(Instant::now() + WRITE_DEBOUNCE);
        if !self.timer {
            self.timer = true;
            let shared = Arc::clone(shared);
            std::thread::spawn(move || shared.write_when_due());
        }
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

/// The prefs and per-repo state Topos opens with (#384).
#[tauri::command]
pub fn topos_settings_read(store: tauri::State<'_, ToposSettingsStore>) -> ToposSettings {
    store.read()
}

/// Applies `patch` and returns the result. See [`ToposSettingsStore::write`].
#[tauri::command]
pub async fn topos_settings_write(
    patch: ToposSettingsPatch,
    store: tauri::State<'_, ToposSettingsStore>,
) -> Result<ToposSettings, GitError> {
    // An opened repo runs git rev-parse, so keep it off the async runtime's threads.
    let store = store.inner().clone();
    tokio::task::spawn_blocking(move || store.write(patch))
        .await
        .map_err(|e| GitError::Other { stderr: format!("could not write the Topos settings: {e}") })?
}

/// The branch filter and toggles Topos opens `repo_path`'s graph with, pruned of branches that
/// are gone (#401).
#[tauri::command]
pub async fn topos_repo_filters(
    repo_path: String,
    store: tauri::State<'_, ToposSettingsStore>,
) -> Result<RepoFilters, GitError> {
    let store = store.inner().clone();
    tokio::task::spawn_blocking(move || store.repo_filters(Path::new(&repo_path)))
        .await
        .map_err(|e| GitError::Other { stderr: format!("could not read the Topos filters: {e}") })?
}
