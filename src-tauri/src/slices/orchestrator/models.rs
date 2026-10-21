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
    pub timestamp: u64,
    pub status: A2AMessageStatus,
    pub response: Option<String>,
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
