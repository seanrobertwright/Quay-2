use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use parking_lot::Mutex;
use tokio::sync::oneshot;
use uuid::Uuid;

use super::models::{A2ADispatchRequest, A2AMessage, A2AMessageStatus, Broadcast, BroadcastSender};
use super::target::{resolve_target, same_project};
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::{BusLevel, ClaudeStatus, RunKind, TerminalInfo};
use crate::slices::pty::plugin_watch::EVENT_BRIDGE_INSTALL_LINE;

/// The sender recorded for a message dispatched as the user, whatever From Agent held.
const USER_SENDER: &str = "user";

/// The name the trail and toasts credit for the operator's messages and broadcasts.
const USER_NAME: &str = "You";

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

/// What Quay types before a message one peer sends another.
fn peer_prefix(from_name: &str) -> String {
    format!("[Peer agent ({})]: ", from_name)
}

/// `prompt` without the `[Peer agent (<name>)]: ` prefix Quay types before a peer's
/// message, so a task title shows the message itself.
pub fn strip_peer_prefix(prompt: &str) -> &str {
    prompt
        .strip_prefix("[Peer agent (")
        .and_then(|rest| rest.split_once(")]: "))
        .map_or(prompt, |(_, message)| message)
}

/// The sender's session name, or what the request gave when no terminal has that id.
fn sender_name(from_terminal: &str, pty_manager: Option<&PtyManager>) -> String {
    let trimmed = from_terminal.trim();
    pty_manager
        .and_then(|pty| pty.get_info(trimmed))
        .map_or_else(|| trimmed.to_string(), |info| info.name)
}

/// Where `request` goes: its id, and its terminal when there is a PTY manager to resolve
/// it with `resolve_target`, a name matching in the sender's project first. Without one
/// (in tests) the target is taken as given. Refuses a target that is the sender itself,
/// an Archon terminal, or a terminal that has exited.
fn checked_target(
    request: &A2ADispatchRequest,
    pty_manager: Option<&PtyManager>,
) -> Result<(String, Option<TerminalInfo>), String> {
    let (target_id, target) = match pty_manager {
        Some(pty) => {
            let sender = (!request.is_user_dispatch()).then_some(request.from_terminal.as_str());
            let info = resolve_target(&request.to_terminal, sender, pty)?;
            (info.id.clone(), Some(info))
        }
        None => (request.to_terminal.trim().to_string(), None),
    };
    refuse_dispatch_to_self(request, &target_id, pty_manager)?;
    refuse_dispatch_to_archon(target.as_ref())?;
    refuse_dispatch_to_exited(target.as_ref())?;
    Ok((target_id, target))
}

/// Refuses a peer message whose sender is its own target: it would type the sender's own
/// message back into its prompt, and a sender waiting on itself never gets a reply. A
/// message dispatched as the user has no sending peer, so it is never refused.
fn refuse_dispatch_to_self(
    request: &A2ADispatchRequest,
    target_id: &str,
    pty_manager: Option<&PtyManager>,
) -> Result<(), String> {
    if request.is_user_dispatch() || request.from_terminal.trim() != target_id {
        return Ok(());
    }
    Err(format!(
        "Refused: {} can't send a message to itself. Pick a different To Agent.",
        sender_name(&request.from_terminal, pty_manager)
    ))
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

/// Refuses a message to a terminal that has exited: no agent is running to read it, so it
/// would never be typed in or answered. Its terminal id still reaches it for
/// `quay_get_agent_status`.
fn refuse_dispatch_to_exited(target: Option<&TerminalInfo>) -> Result<(), String> {
    match target {
        Some(t) if t.claude_status == ClaudeStatus::Exited => Err(format!(
            "Refused: {} has exited, so it can't take a message. Ask the user to relaunch it.",
            t.name
        )),
        _ => Ok(()),
    }
}

/// What a sender waiting on `target` is told at once, because Quay can't return a reply
/// from it: it has exited, it is a listener, or it is a Claude terminal whose
/// event-bridge plugin isn't reporting. `None` when the wait can run.
fn no_reply_answer(target: &TerminalInfo) -> Option<String> {
    if target.claude_status == ClaudeStatus::Exited {
        return Some(format!(
            "{name} exited before it replied. Ask the user to relaunch it.",
            name = target.name,
        ));
    }
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
             then read the file once that line is there. Quay can't see when a listener finishes, so its status stays Unknown.",
            name = target.name,
        ));
    }
    None
}

/// Types `text` into `terminal_id` with its Enter. The terminal shows Working from before
/// the Enter goes in, so the turn the Enter starts can't end before Working is set and be
/// overwritten by it. A failed write puts the status back.
fn type_in(pty_manager: &PtyManager, terminal_id: &str, text: &str) -> Result<(), String> {
    let before = pty_manager.get_info(terminal_id).map(|t| t.claude_status);
    pty_manager.mark_a2a_delivered(terminal_id);
    let typed = pty_manager.submit_prompt(terminal_id, text);
    if let (Err(_), Some(before)) = (&typed, before) {
        pty_manager.update_status(terminal_id, before);
    }
    typed
}

/// A message waiting for its target's turn to end, and the text Quay will type for it.
struct HeldDelivery {
    message_id: String,
    text: String,
}

/// Which of a terminal's messages its turns answer.
#[derive(Default)]
struct TurnPairing {
    /// Messages typed in whose turn hasn't started yet, oldest first.
    awaiting_turn: VecDeque<String>,
    /// The message the running turn answers, when a delivered message started it.
    answering: Option<String>,
}

/// Each terminal's delivery queue, the terminals Quay is typing a message into now, and
/// which message each terminal's turns answer.
#[derive(Default)]
struct DeliveryQueues {
    waiting: HashMap<String, VecDeque<HeldDelivery>>,
    typing: HashSet<String>,
    turns: HashMap<String, TurnPairing>,
}

impl DeliveryQueues {
    /// Marks `terminal_id` as being typed into with `message_id`, which the next turn that
    /// starts there answers. Recorded before the Enter goes in, so that turn's start can't
    /// arrive first.
    fn start_typing(&mut self, terminal_id: &str, message_id: &str) {
        self.typing.insert(terminal_id.to_string());
        self.turns
            .entry(terminal_id.to_string())
            .or_default()
            .awaiting_turn
            .push_back(message_id.to_string());
    }

    /// Ends the typing `start_typing` began. A message that couldn't be typed awaits no turn.
    fn finish_typing(&mut self, terminal_id: &str, message_id: &str, typed: bool) {
        self.typing.remove(terminal_id);
        if !typed {
            if let Some(pairing) = self.turns.get_mut(terminal_id) {
                pairing.awaiting_turn.retain(|id| id != message_id);
            }
        }
    }

    /// Pairs the turn starting on `terminal_id` with the oldest message awaiting one.
    fn start_turn(&mut self, terminal_id: &str) {
        let pairing = self.turns.entry(terminal_id.to_string()).or_default();
        pairing.answering = pairing.awaiting_turn.pop_front();
    }

    /// The message the turn ending on `terminal_id` answers, if a delivered message started it.
    fn end_turn(&mut self, terminal_id: &str) -> Option<String> {
        self.turns.get_mut(terminal_id)?.answering.take()
    }

    /// Whether a new message to `terminal_id` must queue behind one already in hand.
    fn occupied(&self, terminal_id: &str) -> bool {
        self.typing.contains(terminal_id)
            || self.waiting.get(terminal_id).is_some_and(|queue| !queue.is_empty())
    }

    fn pop_next(&mut self, terminal_id: &str) -> Option<HeldDelivery> {
        let queue = self.waiting.get_mut(terminal_id)?;
        let next = queue.pop_front();
        if queue.is_empty() {
            self.waiting.remove(terminal_id);
        }
        next
    }
}

/// What the trail listener runs with each trail entry as it is added or changed.
type TrailListener = Arc<dyn Fn(&A2AMessage) + Send + Sync>;

#[derive(Clone)]
pub struct A2ARouter {
    /// The trail, in the order entries joined it. Entries are added and changed only
    /// through `record` and `update`; `clear_messages` empties it.
    messages: Arc<Mutex<Vec<A2AMessage>>>,
    /// Each terminal's reply waiters, with the id of the message each one waits on.
    pending_replies: Arc<Mutex<HashMap<String, Vec<(String, oneshot::Sender<String>)>>>>,
    /// Lock before any `PtyManager` lock when taking both.
    deliveries: Arc<Mutex<DeliveryQueues>>,
    trail_listener: Arc<Mutex<Option<TrailListener>>>,
}

