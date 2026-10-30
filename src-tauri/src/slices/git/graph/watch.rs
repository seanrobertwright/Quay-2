//! The repository watcher a graph session owns (#354, amended by #370): the only source of the
//! global `git-repo-changed` event.
//!
//! - Paths come from `git rev-parse --git-common-dir --git-dir`, so a worktree's `.git` file is
//!   followed to its real git dir.
//! - The git-dir watch runs while the session is live. In the common dir it hears `HEAD`,
//!   `packed-refs`, `refs/**`, the operation files and `worktrees/*/HEAD`; in the selected
//!   worktree's git dir, `index`, `HEAD` and the operation files. It ignores `objects/**`,
//!   `logs/**`, `*.lock` and `FETCH_HEAD`, and anything else.
//! - The working-tree watch covers the selected worktree, less anything under `.git`, and runs
//!   only while Topos is visible.
//! - Raw events become dirty bits. They are sent after 150 ms with no event, and at least once a
//!   second while events keep coming. A rescan or overflow dirties every bit.

use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::super::error::GitError;
use super::page::GraphEvent;
use super::refs::repo_git;

/// Quiet time after the last event before the dirty bits are sent.
pub const DEBOUNCE: Duration = Duration::from_millis(150);
/// The longest dirty bits wait while events keep coming.
pub const CEILING: Duration = Duration::from_secs(1);

/// What changed, as the refresh table on the frontend reads it.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dirty {
    /// A branch, remote or tag ref, `packed-refs`, or another worktree's HEAD.
    pub refs: bool,
    /// The selected worktree's HEAD.
    pub head: bool,
    /// The selected worktree's index.
    pub index: bool,
    /// A file in the selected worktree.
    pub worktree: bool,
    /// A merge, rebase, cherry-pick or revert started, stepped or ended.
    pub operation: bool,
}

impl Dirty {
    const ALL: Dirty = Dirty { refs: true, head: true, index: true, worktree: true, operation: true };

    fn any(self) -> bool {
        self.refs || self.head || self.index || self.worktree || self.operation
    }

    pub(super) fn or(self, o: Dirty) -> Dirty {
        Dirty {
            refs: self.refs || o.refs,
            head: self.head || o.head,
            index: self.index || o.index,
            worktree: self.worktree || o.worktree,
            operation: self.operation || o.operation,
        }
    }
}

/// The payload of the global `git-repo-changed` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChanged {
    /// The repo the graph session was opened on, as it was given.
    pub repo_root: String,
    /// The selected worktree, as it was given.
    pub worktree_path: String,
    pub dirty: Dirty,
    /// Whether a rebase or sequencer directory exists, during which the frontend holds the graph
    /// refresh until the operation ends.
    pub in_operation: bool,
}

/// Where live updates stand, sent on the session's channel as `GraphEvent::Watch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum WatchState {
    Live,
    /// The watch couldn't start or stopped erroring; the view may be stale.
    Off { reason: String },
    /// The watched worktree or repo is gone.
    Gone,
}

/// Where `git-repo-changed` goes.
pub type RepoChangedSink = Arc<dyn Fn(RepoChanged) + Send + Sync>;

/// The folders one watch covers.
#[derive(Debug, Clone, PartialEq, Eq)]
struct WatchPaths {
    common_dir: PathBuf,
    git_dir: PathBuf,
    worktree: PathBuf,
}

