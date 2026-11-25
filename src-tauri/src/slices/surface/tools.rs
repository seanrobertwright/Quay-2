//! The surface tools: a call's checks, its commit, its wait and its result.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock, Weak};
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::{json, Value};

use super::ask::{self, Ask};
use super::board::{self, Board};
use super::check::{Accepted, CheckRequest, Checks, HeldSurface, Verdict};
use super::daily_record::{Clock, DailyRecord, Fired};
use super::guide;
use super::place::Place;
use super::raw::{self, RawCall};
use super::read;
use super::rejection::{CallError, QuayFailed, Rejection};
use super::review::{self, Review};
use super::store::{
    AnswerRefused, Answered, BeingSent, Changed, CommitRefused, Creation, Dismissed, MoveRefused, Standing, SurfaceKey,
    SurfaceRecord, SurfaceStore, ToType,
};
use super::timing::Timing;
use super::typing::{NotTyped, Terminals};
use super::unsent::{Page, UnsentRefused, UnsentSave};
use super::wait::Wait;

mod show_raw;

/// How long the surface record may take to be finished, which Quay's exit waits for.
const RECORD_LIMIT: Duration = Duration::from_secs(1);

/// The window that checks and draws surfaces.
pub trait Webview: Send + Sync {
    fn check(&self, request: &CheckRequest);
    fn show(&self, record: &SurfaceRecord);
    /// Takes a surface Quay no longer has off the screen.
    fn remove(&self, key: &SurfaceKey);
}

struct Inner {
    timing: Timing,
    store: SurfaceStore,
    daily_record: DailyRecord,
    checks: Checks,
    /// One lock per terminal, held while a call of it is checked and committed and never while one
    /// waits for its answer. It lives as long as a call holds it or is queued for it.
    queues: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
    webview: OnceLock<Box<dyn Webview>>,
    terminals: OnceLock<Box<dyn Terminals>>,
}

#[derive(Clone)]
pub struct SurfaceTools(Arc<Inner>);

/// A typed tool's call that Rust has found nothing wrong with.
struct Typed<'a> {
    tool: &'static str,
    /// What Quay names its surfaces by.
    named: &'static str,
    place: Place,
    title: &'a str,
    /// The arguments as Rust checked them.
    checked: Value,
}

impl Default for SurfaceTools {
    fn default() -> Self {
        Self::new()
    }
}

impl SurfaceTools {
    pub fn new() -> Self {
        Self::with(Timing::default())
    }

    pub(crate) fn with(timing: Timing) -> Self {
        let daily_record = DailyRecord::default();
        Self(Arc::new(Inner {
            timing,
            store: SurfaceStore::recorded(daily_record.clone()),
            daily_record,
            checks: Checks::default(),
            queues: Mutex::default(),
            webview: OnceLock::new(),
            terminals: OnceLock::new(),
        }))
    }

    /// Names the window that checks and draws, once.
    pub fn set_webview(&self, webview: impl Webview + 'static) {
        if self.0.webview.set(Box::new(webview)).is_err() {
            tracing::error!("The surfaces' webview was set twice; the first stays");
        }
    }

    /// Names the terminals an answer is typed into when no call is open to return it, once.
    pub fn set_terminals(&self, terminals: impl Terminals + 'static) {
        if self.0.terminals.set(Box::new(terminals)).is_err() {
            tracing::error!("The surfaces' terminals were set twice; the first stay");
        }
    }

    /// Keeps the surface record in `folder`, by `clock`, once.
    pub fn keep_record(&self, folder: PathBuf, clock: Clock) {
        // The record's thread must not keep the surfaces alive, which would keep it running
        let surfaces = Arc::downgrade(&self.0);
        self.0.daily_record.keep(folder, clock, move |terminal_id| surfaces.upgrade()?.terminals.get()?.named(terminal_id));
    }

    /// Waits until the surface record has what has happened so far, but for what was lost, for `RECORD_LIMIT`
    /// at the most. The error log is told when that was too short.
    pub fn finish_record(&self) {
        self.0.daily_record.finish(RECORD_LIMIT);
    }

    pub(super) fn store(&self) -> &SurfaceStore {
        &self.0.store
    }

    /// Says that `terminal_id` is listed with its launch `launch` running. Its calls are taken from
    /// here on.
    pub fn launched(&self, terminal_id: &str, launch: u64) {
        self.0.store.launched(terminal_id, launch);
    }

