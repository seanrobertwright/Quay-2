//! A graph session (#350, #370): one long-lived `git log` whose records feed a bounded queue. The
//! frontend grants rows; once it has every row it asked for, the session stops taking records, the
//! queue and then the pipe fill, and git blocks mid-walk until `git_graph_more` grants more. A
//! session never re-runs `log` or pages with `--skip`.
//!
//! At most one session is live: opening another closes the old one first.
//!
//! A refresh (#354, amended by #370) runs a second `git log` from the top and lays it out afresh,
//! testing every new row against lane-state checkpoints taken every 64 rows of the old walk. At
//! the first match it sends `Splice` and then the new rows above the match, kills the new
//! `git log` and keeps the old walk going. After 20k rows with no match it sends `Reset` and then
//! the rows laid out so far, and the new walk takes over, loading up to the rows granted before.

use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};

use super::super::error::GitError;
use super::cat_file::{CatFileBatch, GitObject};
use super::lanes::{LaneCheckpoint, LanePass};
use super::log::{log_command, GraphOrder, LogReader, LogRecord};
use super::page::{encode_page, AuthorTable, GraphEvent};
use super::refs::read_branch_tips;
use super::watch::{RepoChanged, RepoChangedSink, Watch, WatchState};

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
/// How often a walk waiting on git looks for a refresh or a close.
const POLL: Duration = Duration::from_millis(50);
/// Rows between lane-state checkpoints (#370): 16 to 64 converged almost as early as every row.
pub const CHECKPOINT_ROWS: u32 = 64;
/// Rows a refresh lays out looking for a checkpoint before it gives up and resets (#370).
pub const SPLICE_SEARCH_ROWS: u32 = 20_000;
/// Checkpoints are kept for rows above this. A match lower down would need more rows removed from
/// the top than the search reads, so it resets anyway; the bound keeps their memory small.
const CHECKPOINTED_ROWS: u32 = 2 * SPLICE_SEARCH_ROWS;

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

/// How a refresh joined its rows to the rows already sent; what `git_graph_refresh` returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Refreshed {
    /// It sent `Splice`; the rows below the match moved by `row_delta`.
    Spliced { row_delta: i64 },
    /// It sent `Reset` after laying out `searched_rows` rows without a match.
    Reset { searched_rows: u32 },
}

type RefreshReply = SyncSender<Result<Refreshed, GitError>>;

