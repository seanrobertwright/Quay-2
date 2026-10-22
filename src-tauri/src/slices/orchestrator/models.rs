use serde::{Deserialize, Serialize};

use crate::dates::now_ms;

/// Now, in the epoch milliseconds the trail's times are kept in.
pub fn trail_now() -> u64 {
    now_ms().max(0) as u64
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum A2AMessageStatus {
    /// Waiting in its target's delivery queue for the target's turn to end.
    Queued,
    /// Typed into its target.
    Dispatched,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AMessage {
    pub id: String,
    pub from_terminal: String,
    pub to_terminal: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_name: Option<String>,
    pub content: String,
    pub as_user: bool,
    /// Whether this is one peer's notice from a broadcast, rather than a message sent to it.
    #[serde(default)]
    pub broadcast: bool,
    /// Whether someone waited on this message's reply, so the trail labels the peer's
    /// response a Reply rather than an Answer: a `wait_for_reply` send, or Mission Control's
    /// dispatch, which the operator waits on in the trail. A wait on a peer that can't reply,
    /// a no-wait send and a broadcast notice are not waited on, and a wait that ends without
    /// the reply (it ran out, or the peer stopped being able to reply) is no longer waited on.
    #[serde(default)]
    pub waited: bool,
    /// When the message was sent, in epoch milliseconds.
    pub timestamp: u64,
    /// When the message was typed into its target, in epoch milliseconds. None while it is
    /// Queued, and for a message that failed before it was typed in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered_at: Option<u64>,
    /// When the turn that answers the message ended, in epoch milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
    pub status: A2AMessageStatus,
    pub response: Option<String>,
    /// What the trail shows beside the status, such as a wait that ended without a reply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl A2AMessage {
    /// Moves the entry to Dispatched, typed into its target now.
    pub fn mark_dispatched(&mut self) {
        self.status = A2AMessageStatus::Dispatched;
        self.delivered_at = Some(trail_now());
    }

    /// Completes the entry with `answer`, from the turn that ended now.
    pub fn mark_completed(&mut self, answer: String) {
        self.status = A2AMessageStatus::Completed;
        self.completed_at = Some(trail_now());
        self.response = Some(answer);
    }
}

/// Who sends a broadcast, which decides the peers it reaches.
#[derive(Debug, Clone)]
pub enum BroadcastSender {
    /// A peer's `quay_broadcast`, by terminal id: it reaches the other peers in its project.
    Peer(String),
    /// Mission Control's Broadcast box, with the active project: it reaches that project's peers.
    User { project: String },
}

/// A broadcast's notices, one per peer it reached, and the name its toast credits.
#[derive(Debug, Clone)]
pub struct Broadcast {
    pub from_name: String,
    pub notices: Vec<A2AMessage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct A2ADispatchRequest {
    pub from_terminal: String,
    pub to_terminal: String,
    pub prompt: String,
    pub as_user: Option<bool>,
}

impl A2ADispatchRequest {
    /// Whether the message comes from the operator rather than a sending peer.
    pub fn is_user_dispatch(&self) -> bool {
        self.as_user.unwrap_or(false)
    }
}
