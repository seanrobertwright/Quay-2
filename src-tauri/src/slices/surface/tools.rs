//! The surface tools: a call's checks, its commit, its wait and its result.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock, Weak};

use parking_lot::Mutex;
use serde_json::{json, Value};

use super::ask::{self, Ask};
use super::check::{CheckRequest, Checks, Verdict};
use super::names;
use super::read;
use super::rejection::{QuayFailed, Rejection};
use super::store::{
    AnswerRefused, Answered, BeingSent, CommitRefused, Committed, Creation, Dismissed, SurfaceKey, SurfaceRecord,
    SurfaceStore, MOST_KEPT,
};
use super::timing::Timing;
use super::typing::{NotTyped, Terminals};
use super::wait::Wait;

/// The window that checks and draws surfaces.
pub trait Webview: Send + Sync {
    fn check(&self, request: &CheckRequest);
    fn show(&self, record: &SurfaceRecord);
    /// Takes a surface Quay no longer has off the screen.
    fn remove(&self, key: &SurfaceKey);
}

struct Inner {
    /// Whether this build lists and accepts the surface tools.
    offered: bool,
    timing: Timing,
    store: SurfaceStore,
    checks: Checks,
    /// One lock per terminal, held while a call of it is checked and committed and never while one
    /// waits for its answer. It lives as long as a call holds it or is queued for it.
    queues: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
    webview: OnceLock<Box<dyn Webview>>,
    terminals: OnceLock<Box<dyn Terminals>>,
}

#[derive(Clone)]
pub struct SurfaceTools(Arc<Inner>);

impl Default for SurfaceTools {
    fn default() -> Self {
        Self::new()
    }
}

impl SurfaceTools {
    /// Offered where `names::OFFERED` says this build offers them.
    pub fn new() -> Self {
        Self::with(names::OFFERED, Timing::default())
    }