/// The rows the frontend has granted, whether the session is closing, and a refresh waiting to run.
struct Credit {
    granted: u32,
    closed: bool,
    refresh: Option<RefreshReply>,
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

/// The two `git log` processes a session may run at once: its walk's and a refresh's. Either may
/// hold the walk; closing the session kills both.
type Slots = [Arc<Mutex<Option<Child>>>; 2];

struct Session {
    id: u32,
    repo: PathBuf,
    control: Arc<Control>,
    /// The running `git log`s, shared with the walk so either can end them.
    children: Slots,
    /// Shared so a read can run without holding the live-session lock.
    cat_file: Arc<Mutex<Option<CatFileBatch>>>,
    /// Where the session's events go, which the watch also says its state on.
    channel: Channel<InvokeResponseBody>,
    /// The repository watch (#379), started by the first `watch` and dropped with the session.
    watch: Option<Watch>,
}

impl Session {
    fn close(&self) {
        self.control.lock().closed = true;
        self.control.changed.notify_all();
        self.children.iter().for_each(|c| kill(c));
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
    /// Where `git-repo-changed` goes; the app sets it to emit the global event.
    repo_changed: Mutex<Option<RepoChangedSink>>,
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
        let control = Arc::new(Control {
            credit: Mutex::new(Credit { granted: soft_cap, closed: false, refresh: None }),
            changed: Condvar::new(),
        });
        let children: Slots = Default::default();
        let walk = Walk {
            id,
            repo: repo.to_path_buf(),
            order: options.order,
            control: control.clone(),
            children: children.clone(),
            channel: channel.clone(),
        };
        walk.send(GraphEvent::Started { session_id: id });
        std::thread::Builder::new()
            .name(format!("topos-graph-{id}"))
            .spawn(move || walk.run())
            .map_err(|e| GitError::Other { stderr: format!("could not start the graph session: {e}") })?;
        *live = Some(Session {
            id,
            repo: repo.to_path_buf(),
            control,
            children,
            cat_file: Arc::new(Mutex::new(None)),
            channel,
            watch: None,
        });
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

    /// Sends every `git-repo-changed` to `sink`.
    pub fn on_repo_changed(&self, sink: impl Fn(RepoChanged) + Send + Sync + 'static) {
        *self.repo_changed.lock().unwrap_or_else(|p| p.into_inner()) = Some(Arc::new(sink));
    }

    /// Points session `session_id`'s watch at `worktree`, watching its files only while `visible`.
    /// A watch on another worktree, or one that stopped, is replaced. A folder that isn't there is
    /// gone. A watch that can't start leaves live updates off, which the frontend covers with a
    /// fingerprint check (#354).
    pub fn watch(&self, session_id: u32, worktree: &Path, visible: bool) -> Result<WatchState, GitError> {
        let sink = self.repo_changed.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let mut live = self.live();
        let session = live.as_mut().filter(|s| s.id == session_id).ok_or_else(|| not_open(session_id))?;
        if let Some(watch) = session.watch.as_mut().filter(|w| w.worktree() == worktree && w.is_running()) {
            return Ok(match watch.set_visible(visible) {
                Ok(()) => WatchState::Live,
                Err(reason) => WatchState::Off { reason },
            });
        }
        session.watch = None;
        // A worktree or repo that was moved or removed shows Topos's empty state, not a retry.
        if !worktree.is_dir() {
            return Ok(WatchState::Gone);
        }
        Ok(match Watch::start(session_id, &session.repo, worktree, visible, sink, session.channel.clone()) {
            Ok(watch) => {
                session.watch = Some(watch);
                WatchState::Live
            }
            Err(reason) => WatchState::Off { reason },
        })
    }

    /// Refreshes session `session_id`: re-runs its `git log` and splices or resets the rows sent, as
    /// the module doc says. Returns once the `Splice` or `Reset` and the rows it announces are sent.
    pub fn refresh(&self, session_id: u32) -> Result<Refreshed, GitError> {
        let (reply, answer) = sync_channel(1);
        {
            let live = self.live();
            let session = live.as_ref().filter(|s| s.id == session_id).ok_or_else(|| not_open(session_id))?;
            let mut credit = session.control.lock();
            if credit.refresh.is_some() {
                return Err(GitError::Other { stderr: format!("graph session {session_id} is already refreshing") });
            }
            credit.refresh = Some(reply);
            session.control.changed.notify_all();
        }
        // The walk drops the reply unanswered only when the session closes.
        answer.recv().unwrap_or_else(|_| Err(not_open(session_id)))
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

/// The session's worker: runs `git log`, pages its records and sends them, and runs refreshes.
struct Walk {
    id: u32,
    repo: PathBuf,
    order: GraphOrder,
    control: Arc<Control>,
    children: Slots,
    channel: Channel<InvokeResponseBody>,
}

/// One running `git log` and the threads reading it.
struct Stream {
    /// Which of the session's slots holds its process.
    slot: usize,
    rx: Receiver<std::io::Result<LogRecord>>,
    parser: JoinHandle<()>,
    stderr: JoinHandle<String>,
}

/// How one `git log` run ended.
enum Ended {
    /// git exited after its output ended; `stderr` is what it printed.
    Exited { success: bool, stderr: String },
    Failed(GitError),
}

/// Why the walk stopped taking records.
enum Outcome {
    /// git's output ended.
    Drained,
    /// The session closed.
    Stopped,
    /// The walk reached the hard cap with history left unread.
    Truncated,
    /// A refresh was asked for.
    Refresh(RefreshReply),
    Garbled(std::io::Error),
}

/// Where a refresh's search ended.
enum Found {
    /// The next new row is the old row `old_row`, and the lane states before them match.
    Match { old_row: u32, old: LaneCheckpoint, new: LaneCheckpoint },
    NoMatch,
}

impl Walk {
    fn send(&self, event: GraphEvent) {
        if self.control.is_closed() {
            return;
        }
        let json = serde_json::to_string(&event).expect("graph events serialize");
        let _ = self.channel.send(InvokeResponseBody::Json(json));
    }

    fn send_page(&self, bytes: Vec<u8>) {
        if !self.control.is_closed() {
            let _ = self.channel.send(InvokeResponseBody::Raw(bytes));
        }
    }

    /// Says how a finished walk ended, and keeps that event to say again after a splice.
    fn end(&self, end: &mut Option<GraphEvent>, event: GraphEvent) {
        self.send(event.clone());
        *end = Some(event);
    }

    fn run(self) {
        let mut pager = Pager::new(LanePass::new(read_branch_tips(&self.repo)), AuthorTable::default());
        let mut end: Option<GraphEvent> = None;
        let mut stream = match self.start(true, 0) {
            Ok(stream) => Some(stream),
            Err(error) => {
                self.end(&mut end, GraphEvent::Failed { session_id: self.id, error });
                None
            }
        };
        let mut retried_without_head = false;
        loop {
            let outcome = match &stream {
                Some(s) => self.page_records(&s.rx, &mut pager),
                None => self.idle(),
            };
            match outcome {
                Outcome::Stopped => break,
                Outcome::Refresh(reply) => {
                    let (next, result) = self.refresh(stream.take(), &mut pager, &mut end);
                    stream = next;
                    let _ = reply.send(result);
                }
                Outcome::Truncated => {
                    self.abandon(stream.take());
                    self.end(&mut end, GraphEvent::Truncated { session_id: self.id, cap: HARD_CAP });
                }
                Outcome::Garbled(e) => {
                    self.abandon(stream.take());
                    let error = GitError::Other { stderr: format!("could not read git log: {e}") };
                    self.end(&mut end, GraphEvent::Failed { session_id: self.id, error });
                }
                Outcome::Drained => {
                    let ended = self.finish(stream.take().expect("only a stream drains"));
                    // A repo whose HEAD is unborn fails on `HEAD` before printing a row; walk its
                    // branches alone.
                    if matches!(ended, Ended::Exited { success: false, .. })
                        && pager.sent == 0
                        && !retried_without_head
                        && !head_is_born(&self.repo)
                    {
                        retried_without_head = true;
                        stream = self.start(false, 0).ok();
                        continue;
                    }
                    let event = match ended {
                        Ended::Exited { success: true, .. } => GraphEvent::Done { session_id: self.id, total: pager.sent },
                        Ended::Exited { success: false, stderr } => {
                            let stderr =
                                if stderr.trim().is_empty() { "git log failed".to_string() } else { stderr.trim().to_string() };
                            GraphEvent::Failed { session_id: self.id, error: GitError::Other { stderr } }
                        }
                        Ended::Failed(error) => GraphEvent::Failed { session_id: self.id, error },
                    };
                    self.end(&mut end, event);
                }
            }
        }
        self.children.iter().for_each(|c| kill(c));
    }

    /// Starts a `git log` whose process lives in slot `slot`.
    fn start(&self, with_head: bool, slot: usize) -> Result<Stream, GitError> {
        let mut child = log_command(&self.repo, self.order, with_head)
            .spawn()
            .map_err(|e| GitError::Other { stderr: format!("could not run git log: {e}") })?;
        let (Some(stdout), Some(mut stderr)) = (child.stdout.take(), child.stderr.take()) else {
            let _ = child.kill();
            return Err(GitError::Other { stderr: "git log has no output pipes".into() });
        };
        {
            let mut held = self.children[slot].lock().unwrap_or_else(|p| p.into_inner());
            if self.control.is_closed() {
                let _ = child.kill();
                let _ = child.wait();
                return Err(GitError::Other { stderr: "the graph session closed".into() });
            }
            *held = Some(child);
        }
        let stderr = std::thread::spawn(move || {
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
        Ok(Stream { slot, rx, parser, stderr })
    }

    /// Waits for a stream whose output has ended to exit.
    fn finish(&self, stream: Stream) -> Ended {
        let _ = stream.parser.join();
        let stderr = stream.stderr.join().unwrap_or_default();
        let status = self.children[stream.slot].lock().unwrap_or_else(|p| p.into_inner()).take().map(|mut c| c.wait());
        match status {
            Some(Ok(status)) => Ended::Exited { success: status.success(), stderr },
            Some(Err(e)) => Ended::Failed(GitError::Other { stderr: format!("could not wait for git log: {e}") }),
            // Closed while draining; nothing is sent once closed.
            None => Ended::Exited { success: true, stderr },
        }
    }

    /// Kills a stream that is no longer wanted.
    fn abandon(&self, stream: Option<Stream>) {
        let Some(stream) = stream else { return };
        kill(&self.children[stream.slot]);
        drop(stream.rx);
        let _ = stream.parser.join();
        let _ = stream.stderr.join();
    }

    /// A close or a refresh, if one is waiting.
    fn interruption(&self) -> Option<Outcome> {
        let mut credit = self.control.lock();
        if credit.closed {
            return Some(Outcome::Stopped);
        }
        credit.refresh.take().map(Outcome::Refresh)
    }

    /// Waits, with no walk running, for a refresh or a close.
    fn idle(&self) -> Outcome {
        let mut credit = self.control.lock();
        loop {
            if credit.closed {
                return Outcome::Stopped;
            }
            if let Some(reply) = credit.refresh.take() {
                return Outcome::Refresh(reply);
            }
            credit = self.control.changed.wait(credit).unwrap_or_else(|p| p.into_inner());
        }
    }

    /// Moves records from the queue into pages until git's output ends or something interrupts.
    fn page_records(&self, rx: &Receiver<std::io::Result<LogRecord>>, pager: &mut Pager) -> Outcome {
        loop {
            let record = match pager.held.take() {
                Some(record) => record,
                None => match rx.recv_timeout(if pager.page.is_empty() { POLL } else { FLUSH_AFTER }) {
                    Ok(Ok(record)) => record,
                    Ok(Err(e)) => {
                        self.flush(pager);
                        return Outcome::Garbled(e);
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        self.flush(pager);
                        if let Some(outcome) = self.interruption() {
                            return outcome;
                        }
                        continue;
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        self.flush(pager);
                        return Outcome::Drained;
                    }
                },
            };
            if pager.sent == HARD_CAP {
                self.flush(pager);
                return Outcome::Truncated;
            }
            if let Some(outcome) = self.wait_for_credit(pager) {
                // The record waits for the walk to resume.
                pager.held = Some(record);
                return outcome;
            }
            pager.push(record);
            if pager.page.len() == PAGE_ROWS {
                self.flush(pager);
            }
        }
    }

    /// Blocks while every granted row has been sent, saying `Paused` first. Returns what
    /// interrupted it, or None once there is credit.
    fn wait_for_credit(&self, pager: &mut Pager) -> Option<Outcome> {
        let mut said_paused = false;
        let mut credit = self.control.lock();
        loop {
            if credit.closed {
                return Some(Outcome::Stopped);
            }
            if let Some(reply) = credit.refresh.take() {
                drop(credit);
                self.flush(pager);
                return Some(Outcome::Refresh(reply));
            }
            if credit.granted > pager.sent {
                return None;
            }
            if !said_paused {
                drop(credit);
                self.flush(pager);
                self.send(GraphEvent::Paused { session_id: self.id, rows_loaded: pager.sent });
                said_paused = true;
                credit = self.control.lock();
                continue;
            }
            credit = self.control.changed.wait(credit).unwrap_or_else(|p| p.into_inner());
        }
    }

    /// Encodes the page being built, and sends it or, while a refresh searches, buffers it.
    fn flush(&self, pager: &mut Pager) {
        if pager.page.is_empty() {
            return;
        }
        let first_row = pager.sent - pager.page.len() as u32;
        let layout = pager.lanes.take_page();
        let bytes = encode_page(self.id, pager.page_index, first_row, &pager.page, &layout, &mut pager.authors);
        pager.page.clear();
        pager.page_index += 1;
        match &mut pager.buffer {
            Some(buffer) => buffer.push(bytes),
            None => self.send_page(bytes),
        }
    }

    /// Re-runs `git log` and splices its rows onto the rows `pager` has sent, or resets to them.
    /// Returns the stream the walk goes on with.
    fn refresh(
        &self,
        old: Option<Stream>,
        pager: &mut Pager,
        end: &mut Option<GraphEvent>,
    ) -> (Option<Stream>, Result<Refreshed, GitError>) {
        self.flush(pager);
        let slot = old.as_ref().map_or(0, |s| 1 - s.slot);
        // Each git process costs tens of ms to start on Windows, so the tips are read while the
        // walk starts. The walk assumes HEAD is born and retries without it when it isn't.
        let repo = self.repo.clone();
        let tips = std::thread::spawn(move || read_branch_tips(&repo));
        let mut new = match self.start(true, slot) {
            Ok(stream) => stream,
            Err(e) => return (old, Err(e)),
        };
        let mut retried_without_head = false;
        // The author table runs on, so the old rows' author ids stay valid after a splice.
        let mut fresh = Pager::new(LanePass::new(tips.join().unwrap_or_default()), pager.authors.clone());
        fresh.buffer = Some(Vec::new());
        let found = loop {
            if fresh.sent >= SPLICE_SEARCH_ROWS {
                break Found::NoMatch;
            }
            let record = match new.rx.recv_timeout(POLL) {
                Ok(Ok(record)) => record,
                Ok(Err(e)) => {
                    self.abandon(Some(new));
                    return (old, Err(GitError::Other { stderr: format!("could not read git log: {e}") }));
                }
                Err(RecvTimeoutError::Timeout) => {
                    if self.control.is_closed() {
                        self.abandon(Some(new));
                        return (old, Err(GitError::Other { stderr: "the graph session closed".into() }));
                    }
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if fresh.sent == 0 && !retried_without_head && !head_is_born(&self.repo) {
                        retried_without_head = true;
                        self.abandon(Some(new));
                        new = match self.start(false, slot) {
                            Ok(stream) => stream,
                            Err(e) => return (old, Err(e)),
                        };
                        continue;
                    }
                    break Found::NoMatch;
                }
            };
            // Row 0 never matches: a splice needs a new row to carry the new rows' first track.
            if fresh.sent > 0 {
                if let Some((old_row, old_state)) = pager.checkpoints.get(&record.oid) {
                    let new_state = fresh.lanes.checkpoint();
                    if new_state.hash == old_state.hash {
                        break Found::Match { old_row: *old_row, old: old_state.clone(), new: new_state };
                    }
                }
            }
            fresh.push(record);
            if fresh.page.len() == PAGE_ROWS {
                self.flush(&mut fresh);
            }
        };
        self.flush(&mut fresh);
        let buffered = fresh.buffer.take().unwrap_or_default();
        match found {
            Found::Match { old_row, old: old_state, new: new_state } => {
                self.abandon(Some(new));
                let delta = fresh.sent as i64 - old_row as i64;
                let crossing: Vec<[u32; 2]> = old_state.edges.iter().zip(&new_state.edges).map(|(&o, &n)| [o, n]).collect();
                let live: Vec<[u32; 2]> = old_state.tracks.iter().zip(&new_state.tracks).map(|(&o, &n)| [o, n]).collect();
                let ids = Renumbering::new(&old_state, &new_state, &crossing, &live);
                self.send(GraphEvent::Splice {
                    session_id: self.id,
                    replace_rows: old_row,
                    new_rows: fresh.sent,
                    row_delta: delta,
                    edges_from: old_state.next_edge,
                    edges_to: new_state.next_edge,
                    tracks_from: old_state.next_track,
                    tracks_to: new_state.next_track,
                    crossing_edges: crossing,
                    live_tracks: live,
                });
                buffered.into_iter().for_each(|bytes| self.send_page(bytes));
                pager.splice(fresh, old_row, delta, &ids);
                {
                    let mut credit = self.control.lock();
                    credit.granted = (credit.granted as i64 + delta).clamp(1, HARD_CAP as i64) as u32;
                }
                // A finished walk says again how it ended, with the new total.
                if old.is_none() {
                    if let Some(mut event) = end.take() {
                        if let GraphEvent::Done { total, .. } = &mut event {
                            *total = pager.sent;
                        }
                        self.end(end, event);
                    }
                }
                (old, Ok(Refreshed::Spliced { row_delta: delta }))
            }
            Found::NoMatch => {
                self.abandon(old);
                self.send(GraphEvent::Reset { session_id: self.id });
                buffered.into_iter().for_each(|bytes| self.send_page(bytes));
                let searched_rows = fresh.sent;
                *pager = fresh;
                *end = None;
                (Some(new), Ok(Refreshed::Reset { searched_rows }))
            }
        }
    }
}

/// How a splice renames the old rows' edge and track ids: those opened at or below the match
/// follow on from the new rows' ids, and those crossing the match take the new ids crossing it.
struct Renumbering {
    edges_from: u32,
    edges_to: u32,
    tracks_from: u32,
    tracks_to: u32,
    crossing: HashMap<u32, u32>,
    live: HashMap<u32, u32>,
}

impl Renumbering {
    fn new(old: &LaneCheckpoint, new: &LaneCheckpoint, crossing: &[[u32; 2]], live: &[[u32; 2]]) -> Self {
        Self {
            edges_from: old.next_edge,
            edges_to: new.next_edge,
            tracks_from: old.next_track,
            tracks_to: new.next_track,
            crossing: crossing.iter().map(|&[o, n]| (o, n)).collect(),
            live: live.iter().map(|&[o, n]| (o, n)).collect(),
        }
    }

    fn edge(&self, id: u32) -> u32 {
        if id >= self.edges_from {
            id - self.edges_from + self.edges_to
        } else {
            self.crossing.get(&id).copied().unwrap_or(id)
        }
    }

    fn track(&self, id: u32) -> u32 {
        if id >= self.tracks_from {
            id - self.tracks_from + self.tracks_to
        } else {
            self.live.get(&id).copied().unwrap_or(id)
        }
    }

    fn checkpoint(&self, cp: LaneCheckpoint) -> LaneCheckpoint {
        LaneCheckpoint {
            hash: cp.hash,
            next_edge: self.edge(cp.next_edge),
            next_track: self.track(cp.next_track),
            edges: cp.edges.into_iter().map(|e| self.edge(e)).collect(),
            tracks: cp.tracks.into_iter().map(|t| self.track(t)).collect(),
        }
    }
}

/// Rows sent so far, the page being built, and the lane-state checkpoints a refresh splices at.
struct Pager {
    sent: u32,
    page_index: u32,
    page: Vec<LogRecord>,
    authors: AuthorTable,
    lanes: LanePass,
    /// A record read when the walk was interrupted, placed first when it resumes.
    held: Option<LogRecord>,
    /// The lane state before every `CHECKPOINT_ROWS`th row, keyed by that row's oid, with its row.
    checkpoints: HashMap<String, (u32, LaneCheckpoint)>,
    /// Set while a refresh searches: pages wait here until it knows how to announce them.
    buffer: Option<Vec<Vec<u8>>>,
}

impl Pager {
    fn new(lanes: LanePass, authors: AuthorTable) -> Self {
        Self {
            sent: 0,
            page_index: 0,
            page: Vec::with_capacity(PAGE_ROWS),
            authors,
            lanes,
            held: None,
            checkpoints: HashMap::new(),
            buffer: None,
        }
    }

    /// Lays out `record` as the next row and adds it to the page.
    fn push(&mut self, record: LogRecord) {
        if self.sent % CHECKPOINT_ROWS == 0 && self.sent < CHECKPOINTED_ROWS {
            self.checkpoints.insert(record.oid.clone(), (self.sent, self.lanes.checkpoint()));
        }
        if self.page.is_empty() {
            self.lanes.begin_page();
        }
        self.lanes.place(self.sent, &record.oid, &record.parents, &record.subject);
        self.page.push(record);
        self.sent += 1;
    }

    /// Puts `top`, a refresh's rows above old row `old_row`, over the rows from there on, which
    /// move by `delta` and take the ids `ids` gives them.
    fn splice(&mut self, top: Pager, old_row: u32, delta: i64, ids: &Renumbering) {
        let next = self.lanes.checkpoint();
        self.lanes.renumber(|e| ids.edge(e), |t| ids.track(t), ids.edge(next.next_edge), ids.track(next.next_track));
        self.sent = (self.sent as i64 + delta) as u32;
        self.page_index = top.page_index;
        self.authors = top.authors;
        let mut checkpoints = top.checkpoints;
        for (oid, (row, cp)) in self.checkpoints.drain() {
            let moved = row as i64 + delta;
            if row >= old_row && moved < CHECKPOINTED_ROWS as i64 {
                checkpoints.insert(oid, (moved as u32, ids.checkpoint(cp)));
            }
        }
        self.checkpoints = checkpoints;
    }
}

/// Whether `HEAD` names a commit, which it doesn't before a repo's first commit.
pub(super) fn head_is_born(repo: &Path) -> bool {
    super::super::op_runner::headless_git()
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "--verify", "-q", "HEAD^{commit}"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}
