use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use parking_lot::Mutex;
use tokio::sync::oneshot;
use uuid::Uuid;

use super::models::{A2ADispatchRequest, A2AMessage, A2AMessageStatus};
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::{BusLevel, ClaudeStatus, RunKind, TerminalInfo};
use crate::slices::pty::plugin_watch::EVENT_BRIDGE_INSTALL_LINE;

/// The sender recorded for a message dispatched as the user, whatever From Agent held.
const USER_SENDER: &str = "user";

/// How often a running wait checks whether its peer can still reply.
const LEVEL_CHECK: Duration = Duration::from_millis(250);

/// How a wait for a peer's reply ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WaitOutcome {
    /// The peer's answer, from the turn that followed the message.
    Reply(String),
    /// No reply came, or none can: what the sender is told instead.
    NoReply(String),
}

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

/// Refuses a peer message whose sender and receiver resolve to the same terminal: it would
/// type the sender's own message back into its prompt, and a sender waiting on itself never
/// gets a reply. A message dispatched as the user has no sending peer, so it is never refused.
fn refuse_dispatch_to_self(
    request: &A2ADispatchRequest,
    pty_manager: Option<&PtyManager>,
) -> Result<(), String> {
    if request.is_user_dispatch() {
        return Ok(());
    }
    let (from_id, to_id) = match pty_manager {
        Some(pty) => (
            resolve_terminal_id(&request.from_terminal, pty),
            resolve_terminal_id(&request.to_terminal, pty),
        ),
        None => (
            request.from_terminal.trim().to_string(),
            request.to_terminal.trim().to_string(),
        ),
    };
    if from_id == to_id {
        let name = resolve_terminal_name(&from_id, pty_manager);
        return Err(format!(
            "Refused: {} can't send a message to itself. Pick a different To Agent.",
            name
        ));
    }
    Ok(())
}

/// Refuses a message to an Archon terminal: it runs a workflow and has no prompt for a
/// message to land in, so typing into it would only disturb the run.
fn refuse_dispatch_to_archon(target: Option<&TerminalInfo>) -> Result<(), String> {
    match target {
        Some(t) if t.run_kind == RunKind::Archon => Err(format!(
            "Refused: {} is an Archon terminal. It runs a workflow and has no prompt for a message to land in.",
            t.name
        )),
        _ => Ok(()),
    }
}