    pub(crate) fn with(offered: bool, timing: Timing) -> Self {
        Self(Arc::new(Inner {
            offered,
            timing,
            store: SurfaceStore::default(),
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

    pub(super) fn store(&self) -> &SurfaceStore {
        &self.0.store
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

    /// The surface tools `tools/list` answers with.
    pub fn list(&self) -> &'static [Value] {
        if self.0.offered { tool_list() } else { &[] }
    }

    /// Runs `terminal_id`'s call of `tool`, whose JSON-RPC request has the id `request`. `None` when
    /// it is not a tool this build offers.
    pub async fn call(&self, terminal_id: &str, request: &Value, tool: &str, arguments: &Value) -> Option<Value> {
        if !self.0.offered {
            return None;
        }
        match tool {
            ask::TOOL => Some(match Ask::parse(arguments) {
                Err(rejection) => self.reject(terminal_id, ask::TOOL, &rejection),
                Ok(ask) => self.show_ask(Wait::start(self, terminal_id, request), arguments, &ask).await,
            }),
            read::TOOL => Some(match read::read(&self.0.store, terminal_id, arguments) {
                Err(rejection) => self.reject(terminal_id, read::TOOL, &rejection),
                Ok(body) => {
                    self.0.store.accepted(terminal_id, read::TOOL);
                    text_result(body)
                }
            }),
            _ => None,
        }
    }

    async fn show_ask(&self, wait: Wait, arguments: &Value, ask: &Ask) -> Value {
        let terminal_id = wait.terminal_id();
        let title = &ask.questions[0].question;
        let creation = Creation { tool: ask::TOOL, arguments, title, call: wait.number() };
        let key = {
            let queue = self.queue(terminal_id);
            let _one_at_a_time = queue.lock().await;
            match self.0.store.rejoin(terminal_id, creation) {
                Some(key) => key,
                None => {
                    let key = self.0.store.name_ask(terminal_id);
                    match self.check_and_commit(&key, creation, json!(ask)).await {
                        Err(failure) => return failure,
                        Ok(Committed { record, left }) => {
                            if let Some(left) = left {
                                self.remove(&left);
                            }
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
        match wait.answer(self.0.timing.wait).await {
            Some(answer) => text_result(answer),
            None => text_result(json!({ "surface_id": key.id, "state": "no_answer_yet", "next": NO_ANSWER_NEXT })),
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

    /// Commits a call once the webview has found nothing wrong with it. Nothing is committed for a
    /// verdict that came too late. The error is the result its agent gets.
    async fn check_and_commit(
        &self,
        key: &SurfaceKey,
        creation: Creation<'_>,
        arguments: Value,
    ) -> Result<Committed, Value> {
        let SurfaceKey { terminal_id, id } = key;
        let tool = creation.tool;
        let send = |request: &CheckRequest| {
            // One sent before the window is named is handed over when it has loaded
            if let Some(webview) = self.0.webview.get() {
                webview.check(request);
            }
        };
        let accepted = match self.0.checks.check(tool, id, arguments, self.0.timing.verdict, send).await {
            None => {
                tracing::error!("{terminal_id}: no verdict on a {tool} call in {:?}", self.0.timing.verdict);
                return Err(QuayFailed::NoVerdict.result());
            }
            Some(Verdict::Failed { errors }) => {
                tracing::error!("{terminal_id}: Quay's expansion of a {tool} call failed the engine: {errors:?}");
                return Err(QuayFailed::Expansion.result());
            }
            Some(Verdict::Accepted(accepted)) => accepted,
        };
        self.0.store.commit(key, creation, accepted).map_err(|refused| match refused {
            CommitRefused::IdInUse => {
                tracing::error!("{terminal_id}: a {tool} call was given the id {id}, which is in use");
                QuayFailed::Expansion.result()
            }
            CommitRefused::Full => {
                let message = format!("This terminal has {MOST_KEPT} questions open, the most allowed. Wait for an answer.");
                self.reject(terminal_id, tool, &Rejection::invalid("", message))
            }
        })
    }

    /// The result of `terminal_id`'s call of `tool` that `rejection` rejects. The window is told nothing.
    fn reject(&self, terminal_id: &str, tool: &str, rejection: &Rejection) -> Value {
        rejection.result(tool, self.0.store.rejected(terminal_id, tool))
    }

    fn show(&self, record: &SurfaceRecord) {
        if let Some(webview) = self.0.webview.get() {
            webview.show(record);
        }
    }

    fn remove(&self, key: &SurfaceKey) {
        if let Some(webview) = self.0.webview.get() {
            webview.remove(key);
        }
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

    /// The operator's answer, as the result its agent is to get: from its open call, or typed into
    /// its terminal. One to an older revision has the surface drawn again. Blocks while it types.
    pub fn answer(&self, key: &SurfaceKey, revision: u64, answer: Value) -> Result<(), AnswerRefused> {
        let store = &self.0.store;
        let (record, taken) = match store.answer(key, revision, answer) {
            Ok(Answered::Returned(record)) => (Some(record), Ok(())),
            Ok(Answered::ToType(line)) => match self.type_in(&key.terminal_id, &line) {
                Ok(()) => (store.typed(key), Ok(())),
                Err(why) => {
                    store.not_typed(key);
                    (None, Err(AnswerRefused::NotTyped(why)))
                }
            },
            Err(AnswerRefused::OlderRevision) => (store.record(key), Err(AnswerRefused::OlderRevision)),
            Err(refused) => (None, Err(refused)),
        };
        if let Some(record) = record {
            self.show(&record);
        }
        taken
    }

    fn type_in(&self, terminal_id: &str, line: &str) -> Result<(), NotTyped> {
        match self.0.terminals.get() {
            Some(terminals) => terminals.type_in(terminal_id, line),
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

    /// `type_in`, for a surface that has no way back: a failure is only logged, and
    /// `quay_surface_read` still tells its agent.
    fn type_in_or_log(&self, terminal_id: &str, line: &str) {
        if self.type_in(terminal_id, line) == Err(NotTyped::TerminalOver) {
            tracing::info!("{terminal_id}: the terminal is over, so a surface's answer was not typed in");
        }
    }

    /// Types in, on a thread of its own, what a call dropped unread.
    pub(super) fn type_in_later(&self, terminal_id: &str, line: String) {
        let (tools, terminal_id) = (self.clone(), terminal_id.to_string());
        std::thread::spawn(move || tools.type_in_or_log(&terminal_id, &line));
    }
}

/// What an agent does about a call that returned before the operator answered.
const NO_ANSWER_NEXT: &str = "End your turn now. The answer will be typed into this terminal. \
     quay_surface_read with this id returns it too.";

fn text_result(body: Value) -> Value {
    json!({ "content": [{ "type": "text", "text": body.to_string() }] })
}

/// The surface tools, listed after those of `mcp_tools.json`.
const TOOL_LIST: &str = include_str!("surface_tools.json");

/// `TOOL_LIST`, parsed once.
fn tool_list() -> &'static [Value] {
    static TOOLS: OnceLock<Vec<Value>> = OnceLock::new();
    TOOLS.get_or_init(|| serde_json::from_str(TOOL_LIST).expect("surface_tools.json is a JSON list"))
}
