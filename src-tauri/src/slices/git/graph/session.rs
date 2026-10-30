//! A graph session (#350, #370): one long-lived `git log` whose records feed a bounded queue. The
//! frontend grants rows; once it has every row it asked for, the session stops taking records, the
//! queue and then the pipe fill, and git blocks mid-walk until `git_graph_more` grants more. A
//! session never re-runs `log` or pages with `--skip`.
//!
//! At most one session is live: opening another closes the old one first.

use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use serde::Deserialize;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::super::error::GitError;
use super::cat_file::{CatFileBatch, GitObject};
use super::log::{log_command, GraphOrder, LogReader, LogRecord};
use super::page::{encode_page, AuthorTable, GraphEvent};

/// Rows per `Rows` page.
pub const PAGE_ROWS: usize = 512;
/// Rows a session loads before the frontend asks for more, unless it names another soft cap (#370).
pub const DEFAULT_SOFT_CAP: u32 = 50_000;
/// The most rows one session sends; past it the session ends with `Truncated`. #370 budgets the
/// frontend to 2M loaded rows.
pub const HARD_CAP: u32 = 2_000_000;
/// Records parsed ahead of the page being built. When it is full, parsing stops and git blocks.
const QUEUE_ROWS: usize = 4096;
/// A part-filled page is sent once git has been quiet this long, so a slow walk still shows rows.
const FLUSH_AFTER: Duration = Duration::from_millis(16);
/// How much of git's stderr a failure keeps.
const STDERR_CAP: usize = 64 * 1024;

/// Which refs the walk starts from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GraphRefs {
    /// Every local branch, every remote-tracking branch and HEAD; never tags (#370).
    #[default]
    Branches,
}

/// `GraphOptions` from `git_graph_open`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct GraphOptions {
    pub order: GraphOrder,
    pub refs: GraphRefs,
    /// Rows to load before pausing; `None` means [`DEFAULT_SOFT_CAP`].
    pub soft_cap: Option<u32>,
}

/// Checks a row count from the frontend: at least 1 and at most [`HARD_CAP`].
fn parse_rows(what: &str, rows: u32) -> Result<u32, GitError> {
    if rows == 0 || rows > HARD_CAP {
        return Err(GitError::Other { stderr: format!("{what} must be between 1 and {HARD_CAP}, not {rows}") });
    }
    Ok(rows)
}

/// The rows the frontend has granted, and whether the session is closing.
struct Credit {
    granted: u32,
    closed: bool,
}

struct Control {
    credit: Mutex<Credit>,
    changed: Condvar,
}

impl Control {
    fn lock(&self) -> MutexGuard<'_, Credit> {
        self.credit.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn is_closed(&self) -> bool {
        self.lock().closed
    }
}

struct Session {
    id: u32,
    repo: PathBuf,
    control: Arc<Control>,
    /// The running `git log`, shared with the emitter so either can end it.
    child: Arc<Mutex<Option<Child>>>,
    /// Shared so a read can run without holding the live-session lock.
    cat_file: Arc<Mutex<Option<CatFileBatch>>>,
}

