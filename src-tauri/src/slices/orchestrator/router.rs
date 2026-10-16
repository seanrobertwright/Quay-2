use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use parking_lot::Mutex;
use tokio::sync::oneshot;
use uuid::Uuid;

use super::models::{A2ADispatchRequest, A2AMessage, A2AMessageStatus};
use crate::slices::bridge::models::Command;
use crate::slices::bridge::state::BridgeState;
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::ClaudeStatus;

fn resolve_terminal_id(identifier: &str, pty_manager: &PtyManager) -> String {
    let trimmed = identifier.trim();
    if trimmed.is_empty() {
        return identifier.to_string();
    }

    // 1. Direct match on terminal id
    if pty_manager.get_info(trimmed).is_some() {
        return trimmed.to_string();
    }

    let terminals = pty_manager.list();

    // 2. Exact match on terminal name (case-insensitive)
    let lower = trimmed.to_lowercase();
    if let Some(t) = terminals.iter().find(|t| t.name.to_lowercase() == lower) {
        return t.id.clone();
    }

    // 3. Match on run_kind (case-insensitive)
    if let Some(t) = terminals.iter().find(|t| t.run_kind.as_str().to_lowercase() == lower) {
        return t.id.clone();
    }

    // 4. Substring match on terminal name or prefix of id
    if let Some(t) = terminals.iter().find(|t| {
        t.name.to_lowercase().contains(&lower)
            || t.id.to_lowercase().starts_with(&lower)
    }) {
        return t.id.clone();
    }

    trimmed.to_string()
}

fn resolve_terminal_name(identifier: &str, pty_manager: Option<&PtyManager>) -> String {
    let trimmed = identifier.trim();
    if let Some(pty) = pty_manager {
        if let Some(info) = pty.get_info(trimmed) {
            return info.name;
        }
        let list = pty.list();
        if let Some(t) = list.iter().find(|t| t.id == trimmed || t.name.eq_ignore_ascii_case(trimmed)) {
            return t.name.clone();
        }
    }
    trimmed.to_string()
}

#[derive(Clone)]
pub struct A2ARouter {
    messages: Arc<Mutex<Vec<A2AMessage>>>,
    pending_replies: Arc<Mutex<HashMap<String, Vec<oneshot::Sender<String>>>>>,
}

impl A2ARouter {
    pub fn new() -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
            pending_replies: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn dispatch(
        &self,
        request: A2ADispatchRequest,
        bridge_state: &BridgeState,
        pty_manager: Option<&PtyManager>,
    ) -> Result<A2AMessage, String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let msg_id = format!("a2a-{}", Uuid::new_v4().simple());

        let target_terminal_id = if let Some(pty) = pty_manager {
            resolve_terminal_id(&request.to_terminal, pty)
        } else {
            request.to_terminal.clone()
        };

        let from_name = resolve_terminal_name(&request.from_terminal, pty_manager);
        let to_name = resolve_terminal_name(&target_terminal_id, pty_manager);

        let formatted_prompt = if request.as_user.unwrap_or(false) {
            request.prompt.clone()
        } else {
            format!(
                "[Message from peer agent in {}]:\n{}",
                from_name, request.prompt
            )
        };

        // 1. Enqueue in BridgeState for claude-mod-events bridge queue
        let cmd = Command {
            id: format!("cmd-{}", Uuid::new_v4().simple()),
            command_type: "prompt".to_string(),
            text: Some(formatted_prompt),
            as_user: request.as_user,
        };

        bridge_state.enqueue_command(&target_terminal_id, cmd);

        // 2. Inject directly into target terminal's ConPTY stdin so the agent executes immediately!
        if let Some(pty) = pty_manager {
            let pty_prompt = if request.as_user.unwrap_or(false) {
                request.prompt.trim().replace("\r\n", " ").replace('\n', " ")
            } else {
                let clean_content = request.prompt.trim().replace("\r\n", " ").replace('\n', " ");
                format!("[Peer agent ({})]: {}", from_name, clean_content)
            };

            let data_to_write = format!("{}\r\n", pty_prompt);
            if let Err(e) = pty.write(&target_terminal_id, &data_to_write) {
                tracing::warn!("Failed writing A2A prompt to PTY {}: {}", target_terminal_id, e);
            } else {
                // Update receiver agent status to Working
                pty.update_status(&target_terminal_id, ClaudeStatus::Working);
                tracing::info!("A2A prompt injected into PTY {} from {}", target_terminal_id, from_name);
            }
        }

