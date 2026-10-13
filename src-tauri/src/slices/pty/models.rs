use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunKind {
    Claude,
    PowerShell,
    Command,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionMode {
    Skip,
    Normal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClaudeStatus {
    Starting,
    Working,
    Waiting,
    Idle,
    Exited,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub run_kind: RunKind,
    pub permission_mode: PermissionMode,
    pub live_mode: PermissionMode,
    pub claude_status: ClaudeStatus,
    pub auto_approved_count: u32,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpawnTerminalRequest {
    pub id: Option<String>,
    pub name: Option<String>,
    pub project_path: String,
    pub run_kind: RunKind,
    pub permission_mode: Option<PermissionMode>,
    pub command_text: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}
