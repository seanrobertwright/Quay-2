use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub path: String,
    pub name: String,
    pub terminal_ids: Vec<String>,
    pub last_viewed_terminal: Option<String>,
}