impl A2ARouter {
    pub fn new() -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
            pending_replies: Arc::new(Mutex::new(HashMap::new())),
            deliveries: Arc::new(Mutex::new(DeliveryQueues::default())),
            trail_listener: Arc::new(Mutex::new(None)),
        }
    }

    /// Runs `listener` with each trail entry when it is added and each time it changes: a
    /// message as it is typed in or queued, a held message as it is typed in or fails, and
    /// an entry as its turn's answer completes it. It runs while the trail is locked, so
    /// it hears changes in the order they happen and must not call back into the router.
    pub fn set_trail_listener(&self, listener: impl Fn(&A2AMessage) + Send + Sync + 'static) {
        *self.trail_listener.lock() = Some(Arc::new(listener));
    }

    /// The message `id` as the trail holds it now.
    fn message(&self, id: &str) -> Option<A2AMessage> {
        self.messages.lock().iter().find(|m| m.id == id).cloned()
    }

    fn notify(&self, message: &A2AMessage) {
        let listener = self.trail_listener.lock().clone();
        if let Some(listener) = listener {
            listener(message);
        }
    }

    /// Adds `message` to the trail and tells the trail listener.
    fn record(&self, message: &A2AMessage) {
        let mut history = self.messages.lock();
        history.push(message.clone());
        self.notify(message);
    }

    /// Runs `change` on the trail entry for message `id`. When it reports a change, tells
    /// the trail listener and returns the changed entry; otherwise, or when the trail no
    /// longer holds the message, returns `None`.
    fn update(&self, id: &str, change: impl FnOnce(&mut A2AMessage) -> bool) -> Option<A2AMessage> {
        let mut history = self.messages.lock();
        let msg = history.iter_mut().find(|m| m.id == id)?;
        if !change(msg) {
            return None;
        }
        let msg = msg.clone();
        self.notify(&msg);
        Some(msg)
    }

    /// Hands `message` to its target, with `text` as what Quay types. A message to a
    /// terminal that holds deliveries, or that already has messages queued or being typed,
    /// joins the back of that terminal's queue and is recorded Queued; `deliver_held` types
    /// it when its turn comes. Any other message is typed now and recorded Dispatched, and
    /// a failed write fails the call and records nothing. Either way the entry is recorded
    /// as soon as it is queued or typed in, before the call returns. Blocks while it types.
    fn deliver(
        &self,
        mut message: A2AMessage,
        text: String,
        pty_manager: Option<&PtyManager>,
    ) -> Result<A2AMessage, String> {
        let Some(pty) = pty_manager else {
            message.status = A2AMessageStatus::Dispatched;
            let mut queues = self.deliveries.lock();
            queues.start_typing(&message.to_terminal, &message.id);
            queues.finish_typing(&message.to_terminal, &message.id, true);
            drop(queues);
            self.record(&message);
            return Ok(message);
        };
        let target = message.to_terminal.clone();

        // Decided under the queue lock, so two messages to an idle terminal can't both go now.
        {
            let mut queues = self.deliveries.lock();
            let held = pty.get_info(&target).is_some_and(|t| t.holds_deliveries());
            if held || queues.occupied(&target) {
                message.status = A2AMessageStatus::Queued;
                // Recorded under the queue lock, so no `deliver_held` can type it first.
                self.record(&message);
                queues
                    .waiting
                    .entry(target.clone())
                    .or_default()
                    .push_back(HeldDelivery { message_id: message.id.clone(), text });
                drop(queues);
                // A terminal that doesn't hold deliveries takes its queue now, in order.
                if !held {
                    self.deliver_held(&target, pty);
                }
                return Ok(self.message(&message.id).unwrap_or(message));
            }
            queues.start_typing(&target, &message.id);
        }

        let typed = type_in(pty, &target, &text);
        if typed.is_ok() {
            message.status = A2AMessageStatus::Dispatched;
            self.record(&message);
        }
        self.deliveries.lock().finish_typing(&target, &message.id, typed.is_ok());
        // Messages that queued behind this one go now, or at the turn end it starts.
        self.deliver_held(&target, pty);
        typed.map(|()| message)
    }

    /// Types the messages held for `terminal_id` while it doesn't hold deliveries: the next
    /// one after each turn end while Quay sees its turn end, and all of them once Quay
    /// doesn't (it went Unknown, or closed). Each goes Dispatched, or Failed when typing it
    /// fails or the terminal has exited, and is passed to the trail listener. Blocks while
    /// it types.
    pub fn deliver_held(&self, terminal_id: &str, pty_manager: &PtyManager) {
        loop {
            let (next, exited) = {
                let mut queues = self.deliveries.lock();
                let info = pty_manager.get_info(terminal_id);
                if info.as_ref().is_some_and(TerminalInfo::holds_deliveries)
                    || queues.typing.contains(terminal_id)
                {
                    return;
                }
                let Some(next) = queues.pop_next(terminal_id) else {
                    return;
                };
                queues.start_typing(terminal_id, &next.message_id);
                let exited = info.is_some_and(|t| t.claude_status == ClaudeStatus::Exited);
                (next, exited)
            };

            let typed = if exited {
                Err("the terminal exited".to_string())
            } else {
                type_in(pty_manager, terminal_id, &next.text)
            };
            // Only a Queued entry moves: a waiter whose reply came first may have completed it.
            self.update(&next.message_id, |msg| {
                if msg.status != A2AMessageStatus::Queued {
                    return false;
                }
                match &typed {
                    Ok(()) => msg.status = A2AMessageStatus::Dispatched,
                    Err(e) => {
                        msg.status = A2AMessageStatus::Failed;
                        msg.response = Some(format!("Not delivered: {}", e));
                    }
                }
                true
            });
            self.deliveries.lock().finish_typing(terminal_id, &next.message_id, typed.is_ok());
            if let Err(e) = &typed {
                tracing::warn!("Failed typing a held A2A message into PTY {}: {}", terminal_id, e);
            }
        }
    }

    /// Sends `request` and returns its trail entry, Queued or Dispatched. Blocks while it
    /// types; async callers use `dispatch_async`.
    pub fn dispatch(
        &self,
        request: A2ADispatchRequest,
        pty_manager: Option<&PtyManager>,
    ) -> Result<A2AMessage, String> {
        let (target_id, target) = checked_target(&request, pty_manager)?;
        let (message, text) = self.prepare(request, target_id, target, pty_manager);
        self.deliver(message, text, pty_manager)
    }

    /// `dispatch`, with the typing on a blocking thread so the caller's async worker stays free.
    pub async fn dispatch_async(
        &self,
        request: A2ADispatchRequest,
        pty_manager: Option<&PtyManager>,
    ) -> Result<A2AMessage, String> {
        let (target_id, target) = checked_target(&request, pty_manager)?;
        let (message, text) = self.prepare(request, target_id, target, pty_manager);
        self.deliver_async(message, text, pty_manager).await
    }

    async fn deliver_async(
        &self,
        message: A2AMessage,
        text: String,
        pty_manager: Option<&PtyManager>,
    ) -> Result<A2AMessage, String> {
        let router = self.clone();
        let pty_manager = pty_manager.cloned();
        tokio::task::spawn_blocking(move || router.deliver(message, text, pty_manager.as_ref()))
            .await
            .map_err(|e| format!("Delivery stopped: {}", e))?
    }

    /// `broadcast_toast`, with the typing on a blocking thread so the caller's async worker
    /// stays free.
    pub async fn broadcast_toast_async(
        &self,
        text: &str,
        sender: &BroadcastSender,
        pty_manager: &PtyManager,
    ) -> Result<Broadcast, String> {
        let router = self.clone();
        let pty_manager = pty_manager.clone();
        let text = text.to_string();
        let sender = sender.clone();
        tokio::task::spawn_blocking(move || router.broadcast_toast(&text, &sender, &pty_manager))
            .await
            .map_err(|e| format!("Broadcast stopped: {}", e))?
    }

    /// Builds the trail entry for `request` to its already checked target, and the text
    /// Quay types for it.
    fn prepare(
        &self,
        request: A2ADispatchRequest,
        target_terminal_id: String,
        target: Option<TerminalInfo>,
        pty_manager: Option<&PtyManager>,
    ) -> (A2AMessage, String) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let msg_id = format!("a2a-{}", Uuid::new_v4().simple());

        // A message dispatched as the user comes from the operator, not a peer, so it is
        // recorded from the user and the trail credits "You" whatever From Agent held.
        let as_user = request.is_user_dispatch();
        let (from_terminal, from_name) = if as_user {
            (USER_SENDER.to_string(), USER_NAME.to_string())
        } else {
            let name = sender_name(&request.from_terminal, pty_manager);
            (request.from_terminal, name)
        };
        let to_name = target.map_or_else(|| target_terminal_id.clone(), |t| t.name);

        let clean_content = request.prompt.trim().replace("\r\n", " ").replace('\n', " ");
        let pty_prompt = if as_user {
            clean_content
        } else {
            format!("{}{}", peer_prefix(&from_name), clean_content)
        };

        let message = A2AMessage {
            id: msg_id,
            from_terminal,
            to_terminal: target_terminal_id,
            from_name: Some(from_name),
            to_name: Some(to_name),
            content: request.prompt,
            as_user,
            broadcast: false,
            timestamp: now,
            status: A2AMessageStatus::Queued,
            response: None,
            note: None,
        };

        (message, pty_prompt)
    }

    /// Sends `request` and waits for the target's reply until `timeout_secs` after the call,
    /// typing the message included. A target that can't reply (see `no_reply_answer`)
    /// still gets the message, and the sender is told why at once; a running wait ends the
    /// same way as soon as its target can't reply. A wait that runs out leaves the message
    /// Queued or Dispatched with a "No reply within" note, and the turn it starts still
    /// fills the entry in.
    pub async fn dispatch_and_wait(
        &self,
        request: A2ADispatchRequest,
        pty_manager: Option<&PtyManager>,
        timeout_secs: u64,
    ) -> Result<WaitOutcome, String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
        // Refuse before registering a reply listener, so a refused send leaves none behind.
        let (resolved_target, target) = checked_target(&request, pty_manager)?;
        let target_name = target
            .as_ref()
            .map_or_else(|| resolved_target.clone(), |t| t.name.clone());
        let target_now = || pty_manager.and_then(|pty| pty.get_info(&resolved_target));

        // Quay never waits on a peer that can't reply.
        if let Some(answer) = target.as_ref().and_then(no_reply_answer) {
            let (message, text) = self.prepare(request, resolved_target.clone(), target, pty_manager);
            self.deliver_async(message, text, pty_manager).await?;
            return Ok(WaitOutcome::NoReply(answer));
        }

        let (message, text) = self.prepare(request, resolved_target.clone(), target, pty_manager);
        let message_id = message.id.clone();
        let (tx, mut rx) = oneshot::channel();

        // Register before sending, so the turn the message starts can't end unheard
        self.pending_replies
            .lock()
            .entry(resolved_target.clone())
            .or_default()
            .push((message_id.clone(), tx));

        let sent = match self.deliver_async(message, text, pty_manager).await {
            Ok(sent) => sent,
            Err(e) => {
                self.forget_waiter(&resolved_target, &message_id);
                return Err(e);
            }
        };

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

        match tokio::time::timeout_at(deadline, wait).await {
            Ok(Ok(WaitOutcome::Reply(response))) => {
                // `resolve_pending_reply` completes the entry, unless the turn ended before
                // Quay recorded the message as typed in.
                self.update(&sent.id, |msg| match msg.status {
                    A2AMessageStatus::Queued | A2AMessageStatus::Dispatched => {
                        msg.status = A2AMessageStatus::Completed;
                        msg.response = Some(response.clone());
                        true
                    }
                    _ => false,
                });
                Ok(WaitOutcome::Reply(response))
            }
            Ok(Ok(no_reply)) => Ok(no_reply),
            Ok(Err(_)) => Err("Peer agent channel closed before replying".to_string()),
            Err(_) => {
                self.forget_waiter(&resolved_target, &sent.id);
                // The entry keeps its status and gains a note: the turn the message starts
                // still fills it in. A turn that ended as the clock ran out already has.
                let mut answered = None;
                let mut still_queued = false;
                self.update(&sent.id, |msg| {
                    if msg.status == A2AMessageStatus::Completed {
                        answered = Some(msg.response.clone().unwrap_or_default());
                        return false;
                    }
                    still_queued = msg.status == A2AMessageStatus::Queued;
                    msg.note = Some(format!("No reply within {}s", timeout_secs));
                    true
                });
                if let Some(answer) = answered {
                    return Ok(WaitOutcome::Reply(answer));
                }
                Ok(WaitOutcome::NoReply(if still_queued {
                    format!(
                        "Your message to peer agent ({}) is queued behind its current turn and will be delivered when that turn ends. You can check their status later using quay_get_agent_status.",
                        target_name
                    )
                } else {
                    format!(
                        "Peer agent ({}) received the task but is still working. You can check their status later using quay_get_agent_status.",
                        target_name
                    )
                }))
            }
        }
    }

    /// Drops the reply waiter for message `message_id` to `terminal_id`.
    fn forget_waiter(&self, terminal_id: &str, message_id: &str) {
        let mut pending = self.pending_replies.lock();
        if let Some(waiters) = pending.get_mut(terminal_id) {
            waiters.retain(|(id, _)| id != message_id);
            if waiters.is_empty() {
                pending.remove(terminal_id);
            }
        }
    }

    /// Pairs the turn starting on `terminal_id` with the oldest message typed in there
    /// that no turn has taken yet. A turn that starts with none (the user typed its
    /// prompt) answers no message.
    pub fn turn_started(&self, terminal_id: &str) {
        self.deliveries.lock().start_turn(terminal_id);
    }

    /// Forgets which messages `terminal_id`'s turns answer, when its session ends: no turn
    /// of a later session answers a message typed into this one.
    pub fn forget_turns(&self, terminal_id: &str) {
        self.deliveries.lock().turns.remove(terminal_id);
    }

    /// Ends the turn running on `terminal_id` with `answer`: completes the message that
    /// turn started (see `turn_started`), tells the trail listener, and hands `answer` to
    /// the senders waiting on it. A turn that no delivered message started completes
    /// nothing, so an answer always comes from the turn that followed its message.
    pub fn resolve_pending_reply(&self, terminal_id: &str, answer: String) -> Option<A2AMessage> {
        let message_id = self.deliveries.lock().end_turn(terminal_id)?;

        let updated_msg = self.update(&message_id, |msg| {
            if msg.status != A2AMessageStatus::Dispatched {
                return false;
            }
            msg.status = A2AMessageStatus::Completed;
            msg.response = Some(answer.clone());
            true
        });

        let senders = {
            let mut pending = self.pending_replies.lock();
            let waiters = pending.remove(terminal_id).unwrap_or_default();
            let (ready, others): (Vec<_>, Vec<_>) =
                waiters.into_iter().partition(|(id, _)| *id == message_id);
            if !others.is_empty() {
                pending.insert(terminal_id.to_string(), others);
            }
            ready
        };

        for (_, tx) in senders {
            let _ = tx.send(answer.clone());
        }

        updated_msg
    }

    /// Types `text` as a notice into every running peer in the sender's project, never the
    /// sender itself: the caller's project for a peer, the active project for Mission
    /// Control. A worktree is its own project. Each notice is credited to the sender
    /// (**You** from Mission Control) and goes through its target's queue. Refuses empty
    /// text, a Mission Control broadcast with no project, and a sender Quay doesn't know.
    /// Blocks while it types; async callers use `broadcast_toast_async`.
    pub fn broadcast_toast(
        &self,
        text: &str,
        sender: &BroadcastSender,
        pty_manager: &PtyManager,
    ) -> Result<Broadcast, String> {
        let clean_text = text.trim().replace("\r\n", " ").replace('\n', " ");
        if clean_text.is_empty() {
            return Err("No broadcast text given. Pass the notice to send.".to_string());
        }
        let (from_terminal, from_name, project) = match sender {
            BroadcastSender::Peer(id) => {
                let info = pty_manager.get_info(id.trim()).ok_or_else(|| {
                    format!("Refused: no terminal has the ID '{}', so Quay can't tell whose project to broadcast to.", id)
                })?;
                (info.id, info.name, info.project_path)
            }
            BroadcastSender::User { project } => {
                if project.trim().is_empty() {
                    return Err("No active project to broadcast to. Open a project first.".to_string());
                }
                (USER_SENDER.to_string(), USER_NAME.to_string(), project.clone())
            }
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let pty_prompt = format!("[Broadcast Notice]: {}", clean_text);
        let notices: Vec<A2AMessage> = pty_manager
            .list()
            .into_iter()
            .filter(|t| {
                t.bus_level().is_some()
                    && t.claude_status != ClaudeStatus::Exited
                    && t.id != from_terminal
                    && same_project(&t.project_path, &project)
            })
            .map(|t| A2AMessage {
                id: format!("broadcast-{}", Uuid::new_v4().simple()),
                from_terminal: from_terminal.clone(),
                to_terminal: t.id,
                from_name: Some(from_name.clone()),
                to_name: Some(t.name),
                content: text.to_string(),
                as_user: false,
                broadcast: true,
                timestamp: now,
                status: A2AMessageStatus::Queued,
                response: None,
                note: None,
            })
            .collect();

        // Each notice goes through its target's queue, so a busy peer gets it after its turn.
        // Notices typed now are typed side by side, since each takes the submit delay.
        let notices = std::thread::scope(|scope| {
            let sends: Vec<_> = notices
                .into_iter()
                .map(|notice| {
                    let pty_prompt = pty_prompt.clone();
                    scope.spawn(move || {
                        let mut failed = notice.clone();
                        self.deliver(notice, pty_prompt, Some(pty_manager))
                            .unwrap_or_else(|e| {
                                tracing::warn!("Failed writing broadcast to PTY {}: {}", failed.to_terminal, e);
                                failed.status = A2AMessageStatus::Failed;
                                failed.response = Some(format!("Not delivered: {}", e));
                                self.record(&failed);
                                failed
                            })
                    })
                })
                .collect();
            sends
                .into_iter()
                .map(|send| send.join().expect("a broadcast delivery thread panicked"))
                .collect()
        });
        Ok(Broadcast { from_name, notices })
    }

    /// The trail with the entry that joined it last first, the order Mission Control shows
    /// it in and adds live entries in.
    pub fn get_messages(&self) -> Vec<A2AMessage> {
        self.messages.lock().iter().rev().cloned().collect()
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
    async fn a_wait_that_times_out_leaves_its_message_working_with_a_note() {
        let router = A2ARouter::new();

        let request = A2ADispatchRequest {
            from_terminal: "term-agent-1".to_string(),
            to_terminal: "term-answerer".to_string(),
            prompt: "Say hello".to_string(),
            as_user: Some(true),
        };

        let outcome = router.dispatch_and_wait(request, None, 0).await.unwrap();
        let WaitOutcome::NoReply(answer) = outcome else {
            panic!("no turn ended, so no reply came: {outcome:?}");
        };
        assert!(answer.contains("is still working"), "{answer}");
        let messages = router.get_messages();
        assert_eq!(messages[0].status, A2AMessageStatus::Dispatched);
        assert_eq!(messages[0].response, None);
        assert_eq!(messages[0].note.as_deref(), Some("No reply within 0s"));
        assert!(router.pending_replies.lock().get("term-answerer").is_none());
    }

    #[tokio::test]
    async fn the_answer_to_a_timed_out_wait_fills_its_entry_in_when_the_turn_ends() {
        let router = A2ARouter::new();

        router.dispatch_and_wait(peer_message("term-late-a", "term-late-b"), None, 0).await.unwrap();
        let updated = answer_turn(&router, "term-late-b", "4").expect("the turn answers the message");

        assert_eq!(updated.status, A2AMessageStatus::Completed);
        assert_eq!(updated.response.as_deref(), Some("4"));
        // The note stays: the sender never saw this answer
        assert_eq!(updated.note.as_deref(), Some("No reply within 0s"));
    }

    #[tokio::test]
    async fn the_wait_clock_starts_at_the_call_not_after_the_message_is_typed() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-clock-asker", RunKind::Claude, ClaudeStatus::Idle),
            ("term-clock-idle", RunKind::Claude, ClaudeStatus::Idle),
        ]);

        let started = std::time::Instant::now();
        router
            .dispatch_and_wait(peer_message("term-clock-asker", "term-clock-idle"), Some(&pty), 1)
            .await
            .unwrap();

        // Typing takes the 250ms submit delay; a clock started after it would run to 1.25s
        let waited = started.elapsed();
        assert!(waited < Duration::from_millis(1150), "waited {waited:?}");
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

        let updated = answer_turn(&router, "term-b", "Result is 4");
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

    /// The project `test_terminal` puts a terminal in.
    const TEST_PROJECT: &str = "E:\\Projects\\Test";

    /// A broadcast from Mission Control to the project `test_terminal` uses.
    fn from_mission_control() -> BroadcastSender {
        BroadcastSender::User { project: TEST_PROJECT.to_string() }
    }

    #[test]
    fn test_a2a_broadcast_toast() {
        let router = A2ARouter::new();
        let pty_manager = PtyManager::new();

        let sent = router
            .broadcast_toast("Database migration complete", &from_mission_control(), &pty_manager)
            .unwrap();
        // PtyManager has 0 sessions initially
        assert_eq!(sent.notices.len(), 0);
        assert_eq!(sent.from_name, "You");
        assert_eq!(router.get_messages().len(), 0);
    }

    fn peer_in(id: &str, name: &str, project: &str, status: ClaudeStatus) -> TerminalInfo {
        let mut t = test_terminal(id, RunKind::Claude, status);
        t.name = name.to_string();
        t.project_path = project.to_string();
        t
    }

    fn manager_of(terminals: Vec<TerminalInfo>) -> PtyManager {
        let manager = PtyManager::new();
        for t in terminals {
            manager.insert_test_terminal(t);
        }
        manager
    }

    fn reached(sent: &Broadcast) -> Vec<String> {
        let mut ids: Vec<String> = sent.notices.iter().map(|m| m.to_terminal.clone()).collect();
        ids.sort();
        ids
    }

    const BC_APP: &str = "E:\\Projects\\BcApp";

    #[test]
    fn a_peers_broadcast_reaches_the_other_peers_in_its_project_only() {
        let router = A2ARouter::new();
        let pty = manager_of(vec![
            peer_in("term-bc-captain", "release-captain", BC_APP, ClaudeStatus::Idle),
            peer_in("term-bc-dev", "feature-dev", BC_APP, ClaudeStatus::Idle),
            // The same project, spelled the way another path source spells it
            peer_in("term-bc-docs", "docs-writer", "e:/projects/bcapp/", ClaudeStatus::Idle),
            peer_in("term-bc-elsewhere", "feature-dev", "E:\\Projects\\BcOther", ClaudeStatus::Idle),
            // A worktree counts as its own project, even one inside the repo folder
            peer_in("term-bc-worktree", "spike", "E:\\Projects\\BcApp\\.worktrees\\spike", ClaudeStatus::Idle),
            peer_in("term-bc-gone", "old-dev", BC_APP, ClaudeStatus::Exited),
        ]);

        let sent = router
            .broadcast_toast("FREEZE", &BroadcastSender::Peer("term-bc-captain".to_string()), &pty)
            .unwrap();

        assert_eq!(reached(&sent), ["term-bc-dev", "term-bc-docs"]);
        assert!(pty.test_input("term-bc-captain").is_empty(), "the caller never gets its own notice");
        assert!(pty.test_input("term-bc-elsewhere").is_empty());
        assert!(pty.test_input("term-bc-worktree").is_empty());
        assert_eq!(pty.test_input("term-bc-dev"), ["[Broadcast Notice]: FREEZE", "\r"]);
    }

    #[test]
    fn a_peers_broadcast_credits_the_sender_and_is_tagged_broadcast() {
        let router = A2ARouter::new();
        let pty = manager_of(vec![
            peer_in("term-bc-cap2", "release-captain", BC_APP, ClaudeStatus::Idle),
            peer_in("term-bc-dev2", "feature-dev", BC_APP, ClaudeStatus::Idle),
        ]);

        let sent = router
            .broadcast_toast("FREEZE", &BroadcastSender::Peer("term-bc-cap2".to_string()), &pty)
            .unwrap();

        assert_eq!(sent.from_name, "release-captain");
        let notice = &sent.notices[0];
        assert_eq!(notice.from_terminal, "term-bc-cap2");
        assert_eq!(notice.from_name.as_deref(), Some("release-captain"));
        assert_eq!(notice.to_name.as_deref(), Some("feature-dev"));
        assert!(notice.broadcast);
        assert!(!notice.as_user);
        let recorded = &router.get_messages()[0];
        assert_eq!(recorded.from_name.as_deref(), Some("release-captain"));
        assert!(recorded.broadcast);
    }

    #[test]
    fn a_broadcast_from_mission_control_reaches_the_active_projects_peers_and_credits_you() {
        let router = A2ARouter::new();
        let pty = manager_of(vec![
            peer_in("term-bc-mc-a", "planner-agent", BC_APP, ClaudeStatus::Idle),
            peer_in("term-bc-mc-b", "builder-agent", BC_APP, ClaudeStatus::Working),
            peer_in("term-bc-mc-other", "planner-agent", "E:\\Projects\\BcOther", ClaudeStatus::Idle),
        ]);

        let sent = router
            .broadcast_toast("Roll call", &BroadcastSender::User { project: BC_APP.to_string() }, &pty)
            .unwrap();

        assert_eq!(reached(&sent), ["term-bc-mc-a", "term-bc-mc-b"]);
        assert_eq!(sent.from_name, "You");
        assert!(sent.notices.iter().all(|m| m.from_terminal == "user"
            && m.from_name.as_deref() == Some("You")
            && m.broadcast));
        assert!(pty.test_input("term-bc-mc-other").is_empty());
    }

    #[test]
    fn a_message_sent_to_one_peer_is_not_tagged_broadcast() {
        let router = A2ARouter::new();
        let msg = router.dispatch(peer_message("term-bc-one", "term-bc-two"), None).unwrap();
        assert!(!msg.broadcast);
    }

    #[test]
    fn a_broadcast_from_a_terminal_quay_doesnt_know_is_refused() {
        let router = A2ARouter::new();
        let pty = manager_of(vec![peer_in("term-bc-known", "feature-dev", BC_APP, ClaudeStatus::Idle)]);

        let err = router
            .broadcast_toast("FREEZE", &BroadcastSender::Peer("term-bc-closed".to_string()), &pty)
            .unwrap_err();

        assert!(err.contains("term-bc-closed"), "{err}");
        assert!(pty.test_input("term-bc-known").is_empty());
        assert!(router.get_messages().is_empty());
    }

    #[test]
    fn a_broadcast_with_no_text_is_refused() {
        let router = A2ARouter::new();
        let pty = manager_of(vec![peer_in("term-bc-blank", "feature-dev", TEST_PROJECT, ClaudeStatus::Idle)]);

        let err = router.broadcast_toast(" \r\n ", &from_mission_control(), &pty).unwrap_err();

        assert!(err.contains("No broadcast text"), "{err}");
        assert!(pty.test_input("term-bc-blank").is_empty());
    }

    #[test]
    fn a_broadcast_from_mission_control_with_no_project_is_refused() {
        let router = A2ARouter::new();
        let pty = manager_of(vec![peer_in("term-bc-noproj", "feature-dev", TEST_PROJECT, ClaudeStatus::Idle)]);

        let err = router
            .broadcast_toast("Roll call", &BroadcastSender::User { project: "  ".to_string() }, &pty)
            .unwrap_err();

        assert!(err.contains("No active project"), "{err}");
        assert!(pty.test_input("term-bc-noproj").is_empty());
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
        // A listener shows Unknown, never Idle, so the done rule can't wait for Idle
        assert!(!answer.contains("Idle"), "{answer}");
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
        // The message waits out the start-up, then its own turn answers it
        end_turn(&router, &pty, "term-lvl-starting");
        answer_turn(&router, "term-lvl-starting", "4");

        let outcome = at_once(waiting).await.unwrap().unwrap();
        assert_eq!(outcome, WaitOutcome::Reply("4".to_string()));
    }

    #[tokio::test]
    async fn a_wait_on_a_queued_message_is_not_answered_by_the_turn_already_running() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-asker", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-midturn", RunKind::Claude, ClaudeStatus::Working),
        ]);

        let waiting = {
            let router = router.clone();
            let pty = pty.clone();
            tokio::spawn(async move {
                router
                    .dispatch_and_wait(peer_message("term-q-asker", "term-q-midturn"), Some(&pty), 60)
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;

        // The running turn ends: it answers something else, and lets the message in
        router.resolve_pending_reply("term-q-midturn", "an older answer".to_string());
        end_turn(&router, &pty, "term-q-midturn");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!waiting.is_finished(), "the running turn's answer isn't the reply");

        answer_turn(&router, "term-q-midturn", "4");

        let outcome = at_once(waiting).await.unwrap().unwrap();
        assert_eq!(outcome, WaitOutcome::Reply("4".to_string()));
    }

    #[tokio::test]
    async fn a_wait_that_times_out_while_queued_leaves_the_message_queued_and_says_so() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-asker2", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-longturn", RunKind::Claude, ClaudeStatus::Working),
        ]);

        let outcome = router
            .dispatch_and_wait(peer_message("term-q-asker2", "term-q-longturn"), Some(&pty), 0)
            .await
            .unwrap();

        let WaitOutcome::NoReply(answer) = outcome else {
            panic!("no reply can come from a queued message: {outcome:?}");
        };
        assert!(answer.contains("is queued behind its current turn"), "{answer}");
        assert!(answer.contains("will be delivered when that turn ends"), "{answer}");
        let messages = router.get_messages();
        assert_eq!(messages[0].status, A2AMessageStatus::Queued);
        assert_eq!(messages[0].note.as_deref(), Some("No reply within 0s"));
        assert!(router.pending_replies.lock().get("term-q-longturn").is_none());

        // Its turn still comes, and that turn's answer fills the entry in
        end_turn(&router, &pty, "term-q-longturn");
        let updated = answer_turn(&router, "term-q-longturn", "4").expect("the turn answers the message");
        assert_eq!(updated.status, A2AMessageStatus::Completed);
        assert_eq!(updated.response.as_deref(), Some("4"));
    }

    #[tokio::test]
    async fn a_wait_whose_message_cant_be_typed_fails_and_leaves_no_waiter() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-asker3", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-shut", RunKind::Claude, ClaudeStatus::Idle),
        ]);
        pty.close_test_input("term-q-shut");

        let result = router
            .dispatch_and_wait(peer_message("term-q-asker3", "term-q-shut"), Some(&pty), 60)
            .await;

        assert!(result.is_err());
        assert!(router.pending_replies.lock().get("term-q-shut").is_none());
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

    #[tokio::test]
    async fn a_message_to_an_unknown_target_is_refused_at_once_and_nothing_is_sent() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-tm-asker", RunKind::Claude, ClaudeStatus::Idle),
            ("term-tm-answerer", RunKind::Claude, ClaudeStatus::Idle),
        ]);

        let err = at_once(router.dispatch_and_wait(
            peer_message("term-tm-asker", "claude"),
            Some(&pty),
            60,
        ))
        .await
        .unwrap_err();
        assert!(err.contains("No terminal has the ID or session name 'claude'"), "{err}");
        assert!(err.contains("term-tm-answerer"), "the error lists the peers: {err}");
        let err = router
            .dispatch(peer_message("term-tm-asker", "term-tm-answ"), Some(&pty))
            .unwrap_err();
        assert!(err.contains("No terminal has the ID or session name"), "{err}");

        assert!(router.get_messages().is_empty());
        assert!(router.pending_replies.lock().is_empty());
    }

    #[test]
    fn a_message_to_a_session_name_goes_to_that_terminal() {
        let router = A2ARouter::new();
        let pty = manager_with(&[("term-tm-sender", RunKind::Claude, ClaudeStatus::Idle)]);
        let mut named = test_terminal("term-tm-named", RunKind::Claude, ClaudeStatus::Idle);
        named.name = "tm-answerer".to_string();
        pty.insert_test_terminal(named);

        let msg = router
            .dispatch(peer_message("term-tm-sender", "tm-answerer"), Some(&pty))
            .unwrap();
        assert_eq!(msg.to_terminal, "term-tm-named");
        assert_eq!(msg.to_name.as_deref(), Some("tm-answerer"));
    }

    #[test]
    fn a_message_to_your_own_session_name_is_refused() {
        let router = A2ARouter::new();
        let pty = PtyManager::new();
        let mut me = test_terminal("term-tm-me", RunKind::Claude, ClaudeStatus::Idle);
        me.name = "tm-me".to_string();
        pty.insert_test_terminal(me);

        let err = router
            .dispatch(peer_message("term-tm-me", "tm-me"), Some(&pty))
            .unwrap_err();
        assert!(err.contains("tm-me can't send a message to itself"), "{err}");
    }

    #[test]
    fn the_peer_prefix_is_stripped_from_a_task_title() {
        assert_eq!(strip_peer_prefix(&format!("{}Read package.json", peer_prefix("asker"))), "Read package.json");
        assert_eq!(strip_peer_prefix("[Peer agent (a (b))]: hi"), "hi");
        assert_eq!(strip_peer_prefix("Read package.json"), "Read package.json");
        assert_eq!(strip_peer_prefix("[Peer agent (cut off"), "[Peer agent (cut off");
        assert_eq!(strip_peer_prefix("[Broadcast Notice]: hi"), "[Broadcast Notice]: hi");
    }

    #[tokio::test]
    async fn a_message_to_an_exited_terminal_is_refused_at_once_and_nothing_is_sent() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-ex-asker", RunKind::Claude, ClaudeStatus::Idle),
            ("term-ex-gone", RunKind::Claude, ClaudeStatus::Exited),
        ]);

        let err = at_once(router.dispatch_and_wait(
            peer_message("term-ex-asker", "term-ex-gone"),
            Some(&pty),
            60,
        ))
        .await
        .unwrap_err();
        assert!(err.contains("term-ex-gone has exited"), "{err}");
        assert!(err.contains("relaunch"), "{err}");
        let err = router
            .dispatch(peer_message("term-ex-asker", "term-ex-gone"), Some(&pty))
            .unwrap_err();
        assert!(err.contains("has exited"), "{err}");
        let mut as_user = peer_message("term-ex-asker", "term-ex-gone");
        as_user.as_user = Some(true);
        assert!(router.dispatch(as_user, Some(&pty)).is_err());

        assert!(router.get_messages().is_empty());
        assert!(router.pending_replies.lock().get("term-ex-gone").is_none());
        assert_eq!(pty.get_info("term-ex-gone").unwrap().claude_status, ClaudeStatus::Exited);
    }

    #[tokio::test]
    async fn a_wait_already_running_when_its_terminal_exits_ends_then() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-ex-asker2", RunKind::Claude, ClaudeStatus::Idle),
            ("term-ex-exits", RunKind::Claude, ClaudeStatus::Idle),
        ]);

        let waiting = {
            let router = router.clone();
            let pty = pty.clone();
            tokio::spawn(async move {
                router
                    .dispatch_and_wait(
                        peer_message("term-ex-asker2", "term-ex-exits"),
                        Some(&pty),
                        60,
                    )
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!waiting.is_finished(), "a live Claude terminal is waited on");
        pty.update_status("term-ex-exits", ClaudeStatus::Exited);

        let outcome = at_once(waiting).await.unwrap().unwrap();
        let WaitOutcome::NoReply(answer) = outcome else {
            panic!("the wait ends once the terminal exits: {outcome:?}");
        };
        assert!(answer.contains("term-ex-exits exited before it replied"), "{answer}");
    }

    fn status_of(router: &A2ARouter, id: &str) -> A2AMessageStatus {
        router.get_messages().iter().find(|m| m.id == id).unwrap().status
    }

    /// Runs one whole turn on `id`, as the bridge does on its `turn.started` and
    /// `turn.completed`, with `answer` as what it ends with.
    fn answer_turn(router: &A2ARouter, id: &str, answer: &str) -> Option<A2AMessage> {
        router.turn_started(id);
        router.resolve_pending_reply(id, answer.to_string())
    }

    /// Ends the terminal's turn as the bridge does on `turn.completed`.
    fn end_turn(router: &A2ARouter, pty: &PtyManager, id: &str) {
        pty.update_status(id, ClaudeStatus::Idle);
        router.deliver_held(id, pty);
    }

    #[test]
    fn a_message_to_an_idle_claude_terminal_is_typed_at_once_with_its_enter() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender1", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-idle", RunKind::Claude, ClaudeStatus::Idle),
        ]);

        let msg = router.dispatch(peer_message("term-q-sender1", "term-q-idle"), Some(&pty)).unwrap();

        assert_eq!(msg.status, A2AMessageStatus::Dispatched);
        assert_eq!(
            pty.test_input("term-q-idle"),
            ["[Peer agent (term-q-sender1)]: What is 2+2?", "\r"]
        );
        assert_eq!(pty.get_info("term-q-idle").unwrap().claude_status, ClaudeStatus::Working);
    }

    #[test]
    fn a_message_to_a_claude_terminal_mid_turn_is_queued_until_the_turn_ends() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender2", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-busy", RunKind::Claude, ClaudeStatus::Working),
        ]);
        let updates = trail_events(&router);

        let msg = router.dispatch(peer_message("term-q-sender2", "term-q-busy"), Some(&pty)).unwrap();

        assert_eq!(msg.status, A2AMessageStatus::Queued);
        assert!(pty.test_input("term-q-busy").is_empty());

        end_turn(&router, &pty, "term-q-busy");

        assert_eq!(status_of(&router, &msg.id), A2AMessageStatus::Dispatched);
        assert_eq!(
            pty.test_input("term-q-busy"),
            ["[Peer agent (term-q-sender2)]: What is 2+2?", "\r"]
        );
        assert_eq!(pty.get_info("term-q-busy").unwrap().claude_status, ClaudeStatus::Working);
        assert_eq!(
            *updates.lock(),
            [
                (msg.id.clone(), A2AMessageStatus::Queued),
                (msg.id.clone(), A2AMessageStatus::Dispatched),
            ]
        );
    }

    #[test]
    fn held_messages_go_in_one_per_turn_end_in_the_order_they_came() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender3", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-lead", RunKind::Claude, ClaudeStatus::Working),
        ]);
        let mut sent = Vec::new();
        for report in ["DONE parser", "DONE renderer"] {
            let mut request = peer_message("term-q-sender3", "term-q-lead");
            request.prompt = report.to_string();
            sent.push(router.dispatch(request, Some(&pty)).unwrap());
        }

        end_turn(&router, &pty, "term-q-lead");

        assert_eq!(status_of(&router, &sent[0].id), A2AMessageStatus::Dispatched);
        assert_eq!(status_of(&router, &sent[1].id), A2AMessageStatus::Queued);
        assert_eq!(
            pty.test_input("term-q-lead"),
            ["[Peer agent (term-q-sender3)]: DONE parser", "\r"]
        );

        end_turn(&router, &pty, "term-q-lead");

        assert_eq!(status_of(&router, &sent[1].id), A2AMessageStatus::Dispatched);
        assert_eq!(pty.test_input("term-q-lead")[2], "[Peer agent (term-q-sender3)]: DONE renderer");
    }

    #[test]
    fn a_message_to_an_idle_terminal_with_messages_queued_waits_behind_them() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender4", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-behind", RunKind::Claude, ClaudeStatus::Working),
        ]);
        let first = router.dispatch(peer_message("term-q-sender4", "term-q-behind"), Some(&pty)).unwrap();
        // Idle, but the turn end that delivers `first` hasn't been handled yet
        pty.update_status("term-q-behind", ClaudeStatus::Idle);

        let second = router.dispatch(peer_message("term-q-sender4", "term-q-behind"), Some(&pty)).unwrap();

        assert_eq!(second.status, A2AMessageStatus::Queued);
        router.deliver_held("term-q-behind", &pty);
        assert_eq!(status_of(&router, &first.id), A2AMessageStatus::Dispatched);
        assert_eq!(status_of(&router, &second.id), A2AMessageStatus::Queued);
    }

    #[test]
    fn a_message_to_a_terminal_quay_sees_no_turn_end_for_is_typed_at_once() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender5", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-gemini", RunKind::Gemini, ClaudeStatus::Working),
            ("term-q-codex", RunKind::Codex, ClaudeStatus::Working),
            ("term-q-unknown", RunKind::Claude, ClaudeStatus::Unknown),
        ]);

        for target in ["term-q-gemini", "term-q-codex", "term-q-unknown"] {
            let msg = router.dispatch(peer_message("term-q-sender5", target), Some(&pty)).unwrap();
            assert_eq!(msg.status, A2AMessageStatus::Dispatched, "{target}");
            assert_eq!(pty.test_input(target).len(), 2, "{target}");
        }
    }

    #[test]
    fn a_message_that_cant_be_typed_fails_the_call_and_leaves_no_entry() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender6", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-closed", RunKind::Claude, ClaudeStatus::Idle),
        ]);
        pty.close_test_input("term-q-closed");

        assert!(router.dispatch(peer_message("term-q-sender6", "term-q-closed"), Some(&pty)).is_err());
        assert!(router.get_messages().is_empty());
        assert_eq!(pty.get_info("term-q-closed").unwrap().claude_status, ClaudeStatus::Idle);
    }

    #[test]
    fn held_messages_that_cant_be_typed_all_go_failed() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender7", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-gone", RunKind::Claude, ClaudeStatus::Working),
        ]);
        let sent: Vec<A2AMessage> = (0..2)
            .map(|_| router.dispatch(peer_message("term-q-sender7", "term-q-gone"), Some(&pty)).unwrap())
            .collect();
        pty.close_test_input("term-q-gone");

        end_turn(&router, &pty, "term-q-gone");

        for msg in &sent {
            let failed = router.get_messages().into_iter().find(|m| m.id == msg.id).unwrap();
            assert_eq!(failed.status, A2AMessageStatus::Failed);
            assert!(failed.response.unwrap().starts_with("Not delivered:"));
        }
        assert_eq!(pty.get_info("term-q-gone").unwrap().claude_status, ClaudeStatus::Idle);
    }

    #[test]
    fn held_messages_to_a_terminal_that_exited_go_failed_untyped() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender10", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-quit", RunKind::Claude, ClaudeStatus::Working),
        ]);
        let msg = router.dispatch(peer_message("term-q-sender10", "term-q-quit"), Some(&pty)).unwrap();

        pty.update_status("term-q-quit", ClaudeStatus::Exited);
        router.deliver_held("term-q-quit", &pty);

        assert_eq!(status_of(&router, &msg.id), A2AMessageStatus::Failed);
        assert!(pty.test_input("term-q-quit").is_empty());
    }

    #[test]
    fn a_message_to_a_terminal_still_taking_its_queue_goes_in_behind_it() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender11", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-dropped", RunKind::Claude, ClaudeStatus::Working),
        ]);
        let mut first = peer_message("term-q-sender11", "term-q-dropped");
        first.prompt = "DONE parser".to_string();
        router.dispatch(first, Some(&pty)).unwrap();
        // The terminal goes Unknown before the watcher has typed its queue in
        pty.update_status("term-q-dropped", ClaudeStatus::Unknown);

        let mut second = peer_message("term-q-sender11", "term-q-dropped");
        second.prompt = "DONE renderer".to_string();
        let msg = router.dispatch(second, Some(&pty)).unwrap();

        assert_eq!(msg.status, A2AMessageStatus::Dispatched);
        assert_eq!(
            pty.test_input("term-q-dropped"),
            [
                "[Peer agent (term-q-sender11)]: DONE parser",
                "\r",
                "[Peer agent (term-q-sender11)]: DONE renderer",
                "\r",
            ]
        );
    }

    #[test]
    fn held_messages_all_go_in_once_the_terminal_turns_unknown() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender8", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-silent", RunKind::Claude, ClaudeStatus::Starting),
        ]);
        let sent: Vec<A2AMessage> = (0..2)
            .map(|_| router.dispatch(peer_message("term-q-sender8", "term-q-silent"), Some(&pty)).unwrap())
            .collect();
        assert!(sent.iter().all(|m| m.status == A2AMessageStatus::Queued));

        pty.update_status("term-q-silent", ClaudeStatus::Unknown);
        router.deliver_held("term-q-silent", &pty);

        for msg in &sent {
            assert_eq!(status_of(&router, &msg.id), A2AMessageStatus::Dispatched);
        }
        assert_eq!(pty.test_input("term-q-silent").len(), 4);
    }

    #[test]
    fn a_turn_end_completes_the_delivered_entry_and_never_a_queued_one() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-sender9", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-answerer", RunKind::Claude, ClaudeStatus::Idle),
        ]);
        let delivered = router.dispatch(peer_message("term-q-sender9", "term-q-answerer"), Some(&pty)).unwrap();
        let queued = router.dispatch(peer_message("term-q-sender9", "term-q-answerer"), Some(&pty)).unwrap();
        assert_eq!(queued.status, A2AMessageStatus::Queued);

        let completed = answer_turn(&router, "term-q-answerer", "4").unwrap();

        assert_eq!(completed.id, delivered.id);
        assert_eq!(status_of(&router, &delivered.id), A2AMessageStatus::Completed);
        assert_eq!(status_of(&router, &queued.id), A2AMessageStatus::Queued);
    }

    #[test]
    fn a_broadcast_waits_for_a_busy_peer_and_reaches_an_idle_one_at_once() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-q-bc-idle", RunKind::Claude, ClaudeStatus::Idle),
            ("term-q-bc-busy", RunKind::Claude, ClaudeStatus::Working),
        ]);

        let notices: HashMap<String, A2AMessage> = router
            .broadcast_toast("Release is frozen", &from_mission_control(), &pty)
            .unwrap()
            .notices
            .into_iter()
            .map(|m| (m.to_terminal.clone(), m))
            .collect();

        assert_eq!(notices["term-q-bc-idle"].status, A2AMessageStatus::Dispatched);
        assert_eq!(
            pty.test_input("term-q-bc-idle"),
            ["[Broadcast Notice]: Release is frozen", "\r"]
        );
        assert_eq!(notices["term-q-bc-busy"].status, A2AMessageStatus::Queued);
        assert!(pty.test_input("term-q-bc-busy").is_empty());

        end_turn(&router, &pty, "term-q-bc-busy");

        assert_eq!(status_of(&router, &notices["term-q-bc-busy"].id), A2AMessageStatus::Dispatched);
        assert_eq!(
            pty.test_input("term-q-bc-busy"),
            ["[Broadcast Notice]: Release is frozen", "\r"]
        );
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
            .broadcast_toast("Release is frozen", &from_mission_control(), &pty)
            .unwrap()
            .notices
            .into_iter()
            .map(|m| m.to_terminal)
            .filter(|id| id.starts_with("term-lvl-bc-"))
            .collect();
        reached.sort();

        assert_eq!(reached, ["term-lvl-bc-claude", "term-lvl-bc-gemini"]);
    }

    #[tokio::test]
    async fn a_wait_is_not_answered_by_a_turn_running_when_its_message_arrived() {
        let router = A2ARouter::new();
        // Idle to Quay, so the message is typed at once, but a turn is already running
        let pty = manager_with(&[
            ("term-tp-asker", RunKind::Claude, ClaudeStatus::Idle),
            ("term-tp-running", RunKind::Claude, ClaudeStatus::Idle),
        ]);

        let waiting = {
            let router = router.clone();
            let pty = pty.clone();
            tokio::spawn(async move {
                router
                    .dispatch_and_wait(peer_message("term-tp-asker", "term-tp-running"), Some(&pty), 60)
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;

        // The running turn ends with no turn start after the message
        assert!(router.resolve_pending_reply("term-tp-running", "an older answer".to_string()).is_none());
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!waiting.is_finished(), "the running turn's answer isn't the reply");

        answer_turn(&router, "term-tp-running", "4");

        let outcome = at_once(waiting).await.unwrap().unwrap();
        assert_eq!(outcome, WaitOutcome::Reply("4".to_string()));
    }

    #[test]
    fn a_message_nobody_waits_on_is_completed_only_by_the_turn_it_starts() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-tp-sender", RunKind::Claude, ClaudeStatus::Idle),
            ("term-tp-target", RunKind::Claude, ClaudeStatus::Idle),
        ]);
        let msg = router.dispatch(peer_message("term-tp-sender", "term-tp-target"), Some(&pty)).unwrap();

        assert!(router.resolve_pending_reply("term-tp-target", "an older answer".to_string()).is_none());
        assert_eq!(status_of(&router, &msg.id), A2AMessageStatus::Dispatched);

        let completed = answer_turn(&router, "term-tp-target", "4").unwrap();
        assert_eq!(completed.id, msg.id);
        assert_eq!(completed.response.as_deref(), Some("4"));
    }

    #[test]
    fn a_turn_the_user_started_completes_no_message() {
        let router = A2ARouter::new();
        // Unknown, so a message is typed in even mid-turn
        let pty = manager_with(&[
            ("term-tp-sender2", RunKind::Claude, ClaudeStatus::Idle),
            ("term-tp-user", RunKind::Claude, ClaudeStatus::Unknown),
        ]);

        router.turn_started("term-tp-user");
        let msg = router.dispatch(peer_message("term-tp-sender2", "term-tp-user"), Some(&pty)).unwrap();
        assert!(router.resolve_pending_reply("term-tp-user", "the user's answer".to_string()).is_none());

        assert_eq!(answer_turn(&router, "term-tp-user", "4").unwrap().id, msg.id);
    }

    #[test]
    fn each_turn_completes_the_message_delivered_for_it_oldest_first() {
        let router = A2ARouter::new();
        // Unknown, so both messages are typed in at once
        let pty = manager_with(&[
            ("term-tp-sender3", RunKind::Claude, ClaudeStatus::Idle),
            ("term-tp-two", RunKind::Claude, ClaudeStatus::Unknown),
        ]);
        let first = router.dispatch(peer_message("term-tp-sender3", "term-tp-two"), Some(&pty)).unwrap();
        let second = router.dispatch(peer_message("term-tp-sender3", "term-tp-two"), Some(&pty)).unwrap();

        assert_eq!(answer_turn(&router, "term-tp-two", "first").unwrap().id, first.id);
        assert_eq!(status_of(&router, &second.id), A2AMessageStatus::Dispatched);
        assert_eq!(answer_turn(&router, "term-tp-two", "second").unwrap().id, second.id);
    }

    #[test]
    fn a_broadcast_notice_is_completed_by_the_turn_it_starts() {
        let router = A2ARouter::new();
        let pty = manager_with(&[("term-tp-bc", RunKind::Claude, ClaudeStatus::Idle)]);
        let notice = router
            .broadcast_toast("Release is frozen", &from_mission_control(), &pty)
            .unwrap()
            .notices
            .remove(0);

        assert!(router.resolve_pending_reply("term-tp-bc", "an older answer".to_string()).is_none());
        assert_eq!(answer_turn(&router, "term-tp-bc", "noted").unwrap().id, notice.id);
    }

    #[test]
    fn a_message_that_cant_be_typed_is_never_paired_with_a_turn() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-tp-sender4", RunKind::Claude, ClaudeStatus::Idle),
            ("term-tp-closed", RunKind::Claude, ClaudeStatus::Idle),
        ]);
        pty.close_test_input("term-tp-closed");
        assert!(router.dispatch(peer_message("term-tp-sender4", "term-tp-closed"), Some(&pty)).is_err());

        assert!(answer_turn(&router, "term-tp-closed", "4").is_none());
    }

    /// Records every trail change the router reports, as (id, status).
    fn trail_events(router: &A2ARouter) -> Arc<Mutex<Vec<(String, A2AMessageStatus)>>> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        router.set_trail_listener(move |m| seen.lock().push((m.id.clone(), m.status)));
        events
    }

    /// Waits up to a second for the trail listener to have heard `count` changes.
    async fn heard(events: &Mutex<Vec<(String, A2AMessageStatus)>>, count: usize) -> Vec<(String, A2AMessageStatus)> {
        at_once(async {
            loop {
                if events.lock().len() >= count {
                    return events.lock().clone();
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
    }

    #[test]
    fn a_message_typed_at_once_reaches_the_trail_listener_as_dispatched() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-ev-sender", RunKind::Claude, ClaudeStatus::Idle),
            ("term-ev-idle", RunKind::Claude, ClaudeStatus::Idle),
        ]);
        let events = trail_events(&router);

        let msg = router.dispatch(peer_message("term-ev-sender", "term-ev-idle"), Some(&pty)).unwrap();

        assert_eq!(*events.lock(), [(msg.id, A2AMessageStatus::Dispatched)]);
    }

    #[tokio::test]
    async fn a_waited_message_reaches_the_trail_listener_when_typed_in_not_when_answered() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-ev-asker", RunKind::Claude, ClaudeStatus::Idle),
            ("term-ev-answerer", RunKind::Claude, ClaudeStatus::Idle),
        ]);
        let events = trail_events(&router);

        let waiting = {
            let router = router.clone();
            let pty = pty.clone();
            tokio::spawn(async move {
                router
                    .dispatch_and_wait(peer_message("term-ev-asker", "term-ev-answerer"), Some(&pty), 60)
                    .await
            })
        };

        let delivered = heard(&events, 1).await;
        assert_eq!(delivered[0].1, A2AMessageStatus::Dispatched);
        assert!(!waiting.is_finished(), "the entry shows before the reply lands");

        answer_turn(&router, "term-ev-answerer", "4");
        assert_eq!(at_once(waiting).await.unwrap().unwrap(), WaitOutcome::Reply("4".to_string()));
        assert_eq!(
            *events.lock(),
            [
                (delivered[0].0.clone(), A2AMessageStatus::Dispatched),
                (delivered[0].0.clone(), A2AMessageStatus::Completed),
            ]
        );
    }

    #[tokio::test]
    async fn a_waited_message_held_behind_a_turn_reaches_the_trail_listener_as_queued_at_once() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-ev-asker2", RunKind::Claude, ClaudeStatus::Idle),
            ("term-ev-busy", RunKind::Claude, ClaudeStatus::Working),
        ]);
        let events = trail_events(&router);

        let waiting = {
            let router = router.clone();
            let pty = pty.clone();
            tokio::spawn(async move {
                router
                    .dispatch_and_wait(peer_message("term-ev-asker2", "term-ev-busy"), Some(&pty), 60)
                    .await
            })
        };

        let queued = heard(&events, 1).await;
        assert_eq!(queued[0].1, A2AMessageStatus::Queued);

        // The turn ends and the message is typed in: that is when its toast goes up
        end_turn(&router, &pty, "term-ev-busy");
        assert_eq!(heard(&events, 2).await[1], (queued[0].0.clone(), A2AMessageStatus::Dispatched));
        assert!(!waiting.is_finished(), "still waiting on the turn the message starts");
        waiting.abort();
    }

    #[tokio::test]
    async fn a_wait_on_a_listener_reaches_the_trail_listener_once() {
        let router = A2ARouter::new();
        let pty = manager_with(&[
            ("term-ev-asker3", RunKind::Claude, ClaudeStatus::Idle),
            ("term-ev-gemini", RunKind::Gemini, ClaudeStatus::Starting),
        ]);
        let events = trail_events(&router);

        at_once(router.dispatch_and_wait(peer_message("term-ev-asker3", "term-ev-gemini"), Some(&pty), 60))
            .await
            .unwrap();

        let events = events.lock();
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].1, A2AMessageStatus::Dispatched);
    }

    #[tokio::test]
    async fn a_wait_that_runs_out_reaches_the_trail_listener_with_its_note() {
        let router = A2ARouter::new();
        let notes = Arc::new(Mutex::new(Vec::new()));
        let seen = notes.clone();
        router.set_trail_listener(move |m| seen.lock().push(m.note.clone()));

        router.dispatch_and_wait(peer_message("term-ev-a", "term-ev-b"), None, 0).await.unwrap();

        assert_eq!(*notes.lock(), [None, Some("No reply within 0s".to_string())]);
    }

    #[test]
    fn a_broadcast_notice_that_cant_be_typed_reaches_the_trail_listener_as_failed() {
        let router = A2ARouter::new();
        let pty = manager_with(&[("term-ev-bc-shut", RunKind::Claude, ClaudeStatus::Idle)]);
        pty.close_test_input("term-ev-bc-shut");
        let events = trail_events(&router);

        let notice = router
            .broadcast_toast("Release is frozen", &from_mission_control(), &pty)
            .unwrap()
            .notices
            .remove(0);

        assert_eq!(notice.status, A2AMessageStatus::Failed);
        assert_eq!(*events.lock(), [(notice.id, A2AMessageStatus::Failed)]);
    }

    #[test]
    fn the_trail_lists_the_newest_message_first() {
        let router = A2ARouter::new();
        let sent: Vec<String> = (0..3)
            .map(|_| router.dispatch(peer_message("term-ord-a", "term-ord-b"), None).unwrap().id)
            .collect();

        let listed: Vec<String> = router.get_messages().into_iter().map(|m| m.id).collect();

        assert_eq!(listed, [sent[2].clone(), sent[1].clone(), sent[0].clone()]);
    }
}
