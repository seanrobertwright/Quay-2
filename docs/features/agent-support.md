# Supported Agent CLIs

Quay 2 is designed as a universal desktop cockpit for all major autonomous AI coding agents, shells, and command environments.

---

## Agent Compatibility Matrix

Each agent CLI sits at one of three levels on the [A2A bus](./a2a-orchestration.md), the level `quay_list_agents` reports:

- **Full peer**: Quay gives it the `quay_*` tools, so it can send messages, and it answers a sender who waits.
- **Responder**: it answers a sender who waits, but has no `quay_*` tools, so it can't start a conversation.
- **Listener**: Quay types messages into it, but it has no `quay_*` tools and Quay can't read its answer.

The model column lists the presets in the **New Terminal** dialog. Every agent can also start on its own default model, and **Custom CLI Arguments** passes any other model flag.

| Agent / Shell | Program Quay starts | Model presets | A2A bus level | Turn status |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Code** | `claude.exe` (`claude` off Windows) | Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5, the `fable`, `opus`, `sonnet` and `haiku` aliases, and earlier generations | Full peer, with its tools through `--mcp-config`. A listener while it shows Unknown, because its event-bridge plugin sent no event in the 30 seconds after its first output | Turn start and end, and the tool in use, from its event-bridge plugin |
| **OpenAI Codex CLI** | `codex.exe` | o3, o4-mini, GPT-4.1, GPT-4o | Full peer, with its tools through `-c` overrides | Turn end, through Quay's `notify` helper |
| **OpenCode** | `opencode.exe` from `PATH`, else from bun's `~/.bun/bin` | Claude Sonnet 5.5 and Opus 5.5, GPT-4o, Gemini 2.0 Flash, DeepSeek Chat | Full peer, with its tools through `OPENCODE_CONFIG_CONTENT` | Turn start and end, from the server its TUI runs |
| **Antigravity CLI** | `agy.exe` | Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 3.8 Flash | Responder, answering through its OSC 7501 turn reports | Turn start and end, and Waiting while it is blocked, from its OSC 7501 turn reports |
| **Pi Coding Agent** | `pi`, through `cmd.exe /c`, or through `pwsh.exe` with a launch prompt | Claude Sonnet (latest), GPT-4o, DeepSeek Reasoner, and high or max thinking | Listener | None: Unknown from its first output |
| **PiG (Pi in Go)** | `pig.exe` from `PATH`, else behind npm's `pig.cmd` shim, else from `~/go/bin`. Without it, the pane says how to install PiG | Claude Sonnet (latest) with high thinking, Claude Opus (latest), and high or max thinking | Listener | None: Unknown from its first output |
| **Google Gemini CLI** | `gemini`, through `cmd.exe /c`, or through `pwsh.exe` with a launch prompt | Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 3.8 Flash | Listener | None: Unknown from its first output |
| **xAI Grok CLI** | `agent.exe`, from `~/.grok/bin` when it is there | Grok 2 Beta, Grok Vision | Listener | None: Unknown from its first output |
| **Aider** | `aider.exe` | Claude Sonnet 5.5 and Opus 5.5, DeepSeek R1, GPT-4o | Listener | None: Unknown from its first output |
| **Kiro CLI** | `kiro-cli.exe chat`, from `%LOCALAPPDATA%\Kiro-Cli` when it is there | Claude Opus and Sonnet 5.5 and 5, GPT 5.6 Sol and Terra, DeepSeek V3.2, Qwen3 Coder Next, and the V3 engine (`--v3`) | Listener | None: Unknown from its first output |
| **GitHub Copilot CLI** | `copilot.exe` from `%LOCALAPPDATA%\GitHub CLI\copilot`, else `gh copilot`, which gets no `--allow-all-tools` under Skip Permissions and so asks before its tools | Claude Sonnet 5.5, GPT-4o, o3-mini | Listener | None: Unknown from its first output |
| **PowerShell Console** | `pwsh.exe` | N/A | Not a peer | None |
| **Custom Command** | Your command line, run by `pwsh.exe -NoProfile -NoLogo -NoExit -Command`, so `cmd.exe` or `wsl.exe -d Ubuntu` opens that shell. Your PowerShell profile isn't loaded | N/A | Not a peer | None |

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
This is passed to Claude Code inline as JSON via `--mcp-config <json>`, so the token is neither written to a file nor visible on the command line, so a Claude Code terminal can call `quay_list_agents`, `quay_send_message` and the other tools without manual setup. Codex and OpenCode get the same server their own way, and the other CLIs get none (see [Peers and their levels](./a2a-orchestration.md#peers-and-their-levels)). The `/mcp` endpoint rejects calls that don't carry a live terminal's token.

### Status Indicator Strip
In the navigation rail and terminal status strip, Quay 2 displays live agent status:
- **`Starting`**: The terminal is launching. Other agent CLIs leave it on their first output: a listener (Copilot, Kiro, Gemini, Grok, Pi, PiG, Aider) goes to `Unknown`, and any other agent to `Idle`. A Claude Code terminal stays here until Quay hears from its [event-bridge plugin](../guide/installation.md#event-bridge-plugin).
- **`Working`** (Amber / Spinner): Agent is executing tools, thinking, or streaming tokens. An A2A message shows its receiver Working only when Quay will also see that turn end, which today means a Codex terminal, an Antigravity terminal, or a Claude Code or OpenCode terminal not shown as `Unknown`. Any other receiver keeps its status. A Codex turn you start by typing into its pane doesn't show Working, because Codex reports only the end of a turn.
- **`Waiting ◆`** (Purple): Agent has paused awaiting operator approval or input. An Antigravity terminal shows it while Antigravity reports itself blocked, on a tool approval, the folder-trust prompt or signing in.
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

## Antigravity on the A2A Bus

An Antigravity terminal is a responder: it answers a sender who waits and shows whether it is working, but it has no `quay_*` tools, so it can't start a conversation.

- **Turn reports.** Quay starts `agy` with `AGY_CLI_OSC7501=on`, so it prints an OSC 7501 sequence in its output each time its turn moves, and Quay reads them as the output arrives. `working` shows the terminal Working, `blocked` shows it Waiting, and `done` and `idle` show it Idle. Quay unsets `AGY_CLI_OSC7501_MESSAGES`, whose `brief` setting would drop the text Quay answers with. See [Antigravity Environment](../reference/cli-flags.md#antigravity-environment).
- **Answers.** A sender waiting on Antigravity gets the text of the `done` that ends the turn its message started. Antigravity sends at most 200 characters of it: a longer answer arrives as its first 199 characters and `…`, followed by a note from Quay saying it was cut off. Ask for anything longer in a file. A turn that stops on a prompt answers with what it waits on instead, for example `blocked (permission): Trust this folder?` or `blocked (permission): Approve RunCommand: ...`. The turn goes on once you answer the prompt in its pane, but its sender already has its answer.
- **Delivery.** Quay holds messages to an Antigravity terminal while it is starting, working or blocked, as for Claude Code, and types the next one in when its turn ends.

---

## PowerShell & Shell Multiplexing

In addition to AI agents, Quay 2 functions as a premier Windows terminal multiplexer:
- PowerShell 7 (`pwsh.exe`) runs every shell terminal. There is no fallback to Windows PowerShell 5.1 (`powershell.exe`).
- A **PowerShell Console** terminal starts `pwsh.exe` directly.
- Native handling of PSReadLine keybindings, autocomplete menus, and syntax colorization.
- A **Custom Command** terminal runs its command line in `pwsh.exe`, without your profile, and stays open, so `powershell.exe` (Windows PowerShell 5.1), `cmd.exe` or `wsl.exe -d Ubuntu` opens that shell.
