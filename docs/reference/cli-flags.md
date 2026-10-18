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
| `--mcp-config <path>` | Points to dynamic JSON configuration connecting Claude Code to Quay's loopback A2A MCP bus | Injected for all Claude Code sessions |

> [!IMPORTANT]
> **Argument Ordering**: To prevent Commander.js variadic parsing from swallowing flags, `--model` and `--dangerously-skip-permissions` are always positioned *before* `--mcp-config`.

---

## Injected Environment Variables

Quay 2 sets the following environment variables in the child ConPTY process environment:

```powershell
CLAUDE_EVENTS_URL="http://127.0.0.1:50362/v1/events"
CLAUDE_EVENTS_TOKEN="<random_hex_32_bytes>"
CLAUDE_EVENTS_TAG="term-a1b2c3d4"
QUAY_TERMINAL_ID="term-a1b2c3d4"
QUAY_BRIDGE_PORT="50362"
ANTHROPIC_MODEL="claude-opus-5-5"
```

### Protocol Usage:
- `CLAUDE_EVENTS_URL`: Target endpoint for the `claude-mod-events` telemetry plugin.
- `CLAUDE_EVENTS_TOKEN`: Verified via constant-time comparison on incoming HTTP requests.
- `ANTHROPIC_MODEL`: Additional fallback guarantee ensuring Anthropic SDK picks up the user's selected model.

---

## PowerShell Process Arguments

When spawning PowerShell terminals, Quay 2 executes:
```powershell
pwsh.exe -NoLogo -NoExit
```
If PowerShell 7 (`pwsh.exe`) is not discovered on PATH, Quay 2 falls back to Windows PowerShell (`powershell.exe`).
