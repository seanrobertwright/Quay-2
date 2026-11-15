use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;
use tokio::sync::{oneshot, Notify};
use uuid::Uuid;

use super::models::{Command, Envelope, PermissionRequestPayload, PermissionResponsePayload};

pub struct PendingPermissionItem {
    pub payload: PermissionRequestPayload,
    pub tx: oneshot::Sender<PermissionResponsePayload>,
}

#[derive(Clone)]
pub struct BridgeState {
    port: Arc<AtomicU16>,
    tokens: Arc<Mutex<HashMap<String, String>>>,
    command_queues: Arc<Mutex<HashMap<String, Vec<Command>>>>,
    notifiers: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
    events_history: Arc<Mutex<Vec<Envelope>>>,
    pending_permissions: Arc<Mutex<HashMap<String, PendingPermissionItem>>>,
    session_allowed_tools: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    /// The input of each tool call that started and hasn't finished, keyed by terminal and
    /// `toolUseId`, oldest first, so its `tool.finished` can carry the command with the result.
    open_tool_calls: Arc<Mutex<VecDeque<(String, String, serde_json::Value)>>>,
}

/// Most started tool calls kept waiting for their `tool.finished`. A call whose finish never
/// comes (the session died) is dropped once this many newer ones started.
pub const MAX_OPEN_TOOL_CALLS: usize = 256;

