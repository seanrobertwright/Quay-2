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

    /// This CLI's level on the A2A bus, or `None` when its terminal is not a peer: a shell,
    /// a command, or Archon, which runs a workflow and has no prompt for a message to land
    /// in. Kept apart from `is_agent`, which also drives Machina's supervisor and terminal
    /// status. A terminal's level can drop below its CLI's; see `TerminalInfo::bus_level`.
    pub fn bus_level(&self) -> Option<BusLevel> {
        match self {
            RunKind::Claude | RunKind::Codex | RunKind::OpenCode => Some(BusLevel::FullPeer),
            RunKind::Antigravity => Some(BusLevel::Responder),
            RunKind::Copilot
            | RunKind::Kiro
            | RunKind::Gemini
            | RunKind::Grok
            | RunKind::Pi
            | RunKind::Aider => Some(BusLevel::Listener),
            RunKind::PowerShell | RunKind::Command | RunKind::Archon => None,
        }
    }

    /// Whether a terminal of this CLI is a peer on the A2A bus, at any level.
    pub fn is_peer(&self) -> bool {
        self.bus_level().is_some()
    }

    /// Whether Quay injects its MCP server (and so the `quay_*` tools) into this CLI.
    /// The spawn and the team briefing both read this, so they cannot disagree.
    pub fn gets_quay_mcp(&self) -> bool {
        matches!(self, RunKind::Claude)
    }

    /// How this CLI takes a launch prompt on its command line, or `None` when it takes none.
    pub fn launch_prompt_form(&self) -> Option<LaunchPromptForm> {
        match self {
            RunKind::Claude | RunKind::Codex | RunKind::Pi | RunKind::Kiro => {
                Some(LaunchPromptForm::Positional)
            }
            RunKind::OpenCode => Some(LaunchPromptForm::Flag("--prompt")),
            RunKind::Gemini | RunKind::Copilot => Some(LaunchPromptForm::Flag("-i")),
            RunKind::Antigravity
            | RunKind::Grok
            | RunKind::Aider
            | RunKind::PowerShell
            | RunKind::Command
            | RunKind::Archon => None,
        }
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

    /// The CLI's name as a person reads it, as in a team briefing.
    pub fn display_name(&self) -> &'static str {
        match self {
            RunKind::Claude => "Claude",
            RunKind::Antigravity => "Antigravity",
            RunKind::Codex => "Codex",
            RunKind::Pi => "Pi",
            RunKind::Gemini => "Gemini",
            RunKind::Grok => "Grok",
            RunKind::Aider => "Aider",
            RunKind::Kiro => "Kiro",
            RunKind::Copilot => "Copilot",
            RunKind::OpenCode => "OpenCode",
            RunKind::PowerShell => "PowerShell",
            RunKind::Command => "Command",
            RunKind::Archon => "Archon",
        }
    }
}

/// How far a peer takes part in the A2A bus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BusLevel {
    /// Sends messages, answers a waiting sender and shows whether it is working.
    FullPeer,
    /// Answers a waiting sender and shows whether it is working, but has no `quay_*`
    /// tools, so it can't start a conversation.
    Responder,
    /// Gets messages but can't answer them.
    Listener,
}

impl BusLevel {
    /// The level as `quay_list_agents` and the team briefing name it.
    pub fn as_str(&self) -> &'static str {
        match self {
            BusLevel::FullPeer => "full peer",
            BusLevel::Responder => "responder",
            BusLevel::Listener => "listener",
        }
    }
}

/// Where a CLI's launch prompt goes on its command line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchPromptForm {
    /// The prompt is a bare positional argument.
    Positional,
    /// The prompt follows this flag.
    Flag(&'static str),
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
    #[serde(default)]
    pub created_at: u64,
    /// Whether the pane shows the plugin hint: this launch's silence clock ran out
    /// before any event from the event-bridge plugin arrived.
    #[serde(default)]
    pub plugin_hint: bool,
}

impl TerminalInfo {
    /// The terminal's level on the A2A bus now, or `None` when it is not a peer. It is its
    /// CLI's level, except that a Claude terminal shown as Unknown is a listener: Quay
    /// hasn't heard from its event-bridge plugin, so it can't see the turn end.
    pub fn bus_level(&self) -> Option<BusLevel> {
        if self.plugin_silent() {
            return Some(BusLevel::Listener);
        }
        self.run_kind.bus_level()
    }

    /// Whether this is a Claude terminal that counts as a listener only because Quay
    /// hasn't heard from its event-bridge plugin.
    pub fn plugin_silent(&self) -> bool {
        self.run_kind == RunKind::Claude && self.claude_status == ClaudeStatus::Unknown
    }
}

/// A terminal's status after Quay's plugin rules moved it, sent as `terminal-status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalStatusPayload {
    pub terminal_id: String,
    pub claude_status: ClaudeStatus,
    pub plugin_hint: bool,
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
    /// The launch prompt, passed to the CLI as one argument and never stored, so a
    /// relaunch does not resend it.
    #[serde(default)]
    pub initial_prompt: Option<String>,
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
    #[serde(default)]
    pub created_at: u64,
}

