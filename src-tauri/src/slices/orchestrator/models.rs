use serde::{Deserialize, Serialize};

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
    pub timestamp: u64,
    pub status: A2AMessageStatus,
    pub response: Option<String>,
    /// What the trail shows beside the status, such as a wait that ended without a reply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
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
