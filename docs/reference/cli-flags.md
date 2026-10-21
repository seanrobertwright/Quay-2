# Agent CLI Flags & Environment Variables

This page lists the command lines and environment variables Quay 2 uses to start each kind of terminal and put it on the [A2A bus](../features/a2a-orchestration.md), and the variables Quay reads from its own environment.

---

## How a Command Line Is Built

Every agent terminal's command line is built in the same order:

1. the CLI;
2. the flags Quay adds for the permission mode, such as `--dangerously-skip-permissions` when **Skip Permissions** is chosen;
3. the custom flags;
4. Codex's `-c` overrides, for a Codex terminal;
5. a swarm agent's launch prompt, for a CLI that takes one;
6. `--mcp-config <json>`, for a Claude Code terminal.

**Custom flags** are the model chosen in the New Terminal dialog followed by its **Custom CLI Arguments**, or a swarm agent's flags. A terminal launched with none gets the project's **Default Claude CLI Flags** from Workspace Settings, whatever its CLI. Quay splits custom flags on whitespace, so a flag's value can't contain a space, and quotes are passed on as they are. Quay adds custom flags to agent terminals only, never to a PowerShell or Custom Command terminal.

The launch prompt is always one argument, so a multi-line prompt arrives intact.

---

## Claude Code CLI Arguments

Quay 2 starts Claude Code as `claude.exe` on Windows and `claude` on macOS and Linux, found on the terminal's `PATH`:

```powershell
claude.exe [--dangerously-skip-permissions] [CUSTOM_FLAGS] [LAUNCH_PROMPT] --mcp-config <json>
```

| Flag | Purpose | Condition |
| :--- | :--- | :--- |
| `--dangerously-skip-permissions` | Bypasses interactive confirmation for file edits and shell commands | **Skip Permissions** is chosen |
| `--mcp-config <json>` | Inline JSON connecting Claude Code to Quay's MCP server. Its token header reads `${CLAUDE_EVENTS_TOKEN}`, so the token is neither written to a file nor visible on the command line | Every Claude Code terminal |

The model is not a separate flag: the model you pick in the New Terminal dialog, such as **Claude Sonnet 5.5**, becomes the custom flag `--model claude-sonnet-5-5`.

The JSON passed to `--mcp-config`:

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

> [!IMPORTANT]
> **Argument Ordering**: `--mcp-config` takes several values and would read a bare argument after it as another config file, so `--dangerously-skip-permissions`, the custom flags and a swarm agent's launch prompt always come *before* `--mcp-config`.

---

## Codex CLI Arguments

Quay 2 starts Codex with its permission flag, then custom flags, then the `-c` overrides that put it on the A2A bus, then a swarm agent's launch prompt:

```powershell
codex.exe [--dangerously-bypass-approvals-and-sandbox] [CUSTOM_FLAGS] -c <override> ... [LAUNCH_PROMPT]
```

| Override | Purpose |
| :--- | :--- |
| `-c mcp_servers.quay.url="http://127.0.0.1:<port>/mcp"` | Adds Quay's MCP server for this run only |
| `-c mcp_servers.quay.bearer_token_env_var="QUAY_A2A_TOKEN"` | Codex reads the bearer token from the terminal's environment, so the token is neither written to a file nor visible on the command line |
| `-c mcp_servers.quay.default_tools_approval_mode="approve"` | Approves every tool on Quay's server without a prompt: `quay_list_agents`, `quay_send_message`, `quay_broadcast`, `quay_get_agent_status` and the `machina_*` work-order tools. Without it, Codex refuses the call when its approval policy is `never`, which `--dangerously-bypass-approvals-and-sandbox` sets |
| `-c notify=["<Quay's folder>\quay-codex-notify.exe"]` | Runs Quay's turn-end helper after each Codex turn (see [Codex on the A2A bus](../features/agent-support.md#codex-on-the-a2a-bus)) |

