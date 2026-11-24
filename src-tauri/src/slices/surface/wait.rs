//! A call's wait for the operator's answer.

use std::time::Duration;

use serde_json::Value;
use tokio::sync::oneshot;

use super::calls::Handed;
use super::store::OpenedCall;
use super::tools::SurfaceTools;

/// One call's wait, from the call's arrival until it returns or its connection closes, which drops
/// this. Until then, or until something ends the wait, Quay believes the agent listens. It holds no
/// lock.
pub struct Wait {
    tools: SurfaceTools,
    terminal_id: String,
    /// The launch of the terminal that the call came from.
    launch: u64,
    number: u64,
    rx: oneshot::Receiver<Handed>,
}

impl Wait {
    /// Opens a call of `terminal_id`, whose JSON-RPC request has the id `request`, and starts its wait.
    /// `None` when the terminal has exited or closed.
    pub fn start(tools: &SurfaceTools, terminal_id: &str, request: &Value) -> Option<Self> {
        let OpenedCall { launch, number, rx } = tools.store().open_call(terminal_id, request)?;
        Some(Self { tools: tools.clone(), terminal_id: terminal_id.to_string(), launch, number, rx })
    }

    pub fn terminal_id(&self) -> &str {
        &self.terminal_id
    }

    /// The call's number in the store.
    pub fn number(&self) -> u64 {
        self.number
    }

    /// The answer, or `None` when the wait ended without one: after `limit`, or at anything else that
    /// ends it.
    pub async fn answer(mut self, limit: Duration) -> Option<Value> {
        if let Ok(handed) = tokio::time::timeout(limit, &mut self.rx).await {
            return handed.ok().map(Handed::read);
        }
        self.tools.store().end_call(&self.terminal_id, self.number);
        // One that came as the limit passed was sent before the call ended
        self.rx.try_recv().ok().map(Handed::read)
    }
}

/// An answer handed over just before the connection closed, and read by no call, is typed in.
impl Drop for Wait {
    fn drop(&mut self) {
        self.tools.store().forget_call(&self.terminal_id, self.number);
        if let Some(line) = self.rx.try_recv().ok().and_then(Handed::drop_unread) {
            self.tools.type_in_later(&self.terminal_id, self.launch, line.to_string());
        }
    }
}
