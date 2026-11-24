//! The surface tools: a call's checks, its commit, its wait and its result.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock, Weak};

use parking_lot::Mutex;
use serde_json::{json, Value};

use super::ask::{self, Ask};
use super::check::{CheckRequest, Checks, Verdict};
use super::rejection::{QuayFailed, Rejection};
use super::store::{AnswerRefused, CommitRefused, Committed, SurfaceKey, SurfaceRecord, SurfaceStore, MOST_KEPT};
use super::timing::Timing;

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

    pub(super) fn with(offered: bool, timing: Timing) -> Self {
        Self(Arc::new(Inner {
            offered,
            timing,
            store: SurfaceStore::default(),
            checks: Checks::default(),
            queues: Mutex::default(),
            webview: OnceLock::new(),
        }))
    }

    /// Names the window that checks and draws, once.
    pub fn set_webview(&self, webview: impl Webview + 'static) {
        if self.0.webview.set(Box::new(webview)).is_err() {
            tracing::error!("The surfaces' webview was set twice; the first stays");
        }
    }

    /// The surface tools `tools/list` answers with.
    pub fn list(&self) -> &'static [Value] {
        if self.0.offered { tool_list() } else { &[] }
    }

    /// Runs `terminal_id`'s call of `tool`. `None` when it is not a tool this build offers.
    pub async fn call(&self, terminal_id: &str, tool: &str, arguments: &Value) -> Option<Value> {
        if !self.0.offered || tool != ask::TOOL {
            return None;
        }
        Some(match Ask::parse(arguments) {
            Err(rejection) => rejection.typed_result(),
            Ok(ask) => self.show_ask(terminal_id, &ask).await,
        })
    }

    async fn show_ask(&self, terminal_id: &str, ask: &Ask) -> Value {
        let (key, wait) = {
            let queue = self.queue(terminal_id);
            let _one_at_a_time = queue.lock().await;
            let key = self.0.store.name_ask(terminal_id);
            match self.check_and_commit(&key, ask::TOOL, json!(ask)).await {
                Ok(Committed { record, wait, left }) => {
                    if let Some(left) = left {
                        self.remove(&left);
                    }
                    self.show(&record);
                    (key, wait)
                }
                Err(failure) => return failure,
            }
        };
        let Some(wait) = wait else {
            return text_result(json!({ "shown": true }));
        };
        match wait.answer(self.0.timing.wait).await {
            Some(answer) => text_result(answer),
            None => text_result(json!({ "surface_id": key.id, "state": "no_answer_yet", "next": "End your turn now." })),
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
        tool: &str,
        arguments: Value,
    ) -> Result<Committed, Value> {
        let SurfaceKey { terminal_id, id } = key;
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
        self.0.store.commit(key, tool, accepted).map_err(|refused| match refused {
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

    /// The operator's answer, as the result its agent is to get.
    pub fn answer(&self, key: &SurfaceKey, revision: u64, answer: Value) -> Result<(), AnswerRefused> {
        let record = self.0.store.answer(key, revision, answer)?;
        self.show(&record);
        Ok(())
    }
}

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