`--dangerously-bypass-approvals-and-sandbox` is set when **Skip Permissions** is chosen. The overrides are passed in both permission modes. They come after the custom flags, so a custom `-c` with the same key doesn't replace them, and the `notify` override replaces any `notify` in your own `~/.codex/config.toml` for that terminal.

---

## OpenCode CLI Arguments

When spawning OpenCode terminals, Quay 2 runs:

```powershell
opencode.exe --port <free_port> [--auto] [CUSTOM_FLAGS] [--prompt <launch_prompt>]
```

Quay starts `opencode.exe` (`opencode` on macOS and Linux) by name, so the terminal's `PATH` finds it, and a workspace's own `PATH` variable can point it at another copy. Only when no folder on that `PATH` holds one does Quay fall back to bun's install, `%USERPROFILE%\.bun\bin\opencode.exe`.

| Flag | Purpose | Condition |
| :--- | :--- | :--- |
| `--port <free_port>` | The OpenCode TUI serves its HTTP server on this loopback port. Quay subscribes to its `GET /event` stream: the main session going busy shows the terminal Working, and its first idle after that ends the turn, whose reply Quay reads from `GET /session/:id/message`. Sessions with a `parentID` (subagents) are ignored. Quay only reads from this server; messages are still typed into the terminal. | Every OpenCode terminal; a free port is picked at each launch |
| `--auto` | Auto-approves tool permissions | **Skip Permissions** is chosen |

Quay's MCP server reaches OpenCode through `OPENCODE_CONFIG_CONTENT` instead of a flag:

```json
{
  "mcp": {
    "quay": {
      "type": "remote",
      "url": "http://127.0.0.1:<bridge_port>/mcp",
      "headers": { "Authorization": "Bearer {env:QUAY_A2A_TOKEN}" },
      "oauth": false
    }
  }
}
```

OpenCode fills the header from the terminal's `QUAY_A2A_TOKEN`, so the token stays out of the config. If the workspace sets its own `OPENCODE_CONFIG_CONTENT` to a JSON object, Quay keeps it and adds `mcp.quay` to it.

---

## Antigravity Environment

