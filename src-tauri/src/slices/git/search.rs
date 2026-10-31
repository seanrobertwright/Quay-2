//! Deep search over all history (#368, #400): one `git log` over the graph's ref set that streams
//! the oids of the commits whose message, author, changed paths or added and removed text match.
//!
//! The search text goes to git as its own argument, never through a shell, and git reads it as a
//! fixed string (`-F`, literal pathspecs, a pickaxe without `--pickaxe-regex`), never as a regex or
//! a glob. Results stream as [`SearchEvent::Matches`] and stop at [`RESULT_CAP`]: the search sends
//! [`SearchEvent::Capped`] and git blocks on its full pipe until `git_search_more` grants another
//! [`RESULT_CAP`]. At most one search is live; starting one cancels the one before, and a cancel
//! kills git's whole process tree.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use super::checkout::{invalid_ref, refuse_option_like, rev_oid};
use super::commit::read_git;
use super::error::GitError;
use super::op_runner::headless_git;
use crate::spawn::ProcessTree;

/// Matches a search sends before it waits for Load more.
pub const RESULT_CAP: u32 = 1_000;
/// The longest search text taken, in bytes.
pub const MAX_SEARCH_TEXT: usize = 1_024;
/// The most refs a reduced ref set names.
pub const MAX_SEARCH_REFS: usize = 1_000;
/// Oids per `Matches` event at most; a part-filled batch goes as soon as git pauses.
const BATCH_OIDS: usize = 256;
/// How much of git's stderr a failure keeps.
const STDERR_CAP: usize = 64 * 1024;

/// What a search matches, each a `git log` option that reads its text literally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchKind {
    /// The full message, ignoring case: `--grep <text> -i -F`.
    Message,
    /// The author's `Name <email>`: `--author <text> -F`.
    Author,
    /// Commits that change the path: `-- <text>` with `GIT_LITERAL_PATHSPECS=1`.
    Path,
    /// Commits that change how many times the text occurs: the pickaxe `-S <text>`. Slow.
    Code,
}

/// The refs a search walks from, the graph's current ref set.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SearchRefs {
    /// Every local branch, every remote-tracking branch and HEAD, as the graph walks (#370).
    #[default]
    Branches,
    /// Only these refs: each a full name such as `refs/heads/main`, or `HEAD`.
    Only { refs: Vec<String> },
}

/// `SearchQuery` from `git_log_search`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchQuery {
    pub kind: SearchKind,
    pub text: String,
    #[serde(default)]
    pub refs: SearchRefs,
}

/// One step of a running search, as the frontend receives it:
/// `{ "event": "matches", "searchId": 3, "oids": ["…"] }`. Every variant names its search, so the
/// frontend drops a stale one's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SearchEvent {
    /// More matching commits, in the graph's date order.
    Matches { search_id: u32, oids: Vec<String> },
    /// The walk ended with `total` matches.
    Done { search_id: u32, total: u32 },
    /// The search sent `total` matches, more remain, and it waits for `git_search_more`.
    Capped { search_id: u32, total: u32 },
    /// git failed, or the search was cancelled.
    Failed { search_id: u32, error: GitError },
}

/// The matches granted so far and whether the search was cancelled.
struct Credit {
    granted: u32,
    cancelled: bool,
}

struct Control {
    credit: Mutex<Credit>,
    changed: Condvar,
}

impl Control {
    fn lock(&self) -> MutexGuard<'_, Credit> {
        self.credit.lock().unwrap_or_else(|p| p.into_inner())
    }
}

struct LiveSearch {
    id: u32,
    control: Arc<Control>,
    /// git's process tree, shared with the walk, which reaps it when git ends on its own.
    tree: Arc<Mutex<Option<ProcessTree>>>,
    #[cfg(test)]
    pid: u32,
}

impl LiveSearch {
    fn cancel(&self) {
        self.control.lock().cancelled = true;
        self.control.changed.notify_all();
        if let Some(mut tree) = self.tree.lock().unwrap_or_else(|p| p.into_inner()).take() {
            tree.kill();
        }
    }
}

/// The live search, if any. Tauri manages one of these.
#[derive(Default)]
pub struct GitSearches {
    live: Mutex<Option<LiveSearch>>,
    next_id: AtomicU32,
}

/// The text git is given, refused when it is empty, too long or holds a NUL.
fn parse_text(text: &str) -> Result<&str, GitError> {
    if text.trim().is_empty() {
        return Err(GitError::Other { stderr: "the search text is empty".into() });
    }
    if text.len() > MAX_SEARCH_TEXT {
        return Err(GitError::Other { stderr: format!("the search text is longer than {MAX_SEARCH_TEXT} bytes") });
    }
    if text.contains('\0') {
        return Err(GitError::Other { stderr: "the search text holds a NUL".into() });
    }
    Ok(text)
}

