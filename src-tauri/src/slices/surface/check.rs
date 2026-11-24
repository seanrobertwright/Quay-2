//! The check request the webview answers, and its verdict.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;

/// A call for the webview to check on a scratch copy of the engine. It applies nothing.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CheckRequest {
    /// Names the call, so a verdict reaches only the check it is for.
    pub call: u64,
    pub tool: String,
    /// The id the surface has if it is accepted.
    pub surface_id: String,
    /// The call's arguments, as Rust checked them.
    pub arguments: Value,
}

/// What the webview made of a check.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum Verdict {
    Failed { errors: Vec<EngineError> },
    Accepted(Accepted),
}

/// An engine error, as its `mapErrorToRendererMessage` gives it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct EngineError {
    pub code: String,
    #[serde(default)]
    pub path: Option<String>,
    pub message: String,
}

/// A surface the engine accepted.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Accepted {
    /// The accepted state as one compact `createSurface`.
    pub state: Value,
    /// Whether the surface has an action to its agent.
    pub asks: bool,
    pub components: u32,
    pub images: u32,
}

struct Pending {
    request: CheckRequest,
    verdict: oneshot::Sender<Verdict>,
}

#[derive(Default)]
struct Inner {
    last_call: u64,
    pending: BTreeMap<u64, Pending>,
}

/// Every check that has no verdict yet.
#[derive(Clone, Default)]
pub struct Checks(Arc<Mutex<Inner>>);

impl Checks {
    /// Registers a check, sends it with `send`, and waits up to `limit` for its verdict. `None` when
    /// none came in time; one that comes later is dropped.
    pub async fn check(
        &self,
        tool: &str,
        surface_id: &str,
        arguments: Value,
        limit: Duration,
        send: impl FnOnce(&CheckRequest),
    ) -> Option<Verdict> {
        let (tx, rx) = oneshot::channel();
        let request = {
            let mut inner = self.0.lock();
            inner.last_call += 1;
            let request = CheckRequest {
                call: inner.last_call,
                tool: tool.to_string(),
                surface_id: surface_id.to_string(),
                arguments,
            };
            inner.pending.insert(request.call, Pending { request: request.clone(), verdict: tx });
            request
        };
        // Also when the call is dropped with its connection: its verdict then reaches nothing
        let _forget = Forget { checks: self, call: request.call };
        send(&request);
        tokio::time::timeout(limit, rx).await.ok()?.ok()
    }

    /// Hands the check `call` its verdict. One for a check that has a verdict already, or is over,
    /// is dropped.
    pub fn verdict(&self, call: u64, verdict: Verdict) {
        let pending = self.0.lock().pending.remove(&call);
        if let Some(pending) = pending {
            // A check whose limit passed in between no longer listens
            let _ = pending.verdict.send(verdict);
        }
    }

    /// The checks without a verdict, oldest first. A check is an event, and one sent while the
    /// webview was loading reached nobody, so a webview that has loaded asks for these.
    pub fn unanswered(&self) -> Vec<CheckRequest> {
        self.0.lock().pending.values().map(|pending| pending.request.clone()).collect()
    }
}

struct Forget<'a> {
    checks: &'a Checks,
    call: u64,
}

impl Drop for Forget<'_> {
    fn drop(&mut self) {
        self.checks.0.lock().pending.remove(&self.call);
    }
}
