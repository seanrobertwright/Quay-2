# Supported Agent CLIs

Quay 2 is designed as a universal desktop cockpit for all major autonomous AI coding agents, shells, and command environments.

---

## Agent Compatibility Matrix

| Agent / Shell | Binary Command | Model Selection Support | A2A MCP Bus Integration | Telemetry & Turn Status |
| :--- | :--- | :---: | :---: | :---: |
| **Claude Code** | `claude.cmd` / `claude` | ✅ Full (Opus 5.5, Sonnet 5.5, Haiku 5.5) | ✅ Automatic via `--mcp-config` | ✅ Full turn/tool lifecycle |
| **Antigravity CLI** | `agy.cmd` / `agy` | ✅ Inherited from active tier | ✅ Supported | ✅ Tool execution tracking |
| **OpenAI Codex CLI** | `codex.cmd` | ✅ GPT-4o / o1 / o3-mini | ✅ Custom MCP adapter | ✅ Console output streaming |
| **Pi Coding Agent** | `pi` | ✅ Pi multi-model | ✅ Custom MCP adapter | ✅ Console output streaming |
| **Google Gemini CLI** | `gemini` | ✅ Gemini 2.5 / 2.0 Pro | ✅ Custom MCP adapter | ✅ Console output streaming |
| **xAI Grok CLI** | `grok` | ✅ Grok Code | ✅ Custom MCP adapter | ✅ Console output streaming |
| **Aider** | `aider` | ✅ Any LLM via LiteLLM | ✅ Via MCP server extension | ✅ Git commit tracking |
| **Kiro CLI** | `kiro` | ✅ Multi-model | ✅ Standard stdio | ✅ Console output streaming |
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
- **`Working`** (Amber / Spinner): Agent is executing tools, thinking, or streaming tokens. An A2A message shows its receiver Working only when Quay will also see that turn end, which today means a Claude Code terminal not shown as `Unknown`. Any other receiver keeps its status.
- **`Waiting ◆`** (Purple): Agent has paused awaiting operator approval or input.
- **`Idle`** (Green): Agent turn completed and awaiting new task prompt.
- **`Exited`** (Gray): Process terminated.
- **`Unknown`**: Quay can't read whether the agent is working. A listener shows this from its first output. A Claude Code terminal shows it after sending no plugin event for 30 seconds after its first output, and its pane shows the plugin hint.

---

## PowerShell & Shell Multiplexing

In addition to AI agents, Quay 2 functions as a premier Windows terminal multiplexer:
- Full support for `pwsh.exe` (PowerShell 7) and `powershell.exe` (Windows PowerShell 5.1).
- Native handling of PSReadLine keybindings, autocomplete menus, and syntax colorization.
- Support for Command Prompt (`cmd.exe`) and Windows Subsystem for Linux (`wsl.exe -d Ubuntu`).
