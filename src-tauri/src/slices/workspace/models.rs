use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub path: String,
    pub name: String,
    pub terminal_ids: Vec<String>,
    pub last_viewed_terminal: Option<String>,
    #[serde(default)]
    pub env_vars: HashMap<String, String>,
    #[serde(default)]
    pub default_flags: Option<String>,
}

/// How a project's stage was last laid out: the layout, which terminal each pane shows, the
/// split ratio, zoom, the focused pane and the selected terminal. Saved per project path
/// (worktrees included) so switching projects or restarting Quay puts the stage back. The
/// frontend owns the meaning of these values and checks them on restore; every field has a
/// default so a partial or older record still loads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProjectView {
    pub layout: String,
    pub primary_terminal_id: Option<String>,
    pub secondary_terminal_id: Option<String>,
    pub grid_terminal_ids: Vec<Option<String>>,
    pub split_ratio: f64,
    pub zoomed_from_layout: Option<String>,
    pub focused_pane: String,
    pub active_terminal_id: Option<String>,
}

impl Default for ProjectView {
    fn default() -> Self {
        Self {
            layout: "single".to_string(),
            primary_terminal_id: None,
            secondary_terminal_id: None,
            grid_terminal_ids: vec![None; 4],
            split_ratio: 50.0,
            zoomed_from_layout: None,
            focused_pane: "primary".to_string(),
            active_terminal_id: None,
        }
    }
}