/// The revisions `refs` names in `repo`, each checked: a reduced set names only `HEAD` or full
/// ref names that `check-ref-format` accepts and that exist, and none can read as an option.
fn rev_args(repo: &Path, refs: &SearchRefs) -> Result<Vec<String>, GitError> {
    match refs {
        SearchRefs::Branches => {
            let mut revs = vec!["--branches".to_string(), "--remotes".to_string()];
            // An unborn HEAD names no commit; the walk goes without it, as the graph's does.
            if rev_oid(repo, "HEAD^{commit}")?.is_some() {
                revs.push("HEAD".into());
            }
            Ok(revs)
        }
        SearchRefs::Only { refs } => {
            if refs.is_empty() || refs.len() > MAX_SEARCH_REFS {
                return Err(GitError::Other { stderr: format!("a search names between 1 and {MAX_SEARCH_REFS} refs") });
            }
            for name in refs {
                refuse_option_like(name)?;
                if name != "HEAD" {
                    let formatted = name.starts_with("refs/") && read_git(repo, &["check-ref-format", name])?.is_some();
                    if !formatted {
                        return Err(invalid_ref(name));
                    }
                }
                rev_oid(repo, &format!("{name}^{{commit}}"))?.ok_or_else(|| invalid_ref(name))?;
            }
            Ok(refs.clone())
        }
    }
}