impl BridgeState {
    pub fn new() -> Self {
        Self {
            port: Arc::new(AtomicU16::new(0)),
            tokens: Arc::new(Mutex::new(HashMap::new())),
            command_queues: Arc::new(Mutex::new(HashMap::new())),
            notifiers: Arc::new(Mutex::new(HashMap::new())),
            events_history: Arc::new(Mutex::new(Vec::new())),
            pending_permissions: Arc::new(Mutex::new(HashMap::new())),
            session_allowed_tools: Arc::new(Mutex::new(HashMap::new())),
            open_tool_calls: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub fn set_port(&self, port: u16) {
        self.port.store(port, Ordering::SeqCst);
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::SeqCst)
    }

    pub fn token_for(&self, terminal_id: &str) -> String {
        let mut tokens = self.tokens.lock();
        if let Some(token) = tokens.get(terminal_id) {
            token.clone()
        } else {
            let new_token = format!("{}-{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
            tokens.insert(terminal_id.to_string(), new_token.clone());
            new_token
        }
    }

    pub fn verify_token(&self, terminal_id: &str, candidate_token: &str) -> bool {
        let tokens = self.tokens.lock();
        if let Some(expected) = tokens.get(terminal_id) {
            // Constant-time byte comparison
            if expected.len() != candidate_token.len() {
                return false;
            }
            let mut diff = 0u8;
            for (a, b) in expected.as_bytes().iter().zip(candidate_token.as_bytes().iter()) {
                diff |= a ^ b;
            }
            diff == 0
        } else {
            false
        }
    }

    pub fn enqueue_command(&self, terminal_id: &str, cmd: Command) {
        {
            let mut queues = self.command_queues.lock();
            queues
                .entry(terminal_id.to_string())
                .or_default()
                .push(cmd);
        }

        let notifier = {
            let mut notifiers = self.notifiers.lock();
            notifiers
                .entry(terminal_id.to_string())
                .or_insert_with(|| Arc::new(Notify::new()))
                .clone()
        };

        notifier.notify_waiters();
    }

    pub fn drain_commands(&self, terminal_id: &str) -> Vec<Command> {
        let mut queues = self.command_queues.lock();
        queues.remove(terminal_id).unwrap_or_default()
    }

    pub fn get_notifier(&self, terminal_id: &str) -> Arc<Notify> {
        let mut notifiers = self.notifiers.lock();
        notifiers
            .entry(terminal_id.to_string())
            .or_insert_with(|| Arc::new(Notify::new()))
            .clone()
    }

    /// Keeps each tool call's command with its result. The event-bridge plugin sends a call's
    /// arguments (`input`) on `tool.started` and its result (`text`) on `tool.finished`; this
    /// remembers the first and adds it to the second, matched by terminal and `toolUseId`, so a
    /// finished call says both what ran and what it printed. Other events pass unchanged.
    pub fn pair_tool_call(&self, envelope: &mut Envelope) {
        let (Some(tag), Some(id)) = (
            envelope.tag.clone(),
            envelope.data.get("toolUseId").and_then(|v| v.as_str()).map(str::to_string),
        ) else {
            return;
        };
        let mut open = self.open_tool_calls.lock();
        match envelope.event_type.as_str() {
            "tool.started" => {
                if let Some(input) = envelope.data.get("input") {
                    if open.len() >= MAX_OPEN_TOOL_CALLS {
                        open.pop_front();
                    }
                    open.push_back((tag, id, input.clone()));
                }
            }
            "tool.finished" => {
                let Some(at) = open.iter().position(|(t, i, _)| *t == tag && *i == id) else {
                    return;
                };
                let (_, _, input) = open.remove(at).expect("position is in range");
                if let Some(data) = envelope.data.as_object_mut() {
                    data.entry("input").or_insert(input);
                }
            }
            _ => {}
        }
    }

    pub fn record_envelope(&self, envelope: Envelope) {
        let mut history = self.events_history.lock();
        if history.len() >= 2000 {
            history.drain(0..500); // Retain latest
        }
        history.push(envelope);
    }

    pub fn get_history(&self, terminal_id: Option<&str>) -> Vec<Envelope> {
        let history = self.events_history.lock();
        if let Some(tag) = terminal_id {
            history
                .iter()
                .filter(|e| e.tag.as_deref() == Some(tag))
                .cloned()
                .collect()
        } else {
            history.clone()
        }
    }

    /// Adds a pending permission request. An error, and the list unchanged, when a request
    /// with the same id is already pending.
    pub fn register_pending_permission(
        &self,
        request_id: String,
        payload: PermissionRequestPayload,
        tx: oneshot::Sender<PermissionResponsePayload>,
    ) -> Result<(), String> {
        let mut pending = self.pending_permissions.lock();
        match pending.entry(request_id) {
            Entry::Occupied(entry) => Err(format!(
                "Permission request {} is already pending",
                entry.key()
            )),
            Entry::Vacant(entry) => {
                entry.insert(PendingPermissionItem { payload, tx });
                Ok(())
            }
        }
    }

    /// Sends the user's answer to pending request `request_id` and takes it off the pending
    /// list. An error, whose message the frontend shows the user, when no agent is waiting
    /// for that answer any more: the request is not pending, or its agent stopped waiting.
    /// The tool is remembered for the session only when an allow reached the agent.
    pub fn resolve_permission(
        &self,
        request_id: &str,
        decision: &str,
        reason: Option<String>,
        remember_for_session: bool,
    ) -> Result<(), String> {
        let not_delivered = || {
            format!(
                "The agent is no longer waiting for permission request {}, so the answer was not delivered",
                request_id
            )
        };
        let mut pending = self.pending_permissions.lock();
        let item = pending.remove(request_id).ok_or_else(not_delivered)?;
        item.tx
            .send(PermissionResponsePayload {
                decision: decision.to_string(),
                reason,
            })
            .map_err(|_| not_delivered())?;
        if remember_for_session && decision == "allow" {
            if let Some(tag) = &item.payload.tag {
                let mut allowed = self.session_allowed_tools.lock();
                allowed
                    .entry(tag.clone())
                    .or_default()
                    .insert(item.payload.tool.clone());
            }
        }
        Ok(())
    }

    pub fn remove_pending_permission(&self, request_id: &str) -> Option<PendingPermissionItem> {
        let mut pending = self.pending_permissions.lock();
        pending.remove(request_id)
    }

    pub fn is_tool_allowed_for_session(&self, terminal_id: &str, tool: &str) -> bool {
        let allowed = self.session_allowed_tools.lock();
        allowed
            .get(terminal_id)
            .map(|tools| tools.contains(tool))
            .unwrap_or(false)
    }

    pub fn list_pending_permissions(&self) -> Vec<PermissionRequestPayload> {
        let pending = self.pending_permissions.lock();
        pending.values().map(|item| item.payload.clone()).collect()
    }

    pub fn cancel_pending_permissions_for_terminal(&self, terminal_id: &str) {
        let mut pending = self.pending_permissions.lock();
        let to_cancel: Vec<String> = pending
            .iter()
            .filter(|(_, item)| item.payload.tag.as_deref() == Some(terminal_id))
            .map(|(k, _)| k.clone())
            .collect();

        for req_id in to_cancel {
            if let Some(item) = pending.remove(&req_id) {
                let _ = item.tx.send(PermissionResponsePayload {
                    decision: "deny".to_string(),
                    reason: Some("Terminal session was closed".to_string()),
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_event(event_type: &str, tag: &str, data: serde_json::Value) -> Envelope {
        Envelope {
            v: 1,
            boot: "b".to_string(),
            seq: 1,
            ts: 1,
            session_id: "s".to_string(),
            tag: Some(tag.to_string()),
            event_type: event_type.to_string(),
            data,
        }
    }

    #[test]
    fn a_finished_tool_call_keeps_the_command_it_started_with_and_its_result() {
        let state = BridgeState::new();
        let input = serde_json::json!({ "command": "gh pr create --fill" });
        let mut started = tool_event("tool.started", "term-a", serde_json::json!({ "tool": "Bash", "toolUseId": "t1", "input": input }));
        state.pair_tool_call(&mut started);
        let mut finished = tool_event(
            "tool.finished",
            "term-a",
            serde_json::json!({ "tool": "Bash", "toolUseId": "t1", "status": "ok", "text": "https://github.com/o/r/pull/9" }),
        );
        state.pair_tool_call(&mut finished);
        assert_eq!(finished.data["input"], input);
        assert_eq!(finished.data["text"], "https://github.com/o/r/pull/9");
    }

    #[test]
    fn a_tool_call_is_paired_only_within_its_own_terminal_and_only_once() {
        let state = BridgeState::new();
        let mut started = tool_event("tool.started", "term-a", serde_json::json!({ "toolUseId": "t1", "input": { "command": "ls" } }));
        state.pair_tool_call(&mut started);
        let mut other = tool_event("tool.finished", "term-b", serde_json::json!({ "toolUseId": "t1", "text": "x" }));
        state.pair_tool_call(&mut other);
        assert!(other.data.get("input").is_none());
        let mut first = tool_event("tool.finished", "term-a", serde_json::json!({ "toolUseId": "t1", "text": "x" }));
        state.pair_tool_call(&mut first);
        assert!(first.data.get("input").is_some());
        let mut again = tool_event("tool.finished", "term-a", serde_json::json!({ "toolUseId": "t1", "text": "x" }));
        state.pair_tool_call(&mut again);
        assert!(again.data.get("input").is_none());
    }

    #[test]
    fn tool_calls_that_never_finish_are_forgotten_past_the_cap() {
        let state = BridgeState::new();
        for n in 0..=MAX_OPEN_TOOL_CALLS {
            let mut started = tool_event("tool.started", "term-a", serde_json::json!({ "toolUseId": format!("t{n}"), "input": n }));
            state.pair_tool_call(&mut started);
        }
        let mut oldest = tool_event("tool.finished", "term-a", serde_json::json!({ "toolUseId": "t0" }));
        state.pair_tool_call(&mut oldest);
        assert!(oldest.data.get("input").is_none());
        let mut newest = tool_event("tool.finished", "term-a", serde_json::json!({ "toolUseId": format!("t{MAX_OPEN_TOOL_CALLS}") }));
        state.pair_tool_call(&mut newest);
        assert_eq!(newest.data["input"], MAX_OPEN_TOOL_CALLS);
    }

    #[tokio::test]
    async fn test_bridge_state_permission_lifecycle() {
        let state = BridgeState::new();
        let (tx, rx) = oneshot::channel();
        let payload = PermissionRequestPayload {
            request_id: "req-123".to_string(),
            session_id: "sess-1".to_string(),
            tag: Some("term-1".to_string()),
            tool: "Bash".to_string(),
            input: serde_json::json!({ "command": "rm -rf target" }),
            reason: Some("Clean target".to_string()),
        };

        state.register_pending_permission("req-123".to_string(), payload, tx).unwrap();

        let pending = state.list_pending_permissions();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].request_id, "req-123");

        // Resolve with allow and remember for session
        let res = state.resolve_permission("req-123", "allow", None, true);
        assert!(res.is_ok());

        let resp = rx.await.unwrap();
        assert_eq!(resp.decision, "allow");

        // Tool should now be remembered for session
        assert!(state.is_tool_allowed_for_session("term-1", "Bash"));
        assert!(!state.is_tool_allowed_for_session("term-1", "Edit"));
    }

    fn request(request_id: &str) -> PermissionRequestPayload {
        PermissionRequestPayload {
            request_id: request_id.to_string(),
            session_id: "sess-1".to_string(),
            tag: Some("term-1".to_string()),
            tool: "Bash".to_string(),
            input: serde_json::json!({ "command": "ls" }),
            reason: None,
        }
    }

    #[test]
    fn answering_a_request_nobody_waits_for_any_more_is_an_error_and_clears_it() {
        let state = BridgeState::new();
        let (tx, rx) = oneshot::channel();
        state.register_pending_permission("req-gone".to_string(), request("req-gone"), tx).unwrap();
        drop(rx);

        let res = state.resolve_permission("req-gone", "allow", None, true);

        assert!(res.is_err(), "{res:?}");
        assert!(state.list_pending_permissions().is_empty());
        assert!(!state.is_tool_allowed_for_session("term-1", "Bash"));
    }

    #[test]
    fn answering_an_unknown_request_is_an_error() {
        let state = BridgeState::new();

        assert!(state.resolve_permission("req-none", "deny", None, false).is_err());
    }

    #[tokio::test]
    async fn a_second_request_with_a_pending_requests_id_is_refused_and_leaves_the_first_waiting() {
        let state = BridgeState::new();
        let (tx_first, rx_first) = oneshot::channel();
        let (tx_second, _rx_second) = oneshot::channel();
        state
            .register_pending_permission("req-1".to_string(), request("req-1"), tx_first)
            .unwrap();

        let second = state.register_pending_permission("req-1".to_string(), request("req-1"), tx_second);

        assert!(second.is_err());
        state.resolve_permission("req-1", "allow", None, false).unwrap();
        assert_eq!(rx_first.await.unwrap().decision, "allow");
    }
}
