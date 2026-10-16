use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum A2AMessageStatus {
    Pending,
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