impl GitSearches {
    fn live(&self) -> MutexGuard<'_, Option<LiveSearch>> {
        self.live.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Cancels any live search and starts `query` in `repo`, streaming to `channel`. Returns the
    /// search id every event carries.
    pub fn start(&self, repo: &Path, query: SearchQuery, channel: Channel<SearchEvent>) -> Result<u32, GitError> {
        if !repo.is_absolute() || !repo.is_dir() {
            return Err(GitError::Other { stderr: format!("{} is not a folder", repo.display()) });
        }
        let text = parse_text(&query.text)?;
        let revs = rev_args(repo, &query.refs)?;

        let mut cmd = headless_git();
        cmd.arg("-C").arg(repo).env("GIT_LITERAL_PATHSPECS", "1").args([
            "--no-optional-locks",
            "log",
            "--no-color",
            "--date-order",
            "--format=%H",
        ]);
        match query.kind {
            SearchKind::Message => cmd.args(["-i", "-F", "--grep"]).arg(text),
            SearchKind::Author => cmd.args(["-F", "--author"]).arg(text),
            SearchKind::Path => &mut cmd,
            SearchKind::Code => cmd.arg("-S").arg(text),
        };
        cmd.args(&revs).arg("--");
        if query.kind == SearchKind::Path {
            cmd.arg(text);
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut live = self.live();
        if let Some(old) = live.take() {
            old.cancel();
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut tree = crate::spawn::spawn_tree(&mut cmd).map_err(|e| GitError::Other { stderr: format!("could not run git: {e}") })?;
        let stdout = tree.child().stdout.take().ok_or_else(|| GitError::Other { stderr: "git gave no output pipe".into() })?;
        let stderr = tree.child().stderr.take();
        #[cfg(test)]
        let pid = tree.child().id();
        let control = Arc::new(Control { credit: Mutex::new(Credit { granted: RESULT_CAP, cancelled: false }), changed: Condvar::new() });
        let tree = Arc::new(Mutex::new(Some(tree)));
        let walk = Walk { id, control: control.clone(), tree: tree.clone(), channel };
        std::thread::Builder::new()
            .name(format!("topos-search-{id}"))
            .spawn(move || walk.run(stdout, stderr))
            .map_err(|e| GitError::Other { stderr: format!("could not start the search: {e}") })?;
        *live = Some(LiveSearch {
            id,
            control,
            tree,
            #[cfg(test)]
            pid,
        });
        Ok(id)
    }

    /// Lets search `search_id` send another [`RESULT_CAP`] matches. Any other id is ignored.
    pub fn more(&self, search_id: u32) {
        if let Some(live) = self.live().as_ref().filter(|l| l.id == search_id) {
            let mut credit = live.control.lock();
            credit.granted = credit.granted.saturating_add(RESULT_CAP);
            live.control.changed.notify_all();
        }
    }

    /// Cancels search `search_id`, killing git's process tree; it ends in `Failed { Cancelled }`.
    /// An id that is not the live search is ignored.
    pub fn cancel(&self, search_id: u32) {
        let mut live = self.live();
        if live.as_ref().is_some_and(|l| l.id == search_id)
            && let Some(old) = live.take()
        {
            old.cancel();
        }
    }

    /// The OS process id of search `search_id`'s git, while it is the live search.
    #[cfg(test)]
    pub fn process_id(&self, search_id: u32) -> Option<u32> {
        self.live().as_ref().filter(|l| l.id == search_id).map(|l| l.pid)
    }
}

/// A running search's reader, on its own thread.
struct Walk {
    id: u32,
    control: Arc<Control>,
    tree: Arc<Mutex<Option<ProcessTree>>>,
    channel: Channel<SearchEvent>,
}

impl Walk {
    fn send(&self, event: SearchEvent) {
        let _ = self.channel.send(event);
    }

    fn cancelled(&self) -> bool {
        self.control.lock().cancelled
    }

    /// Sends `batch` as one `Matches` event, if it holds any.
    fn flush(&self, batch: &mut Vec<String>) {
        if !batch.is_empty() {
            self.send(SearchEvent::Matches { search_id: self.id, oids: std::mem::take(batch) });
        }
    }

    /// Waits until more than `total` matches are granted, or the search is cancelled. Returns
    /// false for a cancel.
    fn wait_for_credit(&self, total: u32) -> bool {
        let mut credit = self.control.lock();
        while !credit.cancelled && credit.granted <= total {
            credit = self.control.changed.wait(credit).unwrap_or_else(|p| p.into_inner());
        }
        !credit.cancelled
    }

    fn run(self, stdout: impl Read, stderr: Option<impl Read + Send + 'static>) {
        let stderr = stderr.map(|mut err| {
            std::thread::spawn(move || {
                let mut kept = Vec::new();
                let mut buf = [0u8; 8192];
                while let Ok(n) = err.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    if kept.len() < STDERR_CAP {
                        kept.extend_from_slice(&buf[..n.min(STDERR_CAP - kept.len())]);
                    }
                }
                String::from_utf8_lossy(&kept).into_owned()
            })
        });
        let mut reader = BufReader::new(stdout);
        let mut batch = Vec::new();
        let mut total: u32 = 0;
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let oid = line.trim();
            if oid.is_empty() {
                continue;
            }
            // Past the credit, the match waits: Capped goes out only once a further match shows
            // that more remain, so a search with exactly the cap's matches ends in Done.
            if total >= self.control.lock().granted {
                self.flush(&mut batch);
                self.send(SearchEvent::Capped { search_id: self.id, total });
                if !self.wait_for_credit(total) {
                    break;
                }
            }
            batch.push(oid.to_string());
            total += 1;
            if batch.len() >= BATCH_OIDS || reader.buffer().is_empty() {
                self.flush(&mut batch);
            }
        }
        if self.cancelled() {
            self.send(SearchEvent::Failed { search_id: self.id, error: GitError::Cancelled });
            return;
        }
        self.flush(&mut batch);
        let status = self.tree.lock().unwrap_or_else(|p| p.into_inner()).take().map(|mut tree| tree.child().wait());
        let stderr = stderr.and_then(|t| t.join().ok()).unwrap_or_default();
        if self.cancelled() {
            self.send(SearchEvent::Failed { search_id: self.id, error: GitError::Cancelled });
            return;
        }
        match status {
            Some(Ok(status)) if status.success() => self.send(SearchEvent::Done { search_id: self.id, total }),
            Some(Ok(status)) => self.send(SearchEvent::Failed {
                search_id: self.id,
                error: GitError::Other { stderr: if stderr.trim().is_empty() { format!("git exited with {status}") } else { stderr } },
            }),
            Some(Err(e)) => self.send(SearchEvent::Failed { search_id: self.id, error: GitError::Other { stderr: format!("could not wait for git: {e}") } }),
            None => self.send(SearchEvent::Failed { search_id: self.id, error: GitError::Cancelled }),
        }
    }
}

/// Cancels any live search and starts `query` in `repo_path`. See [`GitSearches::start`].
#[tauri::command]
pub async fn git_log_search(
    repo_path: String,
    query: SearchQuery,
    on_event: Channel<SearchEvent>,
    searches: State<'_, GitSearches>,
) -> Result<u32, GitError> {
    let searches = searches.inner();
    // Checking the refs runs git, and cancelling the old search waits for its git to exit.
    tokio::task::block_in_place(|| searches.start(&PathBuf::from(repo_path), query, on_event))
}

/// Lets search `search_id` send another [`RESULT_CAP`] matches: Load more.
#[tauri::command]
pub fn git_search_more(search_id: u32, searches: State<'_, GitSearches>) {
    searches.more(search_id)
}

/// Cancels search `search_id`. See [`GitSearches::cancel`].
#[tauri::command]
pub async fn git_search_cancel(search_id: u32, searches: State<'_, GitSearches>) -> Result<(), GitError> {
    let searches = searches.inner();
    tokio::task::block_in_place(|| searches.cancel(search_id));
    Ok(())
}