    /// Says that `terminal_id`'s launch `launch` is over: its process exited, or a later one has begun.
    /// Each of its surfaces that is not settled ends, and so does each open wait.
    pub fn launch_over(&self, terminal_id: &str, launch: u64) {
        let (ended, left) = self.0.store.launch_over(terminal_id, launch);
        for record in &ended {
            self.show(record);
        }
        self.remove_all(&left);
    }

    /// Says that `terminal_id` has closed. Nothing of it is kept.
    pub fn terminal_closed(&self, terminal_id: &str) {
        self.remove_all(&self.0.store.close(terminal_id));
    }

    /// Ends the waits of `terminal_id`'s calls, when its own turn has ended or been interrupted:
    /// nothing in it listens any more.
    pub fn turn_ended(&self, terminal_id: &str) {
        self.0.store.end_calls(terminal_id);
    }

    /// Ends the wait of `terminal_id`'s open call with the request id `request`, which its CLI says
    /// it has given up. One that names no open call changes nothing: OpenCode cancels each call after
    /// it has returned, and counts its requests from the start again at each launch.
    pub fn call_cancelled(&self, terminal_id: &str, request: &Value) {
        self.0.store.cancel_calls(terminal_id, request);
    }

    /// The surface tools, which `tools/list` answers with after those of `mcp_tools.json`. Parsed once.
    pub fn list() -> &'static [Value] {
        static TOOLS: OnceLock<Vec<Value>> = OnceLock::new();
        TOOLS.get_or_init(|| serde_json::from_str(TOOL_LIST).expect("surface_tools.json is a JSON list"))
    }

    /// Runs `terminal_id`'s call of `tool`, whose JSON-RPC request has the id `request`. `None` when
    /// it is not a surface tool.
    pub async fn call(&self, terminal_id: &str, request: &Value, tool: &str, arguments: &Value) -> Option<Value> {
        match tool {
            ask::TOOL => Some(match Ask::parse(arguments) {
                Err(rejection) => self.reject(terminal_id, ask::TOOL, None, &rejection),
                Ok(ask) => {
                    let title = &ask.questions[0].question;
                    let typed =
                        Typed { tool: ask::TOOL, named: ask::NAMED, place: ask::PLACE, title, checked: json!(ask) };
                    self.show_typed(terminal_id, request, arguments, typed).await
                }
            }),
            review::TOOL => Some(match Review::parse(arguments) {
                Err(rejection) => self.reject(terminal_id, review::TOOL, None, &rejection),
                Ok(review) => {
                    let (named, place, title) = (review::NAMED, review::PLACE, &review.title);
                    let typed = Typed { tool: review::TOOL, named, place, title, checked: json!(review) };
                    self.show_typed(terminal_id, request, arguments, typed).await
                }
            }),
            board::TOOL => Some(match Board::parse(arguments) {
                Err(rejection) => self.reject(terminal_id, board::TOOL, Some(board::named(arguments)), &rejection),
                Ok(board) => self.show_board(terminal_id, request, arguments, &board).await,
            }),
            raw::TOOL => Some(match RawCall::parse(arguments) {
                Err(rejection) => self.reject(terminal_id, raw::TOOL, None, &rejection),
                Ok((call, found)) => self.show_raw(terminal_id, request, arguments, &call, found).await,
            }),
            guide::TOOL => Some(verbatim_result(guide::GUIDE)),
            read::TOOL => Some(match read::read(&self.0.store, terminal_id, arguments) {
                Err(rejection) => self.reject(terminal_id, read::TOOL, read::named(arguments), &rejection),
                Ok(body) => {
                    self.0.store.accepted(terminal_id, read::TOOL);
                    text_result(body)
                }
            }),
            _ => None,
        }
    }

    /// Shows what `terminal_id`'s call `typed` makes, and waits for its answer if it asks for one.
    async fn show_typed(&self, terminal_id: &str, request: &Value, arguments: &Value, typed: Typed<'_>) -> Value {
        let Typed { tool, named, place, title, checked } = typed;
        let Some(wait) = Wait::start(self, terminal_id, request) else {
            return QuayFailed::TerminalOver.result();
        };
        let creation = Creation { tool, arguments, title, place, call: wait.number() };
        let key = {
            let queue = self.queue(terminal_id);
            let _one_at_a_time = queue.lock().await;
            match self.0.store.rejoin(terminal_id, creation) {
                Some(key) => key,
                None => {
                    let Some(key) = self.0.store.name(terminal_id, named) else {
                        return QuayFailed::TerminalOver.result();
                    };
                    match self.check_and_commit(&key, creation, checked).await {
                        Err(failure) => return failure,
                        Ok(record) => {
                            self.show(&record);
                            if !record.asks {
                                return text_result(json!({ "shown": true }));
                            }
                            key
                        }
                    }
                }
            }
        };
        self.answered(wait, &key, &[]).await
    }

    /// The result of a call that waits for the first answer to the surface `key` or to one of `others`,
    /// which are the same terminal's. Without one it is told of the first that still asks.
    async fn answered(&self, wait: Wait, key: &SurfaceKey, others: &[SurfaceKey]) -> Value {
        if let Some(answer) = wait.answer(self.0.timing.wait).await {
            return text_result(answer);
        }
        let standing = |key: &SurfaceKey| self.0.store.standing(key);
        let asks = |key: &&SurfaceKey| standing(key) == Some(Standing::NoAnswerYet);
        let key = std::iter::once(key).chain(others).find(asks).unwrap_or(key);
        match standing(key).unwrap_or(Standing::Ended) {
            over @ (Standing::Ended | Standing::Withdrawn) => {
                text_result(json!({ "surface_id": key.id, "state": over.state() }))
            }
            _ => text_result(json!({ "surface_id": key.id, "state": "no_answer_yet", "next": NO_ANSWER_NEXT })),
        }
    }

    /// Shows a board, which sends nothing back, so its call waits for no answer.
    async fn show_board(&self, terminal_id: &str, request: &Value, arguments: &Value, board: &Board) -> Value {
        let Some(wait) = Wait::start(self, terminal_id, request) else {
            return QuayFailed::TerminalOver.result();
        };
        let creation =
            Creation { tool: board::TOOL, arguments, title: &board.title, place: board::PLACE, call: wait.number() };
        let key = SurfaceKey::new(terminal_id, &board.id);
        let queue = self.queue(terminal_id);
        let _one_at_a_time = queue.lock().await;
        let accepted = match self.check(&key, creation, json!(board)).await {
            Err(failure) => return failure,
            Ok(accepted) => accepted,
        };
        match self.0.store.commit_board(&key, creation, board, accepted) {
            Err(refused) => self.commit_refused(&key, creation, refused),
            Ok(shown) => {
                self.show_changed(&shown);
                text_result(json!({ "shown": true }))
            }
        }
    }

    fn queue(&self, terminal_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut queues = self.0.queues.lock();
        if let Some(queue) = queues.get(terminal_id).and_then(Weak::upgrade) {
            return queue;
        }
        queues.retain(|_, queue| queue.strong_count() > 0);
        let queue = Arc::default();
        queues.insert(terminal_id.to_string(), Arc::downgrade(&queue));
        queue
    }

    /// Commits a call once the webview has found nothing wrong with it. One for a dismissed id is not
    /// checked. Nothing is committed for a verdict that came too late. The error is the result its agent
    /// gets.
    pub(super) async fn check_and_commit(
        &self,
        key: &SurfaceKey,
        creation: Creation<'_>,
        arguments: Value,
    ) -> Result<SurfaceRecord, Value> {
        let accepted = self.check(key, creation, arguments).await?;
        self.0.store.commit(key, creation, accepted).map_err(|refused| self.commit_refused(key, creation, refused))
    }

    /// What the webview made of a call it found nothing wrong with. One for a dismissed id is not checked.
    /// The error is the result its agent gets.
    async fn check(&self, key: &SurfaceKey, creation: Creation<'_>, arguments: Value) -> Result<Accepted, Value> {
        let terminal_id = &key.terminal_id;
        let tool = creation.tool;
        if self.0.store.is_dismissed(key, creation) {
            return Err(dismissed_result());
        }
        match self.verdict_on(key, tool, arguments, Vec::new()).await {
            None => {
                tracing::error!("{terminal_id}: no verdict on a {tool} call in {:?}", self.0.timing.verdict);
                Err(QuayFailed::NoVerdict.result())
            }
            Some(Verdict::Failed { errors, .. }) => {
                tracing::error!("{terminal_id}: Quay's expansion of a {tool} call failed the engine: {errors:?}");
                Err(QuayFailed::Expansion.result())
            }
            Some(Verdict::Accepted(accepted)) => Ok(accepted),
            Some(Verdict::Surfaces { .. }) => {
                tracing::error!("{terminal_id}: a {tool} call was given a raw call's verdict");
                Err(QuayFailed::WrongVerdict.result())
            }
        }
    }

    /// What the webview makes of `tool`'s call for the surface `key`, which updates those that are `held`.
    /// `None` when it gave no verdict in time.
    async fn verdict_on(
        &self,
        key: &SurfaceKey,
        tool: &str,
        arguments: Value,
        held: Vec<HeldSurface>,
    ) -> Option<Verdict> {
        let send = |request: &CheckRequest| {
            // One sent before the window is named is handed over when it has loaded
            if let Some(webview) = self.0.webview.get() {
                webview.check(request);
            }
        };
        self.0.checks.check(tool, &key.id, arguments, held, self.0.timing.verdict, send).await
    }

    /// The result of a call whose surface was not committed.
    fn commit_refused(&self, key: &SurfaceKey, creation: Creation, refused: CommitRefused) -> Value {
        let SurfaceKey { terminal_id, id } = key;
        let tool = creation.tool;
        match refused {
            CommitRefused::TerminalOver => QuayFailed::TerminalOver.result(),
            CommitRefused::Dismissed => dismissed_result(),
            // The one tool whose agent chooses the id
            CommitRefused::IdInUse if tool == board::TOOL => {
                let error = CallError {
                    code: "INTEGRITY_ERROR".into(),
                    surface_id: Some(id.clone()),
                    path: "/id".to_string(),
                    message: format!(
                        "Surface \"{id}\" already exists. Update it, or delete it and create it again."
                    ),
                };
                self.reject(terminal_id, tool, Some(id), &Rejection::of(error))
            }
            CommitRefused::IdInUse => {
                tracing::error!("{terminal_id}: a {tool} call was given the id {id}, which is in use");
                QuayFailed::Expansion.result()
            }
            CommitRefused::PastLimit(past) => {
                self.reject(terminal_id, tool, Some(id), &Rejection::invalid("", past.words()))
            }
        }
    }

    /// The result of `terminal_id`'s call of `tool` that `rejection` rejects. The window is told nothing. The
    /// call is recorded as about the surface that an error of it names first, or else about `id`.
    fn reject(&self, terminal_id: &str, tool: &str, id: Option<&str>, rejection: &Rejection) -> Value {
        let named = rejection.errors().iter().find_map(|error| error.surface_id.as_deref());
        let run = self.0.store.rejected(terminal_id, tool, named.or(id), rejection);
        rejection.result(tool, run)
    }

    fn show(&self, record: &SurfaceRecord) {
        let Some(webview) = self.0.webview.get() else {
            return;
        };
        webview.show(record);
        // One that left meanwhile may have been taken off the screen before it was drawn
        let key = SurfaceKey::new(&record.terminal_id, &record.id);
        if self.0.store.record(&key).is_none() {
            webview.remove(&key);
        }
    }

    fn remove(&self, key: &SurfaceKey) {
        if let Some(webview) = self.0.webview.get() {
            webview.remove(key);
        }
    }

    fn remove_all(&self, keys: &[SurfaceKey]) {
        for key in keys {
            self.remove(key);
        }
    }

    /// Draws a surface that has changed, and takes what left for it off the screen.
    fn show_changed(&self, Changed { record, left }: &Changed) {
        self.show(record);
        self.remove_all(left);
    }

    /// The webview's verdict on the check `call`. One that is late, or a second one, is dropped.
    pub fn verdict(&self, call: u64, verdict: Verdict) {
        self.0.checks.verdict(call, verdict);
    }

    /// The checks without a verdict, for a webview that has just loaded.
    pub fn unanswered_checks(&self) -> Vec<CheckRequest> {
        self.0.checks.unanswered()
    }

    /// Every surface, for a webview that has just loaded.
    pub fn surfaces(&self) -> Vec<SurfaceRecord> {
        self.0.store.list()
    }

    /// Opens a page of the webview, which has just loaded, and gives it what is unsent.
    pub fn open_page(&self) -> Page {
        self.0.store.open_page()
    }

    /// Keeps what the operator has put in a surface and not sent.
    pub fn save_unsent(&self, key: &SurfaceKey, save: UnsentSave) -> Result<(), UnsentRefused> {
        self.0.store.save_unsent(key, save)
    }

    /// The operator's answer, as the result its agent is to get: from its open call, or typed into
    /// its terminal. One to an older revision has the surface drawn again. Blocks while it types.
    pub fn answer(&self, key: &SurfaceKey, revision: u64, answer: Value) -> Result<(), AnswerRefused> {
        let store = &self.0.store;
        let settled = match store.answer(key, revision, answer) {
            Ok(Answered::Returned(settled)) => Some(settled),
            Ok(Answered::ToType(to_type)) => match self.type_in(&key.terminal_id, &to_type) {
                Ok(()) => store.typed(key),
                Err(why) => {
                    store.not_typed(key);
                    return Err(AnswerRefused::NotTyped(why));
                }
            },
            Err(refused) => {
                if let (AnswerRefused::OlderRevision, Some(record)) = (refused, store.record(key)) {
                    self.show(&record);
                }
                return Err(refused);
            }
        };
        if let Some(settled) = settled {
            self.show_changed(&settled);
        }
        Ok(())
    }

    fn type_in(&self, terminal_id: &str, ToType { launch, line }: &ToType) -> Result<(), NotTyped> {
        match self.0.terminals.get() {
            Some(terminals) => terminals.type_in(terminal_id, *launch, line),
            None => {
                tracing::error!("{terminal_id}: an answer came before the surfaces' terminals were set");
                Err(NotTyped::Failed)
            }
        }
    }

    /// The operator's dismissal. The agent that asked is told as it would be of an answer, and one
    /// that asked for nothing is not. Blocks while it types.
    pub fn dismiss(&self, key: &SurfaceKey) -> Result<(), BeingSent> {
        let Some(Dismissed { line }) = self.0.store.dismiss(key)? else {
            return Ok(());
        };
        self.remove(key);
        if let Some(line) = line {
            self.type_in_or_log(&key.terminal_id, &line);
        }
        Ok(())
    }

    /// The operator's dismissal of those of `terminal_id`'s surfaces `ids` that are locked. No agent is
    /// told.
    pub fn dismiss_locked(&self, terminal_id: &str, ids: &[String]) {
        self.remove_all(&self.0.store.dismiss_locked(terminal_id, ids));
    }

    /// The operator's move of a raw companion surface to a stage tab, or back. No agent is told.
    pub fn move_surface(&self, key: &SurfaceKey, as_tab: bool) -> Result<SurfaceRecord, MoveRefused> {
        let moved = self.0.store.move_surface(key, as_tab)?;
        self.show(&moved);
        Ok(moved)
    }

    /// Records what the operator's click fired in a surface.
    pub fn function_fired(&self, key: &SurfaceKey, fired: Fired) {
        self.0.store.fired(key, fired);
    }

    /// `type_in`, for a surface that has no way back: a failure is only logged, and
    /// `quay_surface_read` still tells its agent.
    fn type_in_or_log(&self, terminal_id: &str, line: &ToType) {
        if self.type_in(terminal_id, line) == Err(NotTyped::TerminalOver) {
            tracing::info!("{terminal_id}: the terminal is over, so a surface's answer was not typed in");
        }
    }

    /// Types in, on a thread of its own, what a call dropped unread.
    pub(super) fn type_in_later(&self, terminal_id: &str, launch: u64, line: String) {
        let (tools, terminal_id) = (self.clone(), terminal_id.to_string());
        std::thread::spawn(move || tools.type_in_or_log(&terminal_id, &ToType { launch, line }));
    }
}

/// What an agent does about a call that returned before the operator answered.
const NO_ANSWER_NEXT: &str = "End your turn now. The answer will be typed into this terminal. \
     quay_surface_read with this id returns it too.";

/// The result whose text is `body` as JSON.
fn text_result(body: Value) -> Value {
    verbatim_result(&body.to_string())
}

/// The result whose text is `text` as it is.
fn verbatim_result(text: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": text }] })
}

/// What a message for a dismissed id is told.
fn dismissed_result() -> Value {
    text_result(json!({ "dismissed": true }))
}

/// What `SurfaceTools::list` gives. `pnpm docs:build` checks the A2A page's tool reference against this
/// file too.
const TOOL_LIST: &str = include_str!("surface_tools.json");