Quay 2 starts Antigravity as `agy.exe`, with `--dangerously-skip-permissions` when **Skip Permissions** is chosen, then custom flags. It takes no launch prompt. Besides the [variables every A2A peer gets](#every-a2a-peer), its environment carries:

| Variable | Value | Purpose |
| :--- | :--- | :--- |
| `AGY_CLI_OSC7501` | `on` | Makes `agy` print an OSC 7501 sequence each time its turn moves, which Quay reads for the terminal's status and for the answer to a sender who waits (see [Antigravity on the A2A bus](../features/agent-support.md#antigravity-on-the-a2a-bus)) |
| `AGY_CLI_OSC7501_MESSAGES` | unset | Its `brief` setting drops the text from each sequence, so Quay removes it even when the workspace or Quay's own environment sets it |

Both are applied after the workspace's own variables, so none of those can replace them.

---

## Listener CLIs

These CLIs are listeners on the A2A bus: they get messages but have no `quay_*` tools and can't reply.

| CLI | Command | Skip Permissions flag | Launch prompt |
| :--- | :--- | :--- | :--- |
| Pi | `cmd.exe /c pi` | none: Pi never asks before a tool call | positional |
| Gemini | `cmd.exe /c gemini` | none | `-i <prompt>` |
| Grok | `%USERPROFILE%\.grok\bin\agent.exe` when it exists, else `agent.exe` | none | none |
| Aider | `aider.exe` | `--yes-always` | none |
| Kiro | `%LOCALAPPDATA%\Kiro-Cli\kiro-cli.exe chat` when it exists, else `kiro-cli.exe chat` | `--trust-all-tools` | positional |
| Copilot | `%LOCALAPPDATA%\GitHub CLI\copilot\copilot.exe` when it exists | `--allow-all-tools` | `-i <prompt>` |
| Copilot, without that file | `gh.exe copilot` (`C:\Program Files\GitHub CLI\gh.exe` when it exists) | none | `-i <prompt>` |

Pi and Gemini are npm shims, which `cmd.exe` can't hand a multi-line prompt. When either gets a launch prompt, Quay runs it through `pwsh.exe -NoProfile -NoLogo -Command` instead, which reads the prompt from the `QUAY_LAUNCH_PROMPT` variable.

---

## Shell Terminals

A **PowerShell Console** terminal runs PowerShell 7:

```powershell
pwsh.exe -NoProfile -NoLogo
```

A **Custom Command** terminal runs its command in PowerShell 7 and stays open after it:

```powershell
pwsh.exe -NoProfile -NoLogo -NoExit -Command <command>
```

There is no fallback to Windows PowerShell (`powershell.exe`): `pwsh.exe` must be on `PATH`. On macOS and Linux, a shell terminal runs `sh`, and a Custom Command terminal runs `sh -c <command>`. A PowerShell Console terminal there opens a bare `sh`.

---

## Injected Environment Variables

Every terminal gets the project's **Workspace Environment Variables** first. Quay sets its own variables after them, so a workspace variable with the same name never replaces one of Quay's.

### Claude Code Terminals

Quay 2 sets these for Claude Code's event-bridge plugin:

```powershell
CLAUDE_EVENTS_URL="http://127.0.0.1:50362"
CLAUDE_EVENTS_TOKEN="<per_terminal_token>"
CLAUDE_EVENTS_TAG="term-a1b2c3d4"
CLAUDE_EVENTS_TOOLS="full"
CLAUDE_EVENTS_PERMISSIONS="host"
```

| Variable | Purpose |
| :--- | :--- |
| `CLAUDE_EVENTS_URL` | The bridge's base address, with no path. The plugin adds `/v1/events` and its other paths |
| `CLAUDE_EVENTS_TOKEN` | The terminal's bearer token, checked by constant-time comparison on each request to the bridge |
| `CLAUDE_EVENTS_TAG` | The terminal id, so events reach the right terminal |
| `CLAUDE_EVENTS_TOOLS` | `full`: the plugin sends answers and tool data uncut |
| `CLAUDE_EVENTS_PERMISSIONS` | `host` routes tool approvals to Quay; `off` when **Skip Permissions** is chosen |

### Every A2A Peer

Every agent terminal on the A2A bus (full peer, responder or listener) gets these four. PowerShell, Custom Command and Archon terminals get none:

```powershell
QUAY_TERMINAL_ID="term-a1b2c3d4"
QUAY_A2A_TOKEN="<per_terminal_token>"
QUAY_MCP_URL="http://127.0.0.1:50362/mcp"
QUAY_EVENTS_URL="http://127.0.0.1:50362/v1/events"
```

| Variable | Purpose |
| :--- | :--- |
| `QUAY_TERMINAL_ID` | The terminal id |
| `QUAY_A2A_TOKEN` | The terminal's bearer token for the bridge, the same token as `CLAUDE_EVENTS_TOKEN` |
| `QUAY_MCP_URL` | Quay's MCP server |
| `QUAY_EVENTS_URL` | The bridge's event endpoint |

The two URLs carry the bridge's port, so no agent needs a separate port variable.

---

## Quay Startup Environment Variables

Quay 2 reads these from its own environment when it starts. They are not passed to terminals:

| Variable | Purpose | Default |
| :--- | :--- | :--- |
| `QUAY_BRIDGE_PORT` | Pins the loopback port of the bridge (the event and MCP server that the rail header's port badge shows). Must be a whole number from 1 to 65535. | Unset or empty: the OS picks a random free port on each launch. |

```powershell
$env:QUAY_BRIDGE_PORT = "47100"
```

The bridge always binds `127.0.0.1` only. If `QUAY_BRIDGE_PORT` holds anything other than a port from 1 to 65535 (for example `0`, `65536` or `abc`), Quay logs an error naming the variable and the value, and the bridge does not start; it never falls back to a random port. If the pinned port is already in use, the bind fails with an error naming the port and the variable.