impl WatchPaths {
    /// Asks git where `worktree`'s git dirs are.
    fn read(worktree: &Path) -> Result<Self, String> {
        if !worktree.is_dir() {
            return Err(format!("{} is not a folder", worktree.display()));
        }
        let out = repo_git(worktree)
            .args(["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir"])
            .output()
            .map_err(|e| format!("could not run git rev-parse: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let mut lines = text.lines().map(|l| PathBuf::from(l.trim()));
        match (lines.next(), lines.next()) {
            (Some(common_dir), Some(git_dir)) => Ok(Self { common_dir, git_dir, worktree: worktree.to_path_buf() }),
            _ => Err(format!("git rev-parse printed no git dirs for {}", worktree.display())),
        }
    }

    /// Whether a rebase or sequencer directory exists for the selected worktree or the main one.
    fn in_operation(&self) -> bool {
        [&self.git_dir, &self.common_dir]
            .iter()
            .any(|dir| ["rebase-merge", "rebase-apply", "sequencer"].iter().any(|d| dir.join(d).is_dir()))
    }

    /// Whether the folders the watch covers still exist.
    fn exist(&self) -> bool {
        self.worktree.is_dir() && self.git_dir.is_dir() && self.common_dir.is_dir()
    }

    /// The dirty bits an event at `path` sets.
    fn classify(&self, path: &Path) -> Dirty {
        if let Ok(rel) = path.strip_prefix(&self.common_dir) {
            return self.classify_common(&names(rel));
        }
        if let Ok(rel) = path.strip_prefix(&self.git_dir) {
            return classify_git_dir(&names(rel));
        }
        if let Ok(rel) = path.strip_prefix(&self.worktree) {
            // The git dirs have their own watch; a worktree's `.git` file or folder is git's.
            let under_git = rel.components().any(|c| c == Component::Normal(".git".as_ref()));
            return Dirty { worktree: !under_git, ..Dirty::default() };
        }
        Dirty::default()
    }

    fn classify_common(&self, rel: &[&str]) -> Dirty {
        let refs = Dirty { refs: true, ..Dirty::default() };
        match rel {
            [] => Dirty::default(),
            [first, ..] if *first == "objects" || *first == "logs" => Dirty::default(),
            [.., last] if last.ends_with(".lock") || *last == "FETCH_HEAD" => Dirty::default(),
            ["packed-refs"] => refs,
            ["refs", ..] => refs,
            ["worktrees", name, rest @ ..] => {
                if self.common_dir.join("worktrees").join(name) == self.git_dir {
                    classify_git_dir(rest)
                } else if rest == ["HEAD"] {
                    refs
                } else {
                    Dirty::default()
                }
            }
            // The common dir is the main worktree's git dir. When another worktree is selected, the
            // main worktree's HEAD is a badge, its index is not the inspector's, and its operation
            // files still mean an operation is under way in the repo.
            _ if self.common_dir == self.git_dir => classify_git_dir(rel),
            ["HEAD"] => refs,
            _ => Dirty { operation: classify_git_dir(rel).operation, ..Dirty::default() },
        }
    }
}

/// The path's components as text.
fn names(rel: &Path) -> Vec<&str> {
    rel.components().filter_map(|c| c.as_os_str().to_str()).collect()
}

/// The dirty bits of a path in the selected worktree's git dir, or of an operation file anywhere.
fn classify_git_dir(rel: &[&str]) -> Dirty {
    match rel {
        [.., last] if last.ends_with(".lock") => Dirty::default(),
        ["HEAD"] => Dirty { head: true, ..Dirty::default() },
        ["index"] => Dirty { index: true, ..Dirty::default() },
        ["MERGE_HEAD" | "CHERRY_PICK_HEAD" | "REVERT_HEAD"] => Dirty { operation: true, ..Dirty::default() },
        [name] if name.starts_with("REBASE_") => Dirty { operation: true, ..Dirty::default() },
        ["rebase-merge" | "rebase-apply" | "sequencer", ..] => Dirty { operation: true, ..Dirty::default() },
        _ => Dirty::default(),
    }
}

type Raw = notify::Result<Event>;

/// A live watch. Dropping it stops it.
pub struct Watch {
    paths: WatchPaths,
    tx: Sender<Raw>,
    /// Lives as long as the watch; its callback feeds the debounce thread.
    _git_dirs: RecommendedWatcher,
    working_tree: Option<RecommendedWatcher>,
    /// Cleared when the watch stops by itself: its folder went away or the watcher failed.
    running: Arc<AtomicBool>,
}

impl Watch {
    /// Starts watching `worktree`'s git dirs, and its files when `visible`. Changes go to `sink`
    /// as from `repo_root`; the watch's later state goes to `channel` as session `session_id`'s.
    pub fn start(
        session_id: u32,
        repo_root: &Path,
        worktree: &Path,
        visible: bool,
        sink: Option<RepoChangedSink>,
        channel: Channel<InvokeResponseBody>,
    ) -> Result<Self, String> {
        let paths = WatchPaths::read(worktree)?;
        let (tx, rx) = std::sync::mpsc::channel();
        let mut git_dirs = watcher(&tx)?;
        git_dirs.watch(&paths.common_dir, RecursiveMode::Recursive).map_err(|e| watch_error(&paths.common_dir, e))?;
        if !paths.git_dir.starts_with(&paths.common_dir) {
            git_dirs.watch(&paths.git_dir, RecursiveMode::Recursive).map_err(|e| watch_error(&paths.git_dir, e))?;
        }
        let running = Arc::new(AtomicBool::new(true));
        let mut watch = Self { paths: paths.clone(), tx, _git_dirs: git_dirs, working_tree: None, running: running.clone() };
        watch.set_visible(visible)?;
        let debounce = Debounce {
            session_id,
            repo_root: repo_root.to_string_lossy().into_owned(),
            worktree_path: worktree.to_string_lossy().into_owned(),
            paths,
            sink,
            channel,
        };
        std::thread::Builder::new()
            .name(format!("topos-watch-{session_id}"))
            .spawn(move || {
                debounce.run(rx);
                running.store(false, Ordering::Relaxed);
            })
            .map_err(|e| format!("could not start the watcher: {e}"))?;
        Ok(watch)
    }

    /// The worktree this watch covers.
    pub fn worktree(&self) -> &Path {
        &self.paths.worktree
    }

    /// Whether the watch is still on.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Starts or stops the working-tree watch.
    pub fn set_visible(&mut self, visible: bool) -> Result<(), String> {
        if !visible {
            self.working_tree = None;
        } else if self.working_tree.is_none() {
            let mut w = watcher(&self.tx)?;
            w.watch(&self.paths.worktree, RecursiveMode::Recursive).map_err(|e| watch_error(&self.paths.worktree, e))?;
            self.working_tree = Some(w);
        }
        Ok(())
    }
}

fn watcher(tx: &Sender<Raw>) -> Result<RecommendedWatcher, String> {
    let tx = tx.clone();
    notify::recommended_watcher(move |event| {
        let _ = tx.send(event);
    })
    .map_err(|e| format!("could not start the watcher: {e}"))
}

fn watch_error(path: &Path, e: notify::Error) -> String {
    format!("could not watch {}: {e}", path.display())
}

/// The thread that turns raw events into debounced `git-repo-changed` events.
struct Debounce {
    session_id: u32,
    repo_root: String,
    worktree_path: String,
    paths: WatchPaths,
    sink: Option<RepoChangedSink>,
    channel: Channel<InvokeResponseBody>,
}

impl Debounce {
    fn run(self, rx: Receiver<Raw>) {
        let mut pending = Dirty::default();
        // When the first and the last pending event arrived.
        let mut first: Option<Instant> = None;
        let mut last = Instant::now();
        loop {
            let next = match first {
                None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
                Some(first) => {
                    let due = (last + DEBOUNCE).min(first + CEILING);
                    rx.recv_timeout(due.saturating_duration_since(Instant::now()))
                }
            };
            match next {
                Ok(Ok(event)) => {
                    let dirty = if event.need_rescan() {
                        Dirty::ALL
                    } else {
                        event.paths.iter().fold(Dirty::default(), |d, p| d.or(self.paths.classify(p)))
                    };
                    if dirty.any() {
                        pending = pending.or(dirty);
                        first.get_or_insert_with(Instant::now);
                        last = Instant::now();
                    }
                }
                Ok(Err(e)) => {
                    if !self.paths.exist() {
                        self.state(WatchState::Gone);
                    } else {
                        self.state(WatchState::Off { reason: format!("the watcher failed: {e}") });
                    }
                    return;
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !self.paths.exist() {
                        self.state(WatchState::Gone);
                        return;
                    }
                    self.emit(pending);
                    pending = Dirty::default();
                    first = None;
                }
                // The watch was dropped.
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    }

    fn emit(&self, dirty: Dirty) {
        if let Some(sink) = &self.sink {
            sink(RepoChanged {
                repo_root: self.repo_root.clone(),
                worktree_path: self.worktree_path.clone(),
                dirty,
                in_operation: self.paths.in_operation(),
            });
        }
    }

    fn state(&self, watch: WatchState) {
        let event = GraphEvent::Watch { session_id: self.session_id, watch };
        let json = serde_json::to_string(&event).expect("graph events serialize");
        let _ = self.channel.send(InvokeResponseBody::Json(json));
    }
}

/// A fingerprint of `worktree`'s refs, HEAD and index, compared on focus and on show while live
/// updates are off (#354): the `for-each-ref` output, HEAD's oid, and the index's mtime and size.
pub fn fingerprint(worktree: &Path) -> Result<String, GitError> {
    let paths = WatchPaths::read(worktree).map_err(|stderr| GitError::Other { stderr })?;
    let run = |args: &[&str]| -> Result<Vec<u8>, GitError> {
        let out = repo_git(worktree)
            .args(args)
            .output()
            .map_err(|e| GitError::Other { stderr: format!("could not run git: {e}") })?;
        Ok(if out.status.success() { out.stdout } else { Vec::new() })
    };
    let refs = run(&["for-each-ref", "--format=%(objectname) %(refname)"])?;
    let head = run(&["rev-parse", "-q", "--verify", "HEAD"])?;
    let index = std::fs::metadata(paths.git_dir.join("index"))
        .ok()
        .map(|m| (m.len(), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())));
    let mut h = std::hash::DefaultHasher::new();
    std::hash::Hash::hash(&(refs, head, index), &mut h);
    Ok(format!("{:016x}", std::hash::Hasher::finish(&h)))
}
