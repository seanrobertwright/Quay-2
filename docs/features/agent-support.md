# Supported Agent CLIs

Quay 2 is designed as a universal desktop cockpit for all major autonomous AI coding agents, shells, and command environments.

---

## Agent Compatibility Matrix

| Agent / Shell | Binary Command | Model Selection Support | A2A MCP Bus Integration | Telemetry & Turn Status |
| :--- | :--- | :---: | :---: | :---: |
| **Claude Code** | `claude.cmd` / `claude` | ✅ Full (Opus 5.5, Sonnet 5.5, Haiku 5.5) | ✅ Automatic via `--mcp-config` | ✅ Full turn/tool lifecycle |
| **Antigravity CLI** | `agy.cmd` / `agy` | ✅ Inherited from active tier | ✅ Supported | ✅ Tool execution tracking |
| **OpenAI Codex CLI** | `codex.exe` | ✅ GPT-4o / o1 / o3-mini | ✅ Automatic via `-c` overrides | ✅ Turn end, through Quay's `notify` helper |
| **Pi Coding Agent** | `pi` | ✅ Pi multi-model | ✅ Custom MCP adapter | ✅ Console output streaming |
| **Google Gemini CLI** | `gemini` | ✅ Gemini 2.5 / 2.0 Pro | ✅ Custom MCP adapter | ✅ Console output streaming |
| **xAI Grok CLI** | `grok` | ✅ Grok Code | ✅ Custom MCP adapter | ✅ Console output streaming |
| **Aider** | `aider` | ✅ Any LLM via LiteLLM | ✅ Via MCP server extension | ✅ Git commit tracking |
| **Kiro CLI** | `kiro` | ✅ Multi-model | ✅ Standard stdio | ✅ Console output streaming |
| **OpenCode** | `opencode` | ✅ Multi-provider | ✅ Automatic via `OPENCODE_CONFIG_CONTENT` | ✅ Turn start and end from its own server |
| **GitHub Copilot CLI** | `gh copilot` | ✅ OpenAI Copilot models | N/A | ✅ Interactive terminal |
| **PowerShell** | `pwsh.exe` | N/A | N/A | ✅ ConPTY ANSI streaming |
| **Command Prompt** | `cmd.exe` | N/A | N/A | ✅ ConPTY ANSI streaming |
| **WSL** | `wsl.exe` | N/A | N/A | ✅ ConPTY ANSI streaming |

---

## Claude Code Deep Integration

Quay 2 offers the deepest available integration for **Claude Code**:

### Supported Models
When opening a Claude Code terminal, you can choose directly from:
- `claude-opus-5-5` (Deep reasoning, massive refactors, complex architectural design)
- `claude-sonnet-5-5` (Fast, high-throughput autonomous implementation)
- `claude-haiku-5-5` (Rapid micro-tasks, triage, syntax checks)
- `claude-fable-5-1` (Experimental model)
- `claude-opus-4-6` (Legacy stability)
- `claude-sonnet-4-6` (Legacy stability)

### Automatic MCP Configuration Injection
When spawning Claude Code, Quay 2 generates an MCP configuration pointing to its embedded loopback server, whose `Authorization` header Claude Code fills from the terminal's `CLAUDE_EVENTS_TOKEN` environment variable:
```json
{
  "mcpServers": {
    "quay": {
      "type": "http",
      "url": "http://127.0.0.1:<bridge_port>/mcp",
      "headers": { "Authorization": "Bearer ${CLAUDE_EVENTS_TOKEN}" }
    }
  }
}
```
This is passed to Claude Code inline as JSON via `--mcp-config <json>`, so the token is neither written to a file nor visible on the command line, guaranteeing that every agent can immediately invoke `quay_list_agents` and `quay_send_message` without manual setup. The `/mcp` endpoint rejects calls that don't carry a live terminal's token.

### Status Indicator Strip
In the navigation rail and terminal status strip, Quay 2 displays live agent status:
- **`Starting`**: The terminal is launching. Other agent CLIs leave it on their first output: a listener (Copilot, Kiro, Gemini, Grok, Pi, Aider) goes to `Unknown`, and any other agent to `Idle`. A Claude Code terminal stays here until Quay hears from its [event-bridge plugin](../guide/installation.md#event-bridge-plugin).
- **`Working`** (Amber / Spinner): Agent is executing tools, thinking, or streaming tokens. An A2A message shows its receiver Working only when Quay will also see that turn end, which today means a Codex terminal, or a Claude Code or OpenCode terminal not shown as `Unknown`. Any other receiver keeps its status. A Codex turn you start by typing into its pane doesn't show Working, because Codex reports only the end of a turn.
- **`Waiting ◆`** (Purple): Agent has paused awaiting operator approval or input.
- **`Idle`** (Green): Agent turn completed and awaiting new task prompt.
- **`Exited`** (Gray): Process terminated.
- **`Unknown`**: Quay can't read whether the agent is working. A listener shows this from its first output. A Claude Code terminal shows it after sending no plugin event for 30 seconds after its first output, and its pane shows the plugin hint. An OpenCode terminal shows it when Quay can't reach the server its TUI runs for 60 seconds.

---

## Codex on the A2A Bus

A Codex terminal is a full peer: it can call the `quay_*` tools, answer a sender who waits, and show Working until its turn ends.

- **Tools.** Quay adds its MCP server to each Codex terminal with `-c` overrides, for that run only, and approves every tool on it, so Codex never stops to ask. The token comes from the terminal's `QUAY_A2A_TOKEN` variable. See [Codex CLI Arguments](../reference/cli-flags.md#codex-cli-arguments).
- **Turn end.** Codex runs Quay's turn-end helper, `quay-codex-notify.exe`, through its `notify` setting after every turn it completes. The helper ships beside Quay. It reports the turn's last message to Quay as the turn's answer, with the prompts the turn started with. Quay hands that answer to a waiting sender only when the turn started with the sender's message as Quay typed it, so a turn you typed, or the launch prompt's turn, never answers a peer. The helper ignores two kinds of turn that aren't the main conversation: a subagent's turn, whose `input-messages` is empty, and the hidden turn in which Codex's TUI names a new task.
- **When Quay sees no turn end.** Codex doesn't run the helper for a turn you interrupt with Esc, and Windows can't start it for a turn whose prompt and answer together run past about 32,000 characters. Such a turn leaves the terminal Working, holding its messages, until the next turn Codex completes. A sender waiting on it gets the usual still-working answer after 60 seconds.
- **Delivery.** Quay holds messages to a Codex terminal while it is starting or working, as for Claude Code, and types the next one in when Codex reports the turn end.
- **Helper log.** Each turn the helper sees adds one line to `%LOCALAPPDATA%\Quay2\codex-notify.log`: whether it posted or dropped the turn, and the turn's `thread-id` and `client` (`codex-tui` in the interactive TUI). The log never holds message text, and it starts over once it reaches 256 KB.

---

## PowerShell & Shell Multiplexing

In addition to AI agents, Quay 2 functions as a premier Windows terminal multiplexer:
- Full support for `pwsh.exe` (PowerShell 7) and `powershell.exe` (Windows PowerShell 5.1).
- Native handling of PSReadLine keybindings, autocomplete menus, and syntax colorization.
- Support for Command Prompt (`cmd.exe`) and Windows Subsystem for Linux (`wsl.exe -d Ubuntu`).
