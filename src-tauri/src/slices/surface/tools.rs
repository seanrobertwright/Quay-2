//! The surface tools: a call's checks, its commit, its wait and its result.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock, Weak};

use parking_lot::Mutex;
use serde_json::{json, Value};

use super::ask::{self, Ask};
use super::check::{CheckRequest, Checks, Verdict};
use super::rejection::{QuayFailed, Rejection};
use super::store::{
    AnswerRefused, Answered, CommitRefused, Committed, Creation, SurfaceKey, SurfaceRecord, SurfaceStore, MOST_KEPT,
};
use super::timing::Timing;
use super::typing::{NotTyped, Typist};
use super::wait::OpenCall;
use crate::slices::orchestrator::A2ARouter;
use crate::slices::pty::manager::{PtyManager, TurnEvent};
use crate::slices::pty::models::RunKind;

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
    typist: OnceLock<Typist>,
}

#[derive(Clone)]
pub struct SurfaceTools(Arc<Inner>);

impl Default for SurfaceTools {
    fn default() -> Self {
        Self::new()
    }
}

impl SurfaceTools {
    /// Offered in debug builds only, until surfaces are turned on for release builds.
    pub fn new() -> Self {
        Self::with(cfg!(debug_assertions), Timing::default())
    }

    pub(crate) fn with(offered: bool, timing: Timing) -> Self {
        Self(Arc::new(Inner {
            offered,
            timing,
            store: SurfaceStore::default(),
            checks: Checks::default(),
            queues: Mutex::default(),
            webview: OnceLock::new(),
            typist: OnceLock::new(),
        }))
    }

    /// Names the window that checks and draws, once.
    pub fn set_webview(&self, webview: impl Webview + 'static) {
        if self.0.webview.set(Box::new(webview)).is_err() {
            tracing::error!("The surfaces' webview was set twice; the first stays");
        }
    }

    /// Names the terminals an answer is typed into when no call is open to return it, once, and
    /// follows the turns they print.
    pub fn set_terminals(&self, pty_manager: &PtyManager, a2a_router: &A2ARouter) {
        if self.0.typist.set(Typist::new(pty_manager, a2a_router)).is_err() {
            tracing::error!("The surfaces' terminals were set twice; the first stay");
            return;
        }
        let store = self.0.store.clone();
        pty_manager.add_turn_watcher(move |terminal_id, event| {
            if event == TurnEvent::Ended {
                store.end_calls(terminal_id);
            }
        });
    }

    pub(super) fn store(&self) -> &SurfaceStore {
        &self.0.store
    }

    /// Ends the waits of `terminal_id`'s calls, when its own turn has ended: nothing in it listens
    /// any more.
    pub fn turn_ended(&self, terminal_id: &str) {
        self.0.store.end_calls(terminal_id);
    }

    /// Ends the wait of `terminal_id`'s open call with the request id `request`, which its CLI says
    /// it has given up. One that names no open call changes nothing: OpenCode cancels each call after
    /// it has returned, and counts its requests from the start again at each launch.
    pub fn call_cancelled(&self, terminal_id: &str, request: &Value) {
        self.0.store.cancel_calls(terminal_id, request);
    }

    /// Hears `data`, which the operator typed into `terminal_id`. A lone Escape in a Codex terminal
    /// ends its calls' waits: it interrupts Codex, which reports neither that nor the turn's end.
    pub fn operator_typed(&self, terminal_id: &str, data: &str) {
        let is_codex = || self.0.typist.get().and_then(|typist| typist.run_kind(terminal_id)) == Some(RunKind::Codex);
        if data == "\u{1b}" && is_codex() {
            self.0.store.end_calls(terminal_id);
        }
    }

    /// The surface tools `tools/list` answers with.
    pub fn list(&self) -> &'static [Value] {
        if self.0.offered { tool_list() } else { &[] }
    }

    /// Runs `terminal_id`'s call of `tool`, whose JSON-RPC request has the id `request`. `None` when
    /// it is not a tool this build offers.
    pub async fn call(&self, terminal_id: &str, request: &Value, tool: &str, arguments: &Value) -> Option<Value> {
        if !self.0.offered || tool != ask::TOOL {
            return None;
        }
        Some(match Ask::parse(arguments) {
            Err(rejection) => rejection.typed_result(),
            Ok(ask) => self.show_ask(OpenCall::open(self, terminal_id, request), terminal_id, arguments, &ask).await,
        })
    }

    async fn show_ask(&self, call: OpenCall, terminal_id: &str, arguments: &Value, ask: &Ask) -> Value {
        let title = &ask.questions[0].question;
        let creation = Creation { tool: ask::TOOL, arguments, title, call: call.number() };
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
        match call.answer(self.0.timing.wait).await {
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
                Rejection::invalid("", message).typed_result()
            }
        })
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
    /// its terminal. Blocks while it types.
    pub fn answer(&self, key: &SurfaceKey, revision: u64, answer: Value) -> Result<(), AnswerRefused> {
        let record = match self.0.store.answer(key, revision, answer)? {
            Answered::Returned(record) => Some(record),
            Answered::ToType(line) => match self.type_in(&key.terminal_id, &line) {
                Ok(()) => self.0.store.typed(key),
                Err(why) => {
                    self.0.store.not_typed(key);
                    return Err(AnswerRefused::NotTyped(why));
                }
            },
        };
        if let Some(record) = record {
            self.show(&record);
        }
        Ok(())
    }

    fn type_in(&self, terminal_id: &str, line: &str) -> Result<(), NotTyped> {
        match self.0.typist.get() {
            Some(typist) => typist.type_in(terminal_id, line),
            None => {
                tracing::error!("{terminal_id}: an answer came before the surfaces' terminals were set");
                Err(NotTyped::Failed)
            }
        }
    }

    /// `type_in`, for an answer that settled its surface and then reached no call. A failure can be
    /// told to nobody but the log; `quay_surface_read` still has the answer.
    pub(super) fn type_in_later(&self, terminal_id: &str, line: String) {
        let (tools, terminal_id) = (self.clone(), terminal_id.to_string());
        std::thread::spawn(move || {
            if tools.type_in(&terminal_id, &line) == Err(NotTyped::TerminalOver) {
                tracing::warn!("{terminal_id}: its terminal is over, so a surface's answer was not typed in");
            }
        });
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
