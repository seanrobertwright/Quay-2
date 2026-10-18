use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunKind {
    Claude,
    Antigravity,
    Codex,
    Pi,
    Gemini,
    Grok,
    Aider,
    Kiro,
    Copilot,
    #[serde(rename = "opencode")]
    OpenCode,
    PowerShell,
    Command,
    Archon,
}

impl RunKind {
    pub fn is_agent(&self) -> bool {
        matches!(
            self,
            RunKind::Claude
                | RunKind::Antigravity
                | RunKind::Codex
                | RunKind::Pi
                | RunKind::Gemini
                | RunKind::Grok
                | RunKind::Aider
                | RunKind::Kiro
                | RunKind::Copilot
                | RunKind::OpenCode
                | RunKind::Archon
        )
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            RunKind::Claude => "claude",
            RunKind::Antigravity => "antigravity",
            RunKind::Codex => "codex",
            RunKind::Pi => "pi",
            RunKind::Gemini => "gemini",
            RunKind::Grok => "grok",
            RunKind::Aider => "aider",
            RunKind::Kiro => "kiro",
            RunKind::Copilot => "copilot",
            RunKind::OpenCode => "opencode",
            RunKind::PowerShell => "powershell",
            RunKind::Command => "command",
            RunKind::Archon => "archon",
        }
    }
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
    #[serde(default)]
    pub task_title: Option<String>,
    #[serde(default)]
    pub current_tool: Option<String>,
    #[serde(default)]
    pub custom_name: bool,
    /// Extra CLI flags the terminal was launched with (model, resume, ...); reused on relaunch.
    #[serde(default)]
    pub custom_flags: Option<String>,
    /// Command line for `Command` terminals; reused on relaunch.
    #[serde(default)]
    pub command_text: Option<String>,
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
    #[serde(default)]
    pub env_vars: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub custom_flags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutputPayload {
    pub terminal_id: String,
    pub data: String,
    pub last_seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedTerminalSession {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub run_kind: RunKind,
    pub permission_mode: PermissionMode,
    #[serde(default)]
    pub task_title: Option<String>,
    #[serde(default)]
    pub custom_name: bool,
    #[serde(default)]
    pub auto_approved_count: u32,
    #[serde(default)]
    pub command_text: Option<String>,
    #[serde(default)]
    pub custom_flags: Option<String>,
    #[serde(default)]
    pub last_updated: u64,
}