impl Session {
    fn close(&self) {
        self.control.lock().closed = true;
        self.control.changed.notify_all();
        kill(&self.child);
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

fn kill(child: &Mutex<Option<Child>>) {
    if let Some(mut child) = child.lock().unwrap_or_else(|p| p.into_inner()).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// The live graph session, if any. Tauri manages one of these.
#[derive(Default)]
pub struct GraphSessions {
    live: Mutex<Option<Session>>,
    next_id: AtomicU32,
}

impl GraphSessions {
    fn live(&self) -> MutexGuard<'_, Option<Session>> {
        self.live.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Closes any live session and starts one on `repo` that sends to `channel`. Returns its id.
    pub fn open(&self, repo: &Path, options: GraphOptions, channel: Channel<InvokeResponseBody>) -> Result<u32, GitError> {
        let soft_cap = parse_rows("softCap", options.soft_cap.unwrap_or(DEFAULT_SOFT_CAP))?;
        if !repo.is_absolute() || !repo.is_dir() {
            return Err(GitError::Other { stderr: format!("{} is not a folder", repo.display()) });
        }
        let mut live = self.live();
        // Drop the old session before starting git, so two walks never run at once.
        drop(live.take());
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let control = Arc::new(Control { credit: Mutex::new(Credit { granted: soft_cap, closed: false }), changed: Condvar::new() });
        let child = Arc::new(Mutex::new(None));
        let walk = Walk { id, repo: repo.to_path_buf(), order: options.order, control: control.clone(), child: child.clone(), channel };
        walk.send(GraphEvent::Started { session_id: id });
        std::thread::Builder::new()
            .name(format!("topos-graph-{id}"))
            .spawn(move || walk.run())
            .map_err(|e| GitError::Other { stderr: format!("could not start the graph session: {e}") })?;
        *live = Some(Session { id, repo: repo.to_path_buf(), control, child, cat_file: Arc::new(Mutex::new(None)) });
        Ok(id)
    }

    /// Grants session `session_id` `rows` more rows, resuming a paused walk.
    pub fn more(&self, session_id: u32, rows: u32) -> Result<(), GitError> {
        let rows = parse_rows("rows", rows)?;
        let live = self.live();
        let session = live.as_ref().filter(|s| s.id == session_id).ok_or_else(|| not_open(session_id))?;
        let mut credit = session.control.lock();
        credit.granted = credit.granted.saturating_add(rows).min(HARD_CAP);
        session.control.changed.notify_all();
        Ok(())
    }

    /// Ends session `session_id`. Closing a session that is already gone is not an error.
    pub fn close(&self, session_id: u32) {
        let mut live = self.live();
        if live.as_ref().is_some_and(|s| s.id == session_id) {
            drop(live.take());
        }
    }

    /// Reads an object from session `session_id`'s repo through its one `cat-file --batch`.
    // The first frontend caller is commit details (#397); tests drive it until then.
    #[allow(dead_code)]
    pub fn read_object(&self, session_id: u32, name: &str) -> Result<Option<GitObject>, GitError> {
        let (repo, cat_file) = {
            let live = self.live();
            let session = live.as_ref().filter(|s| s.id == session_id).ok_or_else(|| not_open(session_id))?;
            (session.repo.clone(), session.cat_file.clone())
        };
        let mut cat_file = cat_file.lock().unwrap_or_else(|p| p.into_inner());
        if cat_file.is_none() {
            *cat_file = Some(CatFileBatch::start(&repo)?);
        }
        let result = cat_file.as_mut().expect("started above").read(name);
        if result.is_err() {
            // A broken reader is replaced on the next read rather than reused.
            *cat_file = None;
        }
        result
    }
}

fn not_open(session_id: u32) -> GitError {
    GitError::Other { stderr: format!("graph session {session_id} is not open") }
}

/// The session's worker: runs `git log`, pages its records and sends them.
struct Walk {
    id: u32,
    repo: PathBuf,
    order: GraphOrder,
    control: Arc<Control>,
    child: Arc<Mutex<Option<Child>>>,
    channel: Channel<InvokeResponseBody>,
}

/// How one `git log` run ended.
enum Ended {
    /// git exited after its output ended; `stderr` is what it printed.
    Exited { success: bool, stderr: String },
    /// The session closed, or the walk hit the hard cap and has already said so.
    Stopped,
    Failed(GitError),
}

impl Walk {
    fn send(&self, event: GraphEvent) {
        if self.control.is_closed() {
            return;
        }
        let json = serde_json::to_string(&event).expect("graph events serialize");
        let _ = self.channel.send(InvokeResponseBody::Json(json));
    }

    fn run(self) {
        let mut pager = Pager { sent: 0, page_index: 0, page: Vec::with_capacity(PAGE_ROWS), authors: AuthorTable::default() };
        let mut ended = self.walk(true, &mut pager);
        // A repo whose HEAD is unborn fails on `HEAD` before printing a row; walk its branches alone.
        if let Ended::Exited { success: false, .. } = ended {
            if pager.sent == 0 && !head_is_born(&self.repo) {
                ended = self.walk(false, &mut pager);
            }
        }
        match ended {
            Ended::Exited { success: true, .. } => self.send(GraphEvent::Done { session_id: self.id, total: pager.sent }),
            Ended::Exited { success: false, stderr } => {
                let stderr = if stderr.trim().is_empty() { "git log failed".to_string() } else { stderr.trim().to_string() };
                self.send(GraphEvent::Failed { session_id: self.id, error: GitError::Other { stderr } });
            }
            Ended::Failed(error) => self.send(GraphEvent::Failed { session_id: self.id, error }),
            Ended::Stopped => {}
        }
        kill(&self.child);
    }

    fn walk(&self, with_head: bool, pager: &mut Pager) -> Ended {
        let mut child = match log_command(&self.repo, self.order, with_head).spawn() {
            Ok(child) => child,
            Err(e) => return Ended::Failed(GitError::Other { stderr: format!("could not run git log: {e}") }),
        };
        let (Some(stdout), Some(mut stderr)) = (child.stdout.take(), child.stderr.take()) else {
            let _ = child.kill();
            return Ended::Failed(GitError::Other { stderr: "git log has no output pipes".into() });
        };
        {
            let mut slot = self.child.lock().unwrap_or_else(|p| p.into_inner());
            if self.control.is_closed() {
                let _ = child.kill();
                let _ = child.wait();
                return Ended::Stopped;
            }
            *slot = Some(child);
        }
        let stderr_reader = std::thread::spawn(move || {
            let mut kept = Vec::new();
            let _ = stderr.by_ref().take(STDERR_CAP as u64).read_to_end(&mut kept);
            // Keep draining so git never blocks on a full stderr pipe.
            let _ = std::io::copy(&mut stderr, &mut std::io::sink());
            String::from_utf8_lossy(&kept).into_owned()
        });

        // The bounded queue between the parser and the pager.
        let (tx, rx) = sync_channel::<std::io::Result<LogRecord>>(QUEUE_ROWS);
        let parser = std::thread::spawn(move || {
            let mut reader = LogReader::new(BufReader::new(stdout));
            loop {
                match reader.next_record() {
                    Ok(Some(record)) => {
                        if tx.send(Ok(record)).is_err() {
                            return;
                        }
                    }
                    Ok(None) => return,
                    Err(e) => {
                        let _ = tx.send(Err(e));
                        return;
                    }
                }
            }
        });

        let outcome = self.page_records(&rx, pager);
        drop(rx);
        if !matches!(outcome, Outcome::Drained) {
            kill(&self.child);
        }
        let _ = parser.join();
        let stderr = stderr_reader.join().unwrap_or_default();
        match outcome {
            Outcome::Drained => {
                let status = self.child.lock().unwrap_or_else(|p| p.into_inner()).take().map(|mut c| c.wait());
                match status {
                    Some(Ok(status)) => Ended::Exited { success: status.success(), stderr },
                    Some(Err(e)) => Ended::Failed(GitError::Other { stderr: format!("could not wait for git log: {e}") }),
                    // Closed while draining.
                    None => Ended::Stopped,
                }
            }
            Outcome::Stopped => Ended::Stopped,
            Outcome::Garbled(e) => Ended::Failed(GitError::Other { stderr: format!("could not read git log: {e}") }),
        }
    }

    /// Moves records from the queue into pages until git's output ends or the session stops.
    fn page_records(&self, rx: &Receiver<std::io::Result<LogRecord>>, pager: &mut Pager) -> Outcome {
        loop {
            let next = if pager.page.is_empty() {
                rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
            } else {
                rx.recv_timeout(FLUSH_AFTER)
            };
            let record = match next {
                Ok(Ok(record)) => record,
                Ok(Err(e)) => {
                    self.flush(pager);
                    return Outcome::Garbled(e);
                }
                Err(RecvTimeoutError::Timeout) => {
                    self.flush(pager);
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.flush(pager);
                    return Outcome::Drained;
                }
            };
            if pager.sent == HARD_CAP {
                self.flush(pager);
                self.send(GraphEvent::Truncated { session_id: self.id, cap: HARD_CAP });
                return Outcome::Stopped;
            }
            if !self.wait_for_credit(pager) {
                return Outcome::Stopped;
            }
            pager.page.push(record);
            pager.sent += 1;
            if pager.page.len() == PAGE_ROWS {
                self.flush(pager);
            }
        }
    }

    /// Blocks while every granted row has been sent, saying `Paused` first. False once closed.
    fn wait_for_credit(&self, pager: &mut Pager) -> bool {
        let mut credit = self.control.lock();
        if credit.closed {
            return false;
        }
        if credit.granted > pager.sent {
            return true;
        }
        drop(credit);
        self.flush(pager);
        self.send(GraphEvent::Paused { session_id: self.id, rows_loaded: pager.sent });
        credit = self.control.lock();
        while !credit.closed && credit.granted <= pager.sent {
            credit = self.control.changed.wait(credit).unwrap_or_else(|p| p.into_inner());
        }
        !credit.closed
    }

    fn flush(&self, pager: &mut Pager) {
        if pager.page.is_empty() {
            return;
        }
        let first_row = pager.sent - pager.page.len() as u32;
        let bytes = encode_page(self.id, pager.page_index, first_row, &pager.page, &mut pager.authors);
        pager.page.clear();
        pager.page_index += 1;
        if !self.control.is_closed() {
            let _ = self.channel.send(InvokeResponseBody::Raw(bytes));
        }
    }
}

enum Outcome {
    /// git's output ended.
    Drained,
    Stopped,
    Garbled(std::io::Error),
}

/// Rows sent so far and the page being built.
struct Pager {
    sent: u32,
    page_index: u32,
    page: Vec<LogRecord>,
    authors: AuthorTable,
}

/// Whether `HEAD` names a commit, which it doesn't before a repo's first commit.
fn head_is_born(repo: &Path) -> bool {
    super::super::op_runner::headless_git()
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "--verify", "-q", "HEAD^{commit}"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}
