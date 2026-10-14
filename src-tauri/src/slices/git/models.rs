use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitWorktree {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub is_main: bool,
    pub is_bare: bool,
    pub is_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorktreeRequest {
    pub repo_path: String,
    pub branch: String,
    pub new_branch: bool,
    pub base_branch: Option<String>,
    pub custom_path: Option<String>,
}