        let message = A2AMessage {
            id: msg_id,
            from_terminal: request.from_terminal,
            to_terminal: target_terminal_id,
            from_name: Some(from_name),
            to_name: Some(to_name),
            content: request.prompt,
            as_user: request.as_user.unwrap_or(false),
            timestamp: now,
            status: A2AMessageStatus::Dispatched,
            response: None,
        };

        self.messages.lock().push(message.clone());
        Ok(message)
    }

    pub async fn dispatch_and_wait(
        &self,
        request: A2ADispatchRequest,
        bridge_state: &BridgeState,
        pty_manager: Option<&PtyManager>,
        timeout_secs: u64,
    ) -> Result<String, String> {
        let (tx, rx) = oneshot::channel();

        let resolved_target = if let Some(pty) = pty_manager {
            resolve_terminal_id(&request.to_terminal, pty)
        } else {
            request.to_terminal.clone()
        };

        // Register pending reply listener for the target terminal
        {
            let mut pending = self.pending_replies.lock();
            pending
                .entry(resolved_target.clone())
                .or_default()
                .push(tx);
        }

        // Dispatch prompt to target agent
        let _ = self.dispatch(request.clone(), bridge_state, pty_manager)?;

        // Await target agent's turn completion with timeout
        match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
            Ok(Ok(response)) => {
                // Update message in history with the response
                let mut history = self.messages.lock();
                if let Some(msg) = history.iter_mut().rev().find(|m| {
                    m.from_terminal == request.from_terminal
                        && (m.to_terminal == request.to_terminal || m.to_terminal == resolved_target)
                }) {
                    msg.status = A2AMessageStatus::Completed;
                    msg.response = Some(response.clone());
                }
                Ok(response)
            }
            Ok(Err(_)) => Err("Peer agent channel closed before replying".to_string()),
            Err(_) => {
                // Timeout
                let mut history = self.messages.lock();
                if let Some(msg) = history.iter_mut().rev().find(|m| {
                    m.from_terminal == request.from_terminal
                        && (m.to_terminal == request.to_terminal || m.to_terminal == resolved_target)
                }) {
                    msg.status = A2AMessageStatus::Failed;
                    msg.response = Some("Timed out waiting for reply".to_string());
                }
                Ok(format!(
                    "Peer agent ({}) received the task but is still working. You can check their status later using quay_get_agent_status.",
                    resolved_target
                ))
            }
        }
    }

    pub fn resolve_pending_reply(&self, terminal_id: &str, answer: String) -> Option<A2AMessage> {
        let updated_msg = {
            let mut history = self.messages.lock();
            if let Some(msg) = history
                .iter_mut()
                .rev()
                .find(|m| m.to_terminal == terminal_id && m.status == A2AMessageStatus::Dispatched)
            {
                msg.status = A2AMessageStatus::Completed;
                msg.response = Some(answer.clone());
                Some(msg.clone())
            } else {
                None
            }
        };

        let senders = {
            let mut pending = self.pending_replies.lock();
            pending.remove(terminal_id).unwrap_or_default()
        };

        for tx in senders {
            let _ = tx.send(answer.clone());
        }

        updated_msg
    }

    pub fn broadcast_toast(
        &self,
        text: &str,
        bridge_state: &BridgeState,
        pty_manager: &PtyManager,
    ) -> Vec<A2AMessage> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let clean_text = text.trim().replace("\r\n", " ").replace('\n', " ");
        let terminals = pty_manager.list();
        let mut created_messages = Vec::new();

        for t in terminals {
            if t.run_kind.is_agent() && t.claude_status != ClaudeStatus::Exited {
                // 1. Enqueue in BridgeState for mock / polling bridge consumers
                let cmd = Command {
                    id: format!("toast-{}", Uuid::new_v4().simple()),
                    command_type: "toast".to_string(),
                    text: Some(text.to_string()),
                    as_user: None,
                };
                bridge_state.enqueue_command(&t.id, cmd);

                // 2. Inject directly into ConPTY stdin so the agent receives the broadcast notice immediately!
                let pty_prompt = format!("[Broadcast Notice]: {}", clean_text);
                let data_to_write = format!("{}\r\n", pty_prompt);
                if let Err(e) = pty_manager.write(&t.id, &data_to_write) {
                    tracing::warn!("Failed writing broadcast to PTY {}: {}", t.id, e);
                } else {
                    pty_manager.update_status(&t.id, ClaudeStatus::Working);
                    tracing::info!("Broadcast notice injected into PTY {}", t.id);
                }

                // 3. Create A2AMessage for message history and UI updates
                let msg = A2AMessage {
                    id: format!("broadcast-{}", Uuid::new_v4().simple()),
                    from_terminal: "broadcast".to_string(),
                    to_terminal: t.id.clone(),
                    from_name: Some("Broadcast".to_string()),
                    to_name: Some(t.name.clone()),
                    content: text.to_string(),
                    as_user: false,
                    timestamp: now,
                    status: A2AMessageStatus::Dispatched,
                    response: None,
                };
                created_messages.push(msg);
            }
        }

        let mut history = self.messages.lock();
        for msg in &created_messages {
            history.push(msg.clone());
        }

        created_messages
    }

    pub fn get_messages(&self) -> Vec<A2AMessage> {
        self.messages.lock().clone()
    }

    pub fn clear_messages(&self) {
        self.messages.lock().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_a2a_dispatch_peer_formatting() {
        let router = A2ARouter::new();
        let bridge_state = BridgeState::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-agent-1".to_string(),
            to_terminal: "term-agent-2".to_string(),
            prompt: "Please review PR #12".to_string(),
            as_user: Some(false),
        };

        let msg = router.dispatch(request, &bridge_state, None).unwrap();
        assert_eq!(msg.status, A2AMessageStatus::Dispatched);
        assert_eq!(msg.from_terminal, "term-agent-1");
        assert_eq!(msg.to_terminal, "term-agent-2");

        // Verify command in BridgeState queue for term-agent-2
        let drained = bridge_state.drain_commands("term-agent-2");
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].command_type, "prompt");
        assert!(drained[0].text.as_ref().unwrap().contains("[Message from peer agent in term-agent-1]:"));
        assert!(drained[0].text.as_ref().unwrap().contains("Please review PR #12"));
    }

    #[test]
    fn test_a2a_dispatch_as_user() {
        let router = A2ARouter::new();
        let bridge_state = BridgeState::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-agent-1".to_string(),
            to_terminal: "term-agent-2".to_string(),
            prompt: "cargo test --all".to_string(),
            as_user: Some(true),
        };

        let msg = router.dispatch(request, &bridge_state, None).unwrap();
        assert!(msg.as_user);

        let drained = bridge_state.drain_commands("term-agent-2");
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].text.as_deref(), Some("cargo test --all"));
        assert_eq!(drained[0].as_user, Some(true));
    }

    #[test]
    fn test_a2a_resolve_pending_reply_updates_history() {
        let router = A2ARouter::new();
        let bridge_state = BridgeState::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-a".to_string(),
            to_terminal: "term-b".to_string(),
            prompt: "Calculate 2+2".to_string(),
            as_user: None,
        };

        let _ = router.dispatch(request, &bridge_state, None).unwrap();

        let updated = router.resolve_pending_reply("term-b", "Result is 4".to_string());
        assert!(updated.is_some());
        let updated_msg = updated.unwrap();
        assert_eq!(updated_msg.status, A2AMessageStatus::Completed);
        assert_eq!(updated_msg.response.as_deref(), Some("Result is 4"));

        // Check in get_messages
        let messages = router.get_messages();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].status, A2AMessageStatus::Completed);
        assert_eq!(messages[0].response.as_deref(), Some("Result is 4"));
    }

    #[test]
    fn test_a2a_clear_messages() {
        let router = A2ARouter::new();
        let bridge_state = BridgeState::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-1".to_string(),
            to_terminal: "term-2".to_string(),
            prompt: "Test".to_string(),
            as_user: None,
        };

        let _ = router.dispatch(request, &bridge_state, None).unwrap();
        assert_eq!(router.get_messages().len(), 1);

        router.clear_messages();
        assert_eq!(router.get_messages().len(), 0);
    }

    #[test]
    fn test_a2a_broadcast_toast() {
        let router = A2ARouter::new();
        let bridge_state = BridgeState::new();
        let pty_manager = PtyManager::new();

        let msgs = router.broadcast_toast("Database migration complete", &bridge_state, &pty_manager);
        // PtyManager has 0 sessions initially
        assert_eq!(msgs.len(), 0);
        assert_eq!(router.get_messages().len(), 0);
    }
}