/// A running terminal named after its id, for tests that need one without a PTY.
#[cfg(test)]
pub fn test_terminal(id: &str, run_kind: RunKind, claude_status: ClaudeStatus) -> TerminalInfo {
    TerminalInfo {
        id: id.to_string(),
        name: id.to_string(),
        project_path: "E:\\Projects\\Test".to_string(),
        run_kind,
        permission_mode: PermissionMode::Skip,
        live_mode: PermissionMode::Skip,
        claude_status,
        auto_approved_count: 0,
        exit_code: None,
        task_title: None,
        current_tool: None,
        custom_name: false,
        custom_flags: None,
        command_text: None,
        created_at: 0,
        plugin_hint: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_RUN_KINDS: [RunKind; 13] = [
        RunKind::Claude,
        RunKind::Antigravity,
        RunKind::Codex,
        RunKind::Pi,
        RunKind::Gemini,
        RunKind::Grok,
        RunKind::Aider,
        RunKind::Kiro,
        RunKind::Copilot,
        RunKind::OpenCode,
        RunKind::PowerShell,
        RunKind::Command,
        RunKind::Archon,
    ];

    fn terminal(run_kind: RunKind, claude_status: ClaudeStatus) -> TerminalInfo {
        test_terminal("term-level", run_kind, claude_status)
    }

    fn kinds_at(level: Option<BusLevel>) -> Vec<RunKind> {
        ALL_RUN_KINDS
            .into_iter()
            .filter(|kind| kind.bus_level() == level)
            .collect()
    }

    #[test]
    fn claude_codex_and_opencode_are_full_peers() {
        assert_eq!(
            kinds_at(Some(BusLevel::FullPeer)),
            [RunKind::Claude, RunKind::Codex, RunKind::OpenCode]
        );
    }

    #[test]
    fn antigravity_is_the_only_responder() {
        assert_eq!(kinds_at(Some(BusLevel::Responder)), [RunKind::Antigravity]);
    }

    #[test]
    fn copilot_kiro_gemini_grok_pi_and_aider_are_listeners() {
        assert_eq!(
            kinds_at(Some(BusLevel::Listener)),
            [
                RunKind::Pi,
                RunKind::Gemini,
                RunKind::Grok,
                RunKind::Aider,
                RunKind::Kiro,
                RunKind::Copilot,
            ]
        );
    }

    #[test]
    fn shells_and_archon_are_not_peers_though_archon_is_an_agent() {
        assert_eq!(
            kinds_at(None),
            [RunKind::PowerShell, RunKind::Command, RunKind::Archon]
        );
        assert!(RunKind::Archon.is_agent());
        assert!(!RunKind::Archon.is_peer());
    }

    #[test]
    fn listeners_get_no_quay_mcp_server() {
        for kind in kinds_at(Some(BusLevel::Listener)) {
            assert!(!kind.gets_quay_mcp(), "{:?} is a listener", kind);
        }
    }

    #[test]
    fn an_unknown_claude_terminal_is_a_listener_and_any_other_status_a_full_peer() {
        assert_eq!(
            terminal(RunKind::Claude, ClaudeStatus::Unknown).bus_level(),
            Some(BusLevel::Listener)
        );
        for status in [
            ClaudeStatus::Starting,
            ClaudeStatus::Working,
            ClaudeStatus::Waiting,
            ClaudeStatus::Idle,
            ClaudeStatus::Exited,
        ] {
            assert_eq!(
                terminal(RunKind::Claude, status.clone()).bus_level(),
                Some(BusLevel::FullPeer),
                "{:?}",
                status
            );
        }
    }

    #[test]
    fn only_claude_falls_to_listener_when_unknown() {
        assert_eq!(
            terminal(RunKind::Codex, ClaudeStatus::Unknown).bus_level(),
            Some(BusLevel::FullPeer)
        );
        assert_eq!(terminal(RunKind::PowerShell, ClaudeStatus::Unknown).bus_level(), None);
        assert!(!terminal(RunKind::Codex, ClaudeStatus::Unknown).plugin_silent());
    }

    /// The run kinds the frontend's `const_name` list holds, read from `types.ts`.
    fn frontend_run_kinds(const_name: &str) -> Vec<String> {
        let source_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/slices/terminal/types.ts");
        let source = std::fs::read_to_string(&source_path).unwrap();
        let prefix = format!("export const {} = [", const_name);
        source
            .lines()
            .find_map(|line| line.trim().strip_prefix(prefix.as_str()))
            .unwrap_or_else(|| panic!("types.ts declares {} on one line", const_name))
            .split(']')
            .next()
            .unwrap()
            .split(',')
            .map(|item| item.trim().trim_matches('"').to_string())
            .filter(|item| !item.is_empty())
            .collect()
    }

    #[test]
    fn bus_levels_match_the_frontend() {
        for (const_name, level) in [
            ("FULL_PEER_RUN_KINDS", BusLevel::FullPeer),
            ("RESPONDER_RUN_KINDS", BusLevel::Responder),
            ("LISTENER_RUN_KINDS", BusLevel::Listener),
        ] {
            let backend: Vec<String> = kinds_at(Some(level))
                .iter()
                .map(|kind| kind.as_str().to_string())
                .collect();
            assert_eq!(frontend_run_kinds(const_name), backend, "{}", const_name);
        }
    }
}