/// What a sender waiting on `target` is told at once, because Quay can't return a reply
/// from it: it is a listener, or a Claude terminal whose event-bridge plugin isn't
/// reporting. `None` when the wait can run.
fn no_reply_answer(target: &TerminalInfo) -> Option<String> {
    if target.plugin_silent() {
        return Some(format!(
            "{name} got your message, but {name}'s event-bridge plugin isn't reporting, so Quay can't return its reply. \
             Ask the user to install it: `{install}`, then run `/reload-plugins` in {name}.",
            name = target.name,
            install = EVENT_BRIDGE_INSTALL_LINE,
        ));
    }
    if target.bus_level() == Some(BusLevel::Listener) {
        return Some(format!(
            "{name} got your message, but it is a listener and can't reply. If you need its answer, \
             use a file mailbox: ask {name} to write the answer to a file and end it with a last line you agree on, \
             then read the file once {name} is Idle and that line is there.",
            name = target.name,
        ));
    }
    None
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
        pty_manager: Option<&PtyManager>,
    ) -> Result<A2AMessage, String> {
        refuse_dispatch_to_self(&request, pty_manager)?;

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
        refuse_dispatch_to_archon(
            pty_manager.and_then(|pty| pty.get_info(&target_terminal_id)).as_ref(),
        )?;

        // A message dispatched as the user comes from the operator, not a peer, so it is
        // recorded from the user and the trail credits "You" whatever From Agent held.
        let as_user = request.is_user_dispatch();
        let (from_terminal, from_name) = if as_user {
            (USER_SENDER.to_string(), "You".to_string())
        } else {
            let name = resolve_terminal_name(&request.from_terminal, pty_manager);
            (request.from_terminal, name)
        };
        let to_name = resolve_terminal_name(&target_terminal_id, pty_manager);

        // Inject directly into target terminal's ConPTY stdin so the agent executes immediately!
        if let Some(pty) = pty_manager {
            let pty_prompt = if as_user {
                request.prompt.trim().replace("\r\n", " ").replace('\n', " ")
            } else {
                let clean_content = request.prompt.trim().replace("\r\n", " ").replace('\n', " ");
                format!("[Peer agent ({})]: {}", from_name, clean_content)
            };

            if let Err(e) = pty.submit_prompt(&target_terminal_id, &pty_prompt) {
                tracing::warn!("Failed writing A2A prompt to PTY {}: {}", target_terminal_id, e);
            } else {
                // Update receiver agent status to Working
                pty.mark_a2a_delivered(&target_terminal_id);
                tracing::info!("A2A prompt injected into PTY {} from {}", target_terminal_id, from_name);
            }
        }

        let message = A2AMessage {
            id: msg_id,
            from_terminal,
            to_terminal: target_terminal_id,
            from_name: Some(from_name),
            to_name: Some(to_name),
            content: request.prompt,
            as_user,
            timestamp: now,
            status: A2AMessageStatus::Dispatched,
            response: None,
        };

        self.messages.lock().push(message.clone());
        Ok(message)
    }

    /// Sends `request` and waits up to `timeout_secs` for the target's reply. A target
    /// that can't reply (see `no_reply_answer`) still gets the message, and the sender is
    /// told why at once; a running wait ends the same way as soon as its target can't reply.
    pub async fn dispatch_and_wait(
        &self,
        request: A2ADispatchRequest,
        pty_manager: Option<&PtyManager>,
        timeout_secs: u64,
    ) -> Result<WaitOutcome, String> {
        // Refuse before registering a reply listener, so a refused send leaves none behind.
        refuse_dispatch_to_self(&request, pty_manager)?;

        let resolved_target = if let Some(pty) = pty_manager {
            resolve_terminal_id(&request.to_terminal, pty)
        } else {
            request.to_terminal.clone()
        };
        let target_now = || pty_manager.and_then(|pty| pty.get_info(&resolved_target));
        refuse_dispatch_to_archon(target_now().as_ref())?;

        // Quay never waits on a peer that can't reply.
        if let Some(answer) = target_now().as_ref().and_then(no_reply_answer) {
            self.dispatch(request, pty_manager)?;
            return Ok(WaitOutcome::NoReply(answer));
        }

        let (tx, mut rx) = oneshot::channel();

        // Register pending reply listener for the target terminal
        {
            let mut pending = self.pending_replies.lock();
            pending
                .entry(resolved_target.clone())
                .or_default()
                .push(tx);
        }

        // Dispatch prompt to target agent
        let sent = self.dispatch(request, pty_manager)?;

        // Await the target's turn end, unless it stops being able to reply first
        let wait = async {
            loop {
                tokio::select! {
                    reply = &mut rx => return reply.map(WaitOutcome::Reply),
                    _ = tokio::time::sleep(LEVEL_CHECK) => {
                        if let Some(answer) = target_now().as_ref().and_then(no_reply_answer) {
                            return Ok(WaitOutcome::NoReply(answer));
                        }
                    }
                }
            }
        };

        match tokio::time::timeout(Duration::from_secs(timeout_secs), wait).await {
            Ok(Ok(WaitOutcome::Reply(response))) => {
                // Update message in history with the response
                let mut history = self.messages.lock();
                if let Some(msg) = history.iter_mut().rev().find(|m| m.id == sent.id) {
                    msg.status = A2AMessageStatus::Completed;
                    msg.response = Some(response.clone());
                }
                Ok(WaitOutcome::Reply(response))
            }
            Ok(Ok(no_reply)) => Ok(no_reply),
            Ok(Err(_)) => Err("Peer agent channel closed before replying".to_string()),
            Err(_) => {
                // Timeout
                let mut history = self.messages.lock();
                if let Some(msg) = history.iter_mut().rev().find(|m| m.id == sent.id) {
                    msg.status = A2AMessageStatus::Failed;
                    msg.response = Some("Timed out waiting for reply".to_string());
                }
                Ok(WaitOutcome::NoReply(format!(
                    "Peer agent ({}) received the task but is still working. You can check their status later using quay_get_agent_status.",
                    resolved_target
                )))
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
            if t.run_kind.is_peer() && t.claude_status != ClaudeStatus::Exited {
                // 1. Inject directly into ConPTY stdin so the agent receives the broadcast notice immediately!
                let pty_prompt = format!("[Broadcast Notice]: {}", clean_text);
                if let Err(e) = pty_manager.submit_prompt(&t.id, &pty_prompt) {
                    tracing::warn!("Failed writing broadcast to PTY {}: {}", t.id, e);
                } else {
                    pty_manager.mark_a2a_delivered(&t.id);
                    tracing::info!("Broadcast notice injected into PTY {}", t.id);
                }

                // 2. Create A2AMessage for message history and UI updates
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
    use crate::slices::pty::models::test_terminal;

    #[test]
    fn test_a2a_dispatch_records_peer_message() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-agent-1".to_string(),
            to_terminal: "term-agent-2".to_string(),
            prompt: "Please review PR #12".to_string(),
            as_user: Some(false),
        };

        let msg = router.dispatch(request, None).unwrap();
        assert_eq!(msg.status, A2AMessageStatus::Dispatched);
        assert_eq!(msg.from_terminal, "term-agent-1");
        assert_eq!(msg.to_terminal, "term-agent-2");
        assert_eq!(msg.content, "Please review PR #12");
    }

    #[test]
    fn test_a2a_dispatch_as_user() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-agent-1".to_string(),
            to_terminal: "term-agent-2".to_string(),
            prompt: "cargo test --all".to_string(),
            as_user: Some(true),
        };

        let msg = router.dispatch(request, None).unwrap();
        assert!(msg.as_user);
        assert_eq!(msg.content, "cargo test --all");
    }

    #[test]
    fn test_a2a_dispatch_as_user_is_credited_to_you() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "user".to_string(),
            to_terminal: "term-answerer".to_string(),
            prompt: "Say hello".to_string(),
            as_user: Some(true),
        };

        let msg = router.dispatch(request, None).unwrap();
        assert_eq!(msg.from_name.as_deref(), Some("You"));
        assert_eq!(msg.to_name.as_deref(), Some("term-answerer"));
        assert_eq!(router.get_messages()[0].from_name.as_deref(), Some("You"));
    }

    #[test]
    fn test_a2a_dispatch_as_user_is_recorded_from_the_user_whatever_from_agent_held() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-agent-1".to_string(),
            to_terminal: "term-answerer".to_string(),
            prompt: "Say hello".to_string(),
            as_user: Some(true),
        };

        let msg = router.dispatch(request, None).unwrap();
        assert_eq!(msg.from_terminal, "user");
        assert_eq!(msg.from_name.as_deref(), Some("You"));
    }

    #[test]
    fn test_a2a_dispatch_as_user_is_never_refused_as_self() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-answerer".to_string(),
            to_terminal: "term-answerer".to_string(),
            prompt: "Say hello".to_string(),
            as_user: Some(true),
        };

        assert!(router.dispatch(request, None).is_ok());
    }

    #[tokio::test]
    async fn test_a2a_dispatch_and_wait_to_self_is_refused() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-agent-1".to_string(),
            to_terminal: "term-agent-1".to_string(),
            prompt: "Wait on yourself".to_string(),
            as_user: Some(false),
        };

        let err = router.dispatch_and_wait(request, None, 1).await.unwrap_err();
        assert!(err.contains("itself"), "unexpected refusal message: {err}");
        assert!(router.get_messages().is_empty());
    }

    #[tokio::test]
    async fn test_a2a_dispatch_and_wait_as_user_marks_its_message_when_it_times_out() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-agent-1".to_string(),
            to_terminal: "term-answerer".to_string(),
            prompt: "Say hello".to_string(),
            as_user: Some(true),
        };

        router.dispatch_and_wait(request, None, 0).await.unwrap();
        let messages = router.get_messages();
        assert_eq!(messages[0].status, A2AMessageStatus::Failed);
        assert_eq!(messages[0].response.as_deref(), Some("Timed out waiting for reply"));
    }

    #[test]
    fn test_a2a_dispatch_to_self_is_refused_and_nothing_is_sent() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-agent-1".to_string(),
            to_terminal: "term-agent-1".to_string(),
            prompt: "Talk to yourself".to_string(),
            as_user: Some(false),
        };

        let err = router.dispatch(request, None).unwrap_err();
        assert!(err.contains("itself"), "unexpected refusal message: {err}");
        assert!(router.get_messages().is_empty());
    }

    #[test]
    fn test_a2a_resolve_pending_reply_updates_history() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-a".to_string(),
            to_terminal: "term-b".to_string(),
            prompt: "Calculate 2+2".to_string(),
            as_user: None,
        };

        let _ = router.dispatch(request, None).unwrap();

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

        let request = A2ADispatchRequest {
            from_terminal: "term-1".to_string(),
            to_terminal: "term-2".to_string(),
            prompt: "Test".to_string(),
            as_user: None,
        };

        let _ = router.dispatch(request, None).unwrap();
        assert_eq!(router.get_messages().len(), 1);

        router.clear_messages();
        assert_eq!(router.get_messages().len(), 0);
    }

    #[test]
    fn test_a2a_broadcast_toast() {
        let router = A2ARouter::new();
        let pty_manager = PtyManager::new();

        let msgs = router.broadcast_toast("Database migration complete", &pty_manager);
        // PtyManager has 0 sessions initially
        assert_eq!(msgs.len(), 0);
        assert_eq!(router.get_messages().len(), 0);
    }

    fn manager_with(terminals: &[(&str, RunKind, ClaudeStatus)]) -> PtyManager {
        let manager = PtyManager::new();
        for (id, run_kind, status) in terminals {
            manager.insert_test_terminal(test_terminal(id, *run_kind, status.clone()));
        }
        manager
    }

    fn peer_message(from: &str, to: &str) -> A2ADispatchRequest {
        A2ADispatchRequest {
            from_terminal: from.to_string(),
            to_terminal: to.to_string(),
            prompt: "What is 2+2?".to_string(),
            as_user: Some(false),
        }
    }

    /// Runs `wait`, failing the test if it takes more than a second.
    async fn at_once<F: std::future::Future>(wait: F) -> F::Output {
        tokio::time::timeout(Duration::from_secs(1), wait)
            .await
            .expect("the wait answered at once")
    }

    #[tokio::test]
    async fn a_wait_on_a_listener_delivers_the_message_and_answers_at_once() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-lvl-asker", RunKind::Claude, ClaudeStatus::Idle),
            ("term-lvl-gemini", RunKind::Gemini, ClaudeStatus::Starting),
        ]);

        let outcome = at_once(router.dispatch_and_wait(
            peer_message("term-lvl-asker", "term-lvl-gemini"),
            Some(&pty),
            60,
        ))
        .await
        .unwrap();

        let WaitOutcome::NoReply(answer) = outcome else {
            panic!("a listener never replies: {outcome:?}");
        };
        assert!(answer.contains("term-lvl-gemini"), "{answer}");
        assert!(answer.contains("listener"), "{answer}");
        assert!(answer.contains("file mailbox"), "{answer}");
        assert!(!answer.contains("Turn completed"), "{answer}");
        let messages = router.get_messages();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].to_terminal, "term-lvl-gemini");
        assert_eq!(messages[0].status, A2AMessageStatus::Dispatched);
    }

    #[tokio::test]
    async fn a_wait_on_an_unknown_claude_terminal_answers_at_once_with_the_plugin_fix() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-lvl-asker2", RunKind::Claude, ClaudeStatus::Idle),
            ("term-lvl-silent", RunKind::Claude, ClaudeStatus::Unknown),
        ]);

        let outcome = at_once(router.dispatch_and_wait(
            peer_message("term-lvl-asker2", "term-lvl-silent"),
            Some(&pty),
            60,
        ))
        .await
        .unwrap();

        let WaitOutcome::NoReply(answer) = outcome else {
            panic!("an Unknown Claude terminal can't reply: {outcome:?}");
        };
        assert!(answer.contains("term-lvl-silent's event-bridge plugin isn't reporting"), "{answer}");
        assert!(answer.contains(EVENT_BRIDGE_INSTALL_LINE), "{answer}");
        assert_eq!(router.get_messages().len(), 1);
    }

    #[tokio::test]
    async fn a_wait_already_running_when_its_terminal_turns_unknown_ends_then() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-lvl-asker3", RunKind::Claude, ClaudeStatus::Idle),
            ("term-lvl-goes-silent", RunKind::Claude, ClaudeStatus::Starting),
        ]);

        let waiting = {
            let router = router.clone();
            let pty = pty.clone();
            tokio::spawn(async move {
                router
                    .dispatch_and_wait(
                        peer_message("term-lvl-asker3", "term-lvl-goes-silent"),
                        Some(&pty),
                        60,
                    )
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!waiting.is_finished(), "a Starting Claude terminal is still a full peer");
        pty.update_status("term-lvl-goes-silent", ClaudeStatus::Unknown);

        let outcome = at_once(waiting).await.unwrap().unwrap();
        let WaitOutcome::NoReply(answer) = outcome else {
            panic!("the wait ends once the terminal is Unknown: {outcome:?}");
        };
        assert!(answer.contains("event-bridge plugin isn't reporting"), "{answer}");
    }

    #[tokio::test]
    async fn a_wait_on_a_starting_claude_terminal_returns_its_reply() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-lvl-asker4", RunKind::Claude, ClaudeStatus::Idle),
            ("term-lvl-starting", RunKind::Claude, ClaudeStatus::Starting),
        ]);

        let waiting = {
            let router = router.clone();
            let pty = pty.clone();
            tokio::spawn(async move {
                router
                    .dispatch_and_wait(
                        peer_message("term-lvl-asker4", "term-lvl-starting"),
                        Some(&pty),
                        60,
                    )
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;
        router.resolve_pending_reply("term-lvl-starting", "4".to_string());

        let outcome = at_once(waiting).await.unwrap().unwrap();
        assert_eq!(outcome, WaitOutcome::Reply("4".to_string()));
    }

    #[tokio::test]
    async fn a_message_to_an_archon_terminal_is_refused_and_nothing_is_sent() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-lvl-asker5", RunKind::Claude, ClaudeStatus::Idle),
            ("term-lvl-archon", RunKind::Archon, ClaudeStatus::Starting),
        ]);

        let err = router
            .dispatch(peer_message("term-lvl-asker5", "term-lvl-archon"), Some(&pty))
            .unwrap_err();
        assert!(err.contains("Archon"), "{err}");
        let err = router
            .dispatch_and_wait(peer_message("term-lvl-asker5", "term-lvl-archon"), Some(&pty), 1)
            .await
            .unwrap_err();
        assert!(err.contains("Archon"), "{err}");
        let mut as_user = peer_message("term-lvl-asker5", "term-lvl-archon");
        as_user.as_user = Some(true);
        assert!(router.dispatch(as_user, Some(&pty)).is_err());

        assert!(router.get_messages().is_empty());
        assert!(router.pending_replies.lock().get("term-lvl-archon").is_none());
    }

    #[test]
    fn a_broadcast_skips_archon_and_shell_terminals() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-lvl-bc-claude", RunKind::Claude, ClaudeStatus::Idle),
            ("term-lvl-bc-gemini", RunKind::Gemini, ClaudeStatus::Starting),
            ("term-lvl-bc-archon", RunKind::Archon, ClaudeStatus::Working),
            ("term-lvl-bc-shell", RunKind::PowerShell, ClaudeStatus::Unknown),
        ]);

        let mut reached: Vec<String> = router
            .broadcast_toast("Release is frozen", &pty)
            .into_iter()
            .map(|m| m.to_terminal)
            .filter(|id| id.starts_with("term-lvl-bc-"))
            .collect();
        reached.sort();

        assert_eq!(reached, ["term-lvl-bc-claude", "term-lvl-bc-gemini"]);
    }
}
