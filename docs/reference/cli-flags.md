# Agent CLI Flags & Environment Variables

This document lists the startup parameters, command-line arguments, and environment variables used by Quay 2 to launch and manage agent processes.

---

## Claude Code CLI Arguments

When spawning Claude Code terminals, Quay 2 executes `claude.cmd` with deterministic argument ordering:

```powershell
claude.cmd [OPTIONS] [CUSTOM_FLAGS]
```

### Standard Flags Injected by Quay 2

| Flag | Purpose | Condition |
| :--- | :--- | :--- |
| `--model <model_id>` | Specifies the Anthropic model (`claude-opus-5-5`, `claude-sonnet-5-5`, etc.) | Set whenever a specific model is chosen in the modal |
| `--dangerously-skip-permissions` | Bypasses interactive confirmation for file edits and bash commands | Set when "Skip Permissions" checkbox is enabled |
| `--mcp-config <json>` | Inline JSON configuration connecting Claude Code to Quay's loopback A2A MCP bus; its token header reads `${CLAUDE_EVENTS_TOKEN}` | Injected for all Claude Code sessions |

> [!IMPORTANT]
> **Argument Ordering**: `--mcp-config` takes several values and would read a bare argument after it as another config file, so `--dangerously-skip-permissions`, custom flags such as `--model` and a swarm agent's launch prompt are always positioned *before* `--mcp-config`.

---

## Quay Startup Environment Variables

Quay 2 reads these from its own environment when it starts:

| Variable | Purpose | Default |
| :--- | :--- | :--- |
| `QUAY_BRIDGE_PORT` | Pins the loopback port of the bridge (the event and MCP server that the rail header's port badge shows). Must be a whole number from 1 to 65535. | Unset or empty: the OS picks a random free port on each launch. |

```powershell
$env:QUAY_BRIDGE_PORT = "47100"
```

The bridge always binds `127.0.0.1` only. If `QUAY_BRIDGE_PORT` holds anything other than a port from 1 to 65535 (for example `0`, `65536` or `abc`), Quay logs an error naming the variable and the value, and the bridge does not start; it never falls back to a random port. If the pinned port is already in use, the bind fails with an error naming the port and the variable.

---

## Injected Environment Variables

Quay 2 sets the following environment variables in the child ConPTY process environment of Claude Code terminals:

```powershell
CLAUDE_EVENTS_URL="http://127.0.0.1:50362"
CLAUDE_EVENTS_TOKEN="<per_terminal_token>"
CLAUDE_EVENTS_TAG="term-a1b2c3d4"
CLAUDE_EVENTS_TOOLS="full"
CLAUDE_EVENTS_PERMISSIONS="host"
```

### Protocol Usage:
- `CLAUDE_EVENTS_URL`: Bridge address for the `claude-mod-events` telemetry plugin.
- `CLAUDE_EVENTS_TOKEN`: Verified via constant-time comparison on incoming HTTP requests.
- `CLAUDE_EVENTS_TAG`: The terminal id, so events reach the right terminal.
- `CLAUDE_EVENTS_PERMISSIONS`: `host` routes tool approvals to Quay; `off` when "Skip Permissions" is enabled.

---

## PowerShell Process Arguments

When spawning PowerShell terminals, Quay 2 executes:
```powershell
pwsh.exe -NoLogo -NoExit
```
If PowerShell 7 (`pwsh.exe`) is not discovered on PATH, Quay 2 falls back to Windows PowerShell (`powershell.exe`).
