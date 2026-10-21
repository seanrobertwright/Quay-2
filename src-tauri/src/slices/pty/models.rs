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

    /// Whether Quay sees a turn of this CLI end, so it can show the terminal Working when a
    /// message reaches it and Idle again after. Claude's event-bridge plugin reports a turn
    /// end, and so does Codex's turn-end helper, which Codex runs through its `notify`
    /// setting. The frontend's `TURN_END_RUN_KINDS` mirrors this.
    pub fn reports_turn_end(&self) -> bool {
        matches!(self, RunKind::Claude | RunKind::Codex)
    }

    /// Whether Quay hears a turn of this CLI start. Codex's turn-end helper runs only once a
    /// turn has ended, so `A2ARouter::turn_completed` pairs a Codex turn with its message then.
    pub fn reports_turn_start(&self) -> bool {
        matches!(self, RunKind::Claude)
    }

    /// The status a Starting terminal of this CLI moves to when its pane first prints, or
    /// `None` when its first output leaves the status alone. A Claude terminal waits for its
    /// event-bridge plugin instead; see `PluginWatch`. A listener shows Unknown, because Quay
    /// can't read whether it is working. Any other agent shows Idle.
    pub fn status_after_first_output(&self) -> Option<ClaudeStatus> {
        match self {
            RunKind::Claude => None,
            _ if self.bus_level() == Some(BusLevel::Listener) => Some(ClaudeStatus::Unknown),
            _ if self.is_agent() => Some(ClaudeStatus::Idle),
            _ => None,
        }
    }

    /// Whether this CLI never asks before a tool call, so Quay's Skip and Ask choice means
    /// nothing for it. Pi is one: its `--approve` trusts project-local files rather than
    /// skipping approvals, so Quay never passes it. The frontend's `NEVER_ASKS_RUN_KINDS`
    /// mirrors this.
    pub fn never_asks_before_tools(&self) -> bool {
        matches!(self, RunKind::Pi)
    }

    /// The permission mode a terminal of this CLI runs in: the one asked for, or Skip when
    /// none was asked for or the CLI never asks before a tool call.
    pub fn permission_mode(&self, requested: Option<PermissionMode>) -> PermissionMode {
        match requested {
            Some(mode) if !self.never_asks_before_tools() => mode,
            _ => PermissionMode::Skip,
        }
    }

    /// Whether Quay injects its MCP server (and so the `quay_*` tools) into this CLI.
    /// The spawn and the team briefing both read this, so they cannot disagree.
    pub fn gets_quay_mcp(&self) -> bool {
        matches!(self, RunKind::Claude | RunKind::Codex)
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

impl ClaudeStatus {
    /// The status as serde writes it, as `quay_list_agents` and `quay_get_agent_status` print it.
    pub fn as_str(&self) -> &'static str {
        match self {
            ClaudeStatus::Starting => "starting",
            ClaudeStatus::Working => "working",
            ClaudeStatus::Waiting => "waiting",
            ClaudeStatus::Idle => "idle",
            ClaudeStatus::Exited => "exited",
            ClaudeStatus::Unknown => "unknown",
        }
    }
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

    /// Whether a message reaching this terminal shows it Working: only when Quay will also
    /// see that turn end and show it Idle again. A Claude terminal shown as Unknown doesn't,
    /// because Quay hasn't heard from its event-bridge plugin.
    pub fn shows_working_on_delivery(&self) -> bool {
        self.run_kind.reports_turn_end() && self.claude_status != ClaudeStatus::Unknown
    }

    /// Whether a message to this terminal waits in its queue: Quay will see its turn end
    /// (`shows_working_on_delivery`), and it is starting up, in a turn, or waiting on a
    /// permission prompt.
    pub fn holds_deliveries(&self) -> bool {
        self.shows_working_on_delivery()
            && matches!(
                self.claude_status,
                ClaudeStatus::Starting | ClaudeStatus::Working | ClaudeStatus::Waiting
            )
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

/// Every run kind, for tests that check a rule across all of them.
#[cfg(test)]
pub const ALL_RUN_KINDS: [RunKind; 13] = [
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn claude_status_as_str_is_its_serde_form() {
        for status in [
            ClaudeStatus::Starting,
            ClaudeStatus::Working,
            ClaudeStatus::Waiting,
            ClaudeStatus::Idle,
            ClaudeStatus::Exited,
            ClaudeStatus::Unknown,
        ] {
            assert_eq!(serde_json::to_value(&status).unwrap(), status.as_str());
        }
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

    #[test]
    fn only_claude_and_codex_report_a_turn_end() {
        let kinds: Vec<RunKind> = ALL_RUN_KINDS
            .into_iter()
            .filter(|kind| kind.reports_turn_end())
            .collect();
        assert_eq!(kinds, [RunKind::Claude, RunKind::Codex]);
    }

    #[test]
    fn only_claude_reports_a_turn_start() {
        let kinds: Vec<RunKind> = ALL_RUN_KINDS
            .into_iter()
            .filter(|kind| kind.reports_turn_start())
            .collect();
        assert_eq!(kinds, [RunKind::Claude]);
    }

    #[test]
    fn only_claude_and_codex_get_the_quay_mcp_server() {
        let kinds: Vec<RunKind> = ALL_RUN_KINDS
            .into_iter()
            .filter(|kind| kind.gets_quay_mcp())
            .collect();
        assert_eq!(kinds, [RunKind::Claude, RunKind::Codex]);
    }

    #[test]
    fn a_terminal_shows_working_on_delivery_only_when_quay_will_see_the_turn_end() {
        assert!(terminal(RunKind::Claude, ClaudeStatus::Idle).shows_working_on_delivery());
        assert!(!terminal(RunKind::Claude, ClaudeStatus::Unknown).shows_working_on_delivery());
        assert!(terminal(RunKind::Codex, ClaudeStatus::Idle).shows_working_on_delivery());
        assert!(!terminal(RunKind::OpenCode, ClaudeStatus::Idle).shows_working_on_delivery());
        assert!(!terminal(RunKind::Gemini, ClaudeStatus::Unknown).shows_working_on_delivery());
    }

    #[test]
    fn first_output_leaves_claude_to_its_plugin_and_shows_listeners_unknown() {
        assert_eq!(RunKind::Claude.status_after_first_output(), None);
        for kind in [RunKind::Codex, RunKind::OpenCode, RunKind::Antigravity, RunKind::Archon] {
            assert_eq!(kind.status_after_first_output(), Some(ClaudeStatus::Idle), "{:?}", kind);
        }
        for kind in kinds_at(Some(BusLevel::Listener)) {
            assert_eq!(kind.status_after_first_output(), Some(ClaudeStatus::Unknown), "{:?}", kind);
        }
        for kind in [RunKind::PowerShell, RunKind::Command] {
            assert_eq!(kind.status_after_first_output(), None, "{:?}", kind);
        }
    }

    #[test]
    fn turn_end_run_kinds_match_the_frontend() {
        let backend: Vec<String> = ALL_RUN_KINDS
            .iter()
            .filter(|kind| kind.reports_turn_end())
            .map(|kind| kind.as_str().to_string())
            .collect();
        assert_eq!(frontend_run_kinds("TURN_END_RUN_KINDS"), backend);
    }

    #[test]
    fn a_cli_that_never_asks_runs_as_skip_whatever_was_asked() {
        for requested in [None, Some(PermissionMode::Skip), Some(PermissionMode::Normal)] {
            assert_eq!(RunKind::Pi.permission_mode(requested), PermissionMode::Skip, "{:?}", requested);
        }
        assert_eq!(RunKind::Claude.permission_mode(Some(PermissionMode::Normal)), PermissionMode::Normal);
        assert_eq!(RunKind::Claude.permission_mode(None), PermissionMode::Skip);
    }

    #[test]
    fn never_asks_run_kinds_match_the_frontend() {
        let backend: Vec<String> = ALL_RUN_KINDS
            .iter()
            .filter(|kind| kind.never_asks_before_tools())
            .map(|kind| kind.as_str().to_string())
            .collect();
        assert_eq!(backend, ["pi"]);
        assert_eq!(frontend_run_kinds("NEVER_ASKS_RUN_KINDS"), backend);
    }

    #[test]
    fn only_a_reporting_claude_or_a_codex_terminal_mid_turn_holds_deliveries() {
        for kind in [RunKind::Claude, RunKind::Codex] {
            for status in [ClaudeStatus::Starting, ClaudeStatus::Working, ClaudeStatus::Waiting] {
                assert!(terminal(kind, status.clone()).holds_deliveries(), "{:?} {:?}", kind, status);
            }
            for status in [ClaudeStatus::Idle, ClaudeStatus::Exited, ClaudeStatus::Unknown] {
                assert!(!terminal(kind, status.clone()).holds_deliveries(), "{:?} {:?}", kind, status);
            }
        }
        for kind in ALL_RUN_KINDS
            .into_iter()
            .filter(|kind| !matches!(kind, RunKind::Claude | RunKind::Codex))
        {
            assert!(!terminal(kind, ClaudeStatus::Working).holds_deliveries(), "{:?}", kind);
        }
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
