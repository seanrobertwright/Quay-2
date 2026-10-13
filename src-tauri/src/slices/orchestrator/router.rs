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
use crate::slices::pty::models::RunKind;

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
    ) -> Result<A2AMessage, String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let msg_id = format!("a2a-{}", Uuid::new_v4().simple());

        let formatted_prompt = format!(
            "[Message from peer agent in {}]:\n{}",
            request.from_terminal, request.prompt
        );

        let cmd = Command {
            id: format!("cmd-{}", Uuid::new_v4().simple()),
            command_type: "prompt".to_string(),
            text: Some(formatted_prompt),
            as_user: request.as_user,
        };

        bridge_state.enqueue_command(&request.to_terminal, cmd);

        let message = A2AMessage {
            id: msg_id,
            from_terminal: request.from_terminal,
            to_terminal: request.to_terminal,
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
        timeout_secs: u64,
    ) -> Result<String, String> {
        let (tx, rx) = oneshot::channel();

        // Register pending reply listener for the target terminal
        {
            let mut pending = self.pending_replies.lock();
            pending
                .entry(request.to_terminal.clone())
                .or_default()
                .push(tx);
        }

        // Dispatch prompt to target agent
        let _ = self.dispatch(request.clone(), bridge_state)?;

        // Await target agent's turn completion with timeout
        match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
            Ok(Ok(response)) => {
                // Update message in history with the response
                let mut history = self.messages.lock();
                if let Some(msg) = history.iter_mut().rev().find(|m| {
                    m.from_terminal == request.from_terminal
                        && m.to_terminal == request.to_terminal
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
                        && m.to_terminal == request.to_terminal
                }) {
                    msg.status = A2AMessageStatus::Failed;
                    msg.response = Some("Timed out waiting for reply".to_string());
                }
                Ok(format!(
                    "Peer agent ({}) received the task but is still working. You can check their status later using quay_get_agent_status.",
                    request.to_terminal
                ))
            }
        }
    }

    pub fn resolve_pending_reply(&self, terminal_id: &str, answer: String) {
        let senders = {
            let mut pending = self.pending_replies.lock();
            pending.remove(terminal_id).unwrap_or_default()
        };

        for tx in senders {
            let _ = tx.send(answer.clone());
        }
    }

    pub fn broadcast_toast(
        &self,
        text: &str,
        bridge_state: &BridgeState,
        pty_manager: &PtyManager,
    ) {
        let terminals = pty_manager.list();
        for t in terminals {
            if t.run_kind == RunKind::Claude {
                let cmd = Command {
                    id: format!("toast-{}", Uuid::new_v4().simple()),
                    command_type: "toast".to_string(),
                    text: Some(text.to_string()),
                    as_user: None,
                };
                bridge_state.enqueue_command(&t.id, cmd);
            }
        }
    }

    pub fn get_messages(&self) -> Vec<A2AMessage> {
        self.messages.lock().clone()
    }
}
