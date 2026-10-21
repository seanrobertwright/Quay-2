# Configuration & Settings

Quay 2 provides extensive customization options for terminal styling, environment variables, model defaults, audio notifications, and storage paths.

---

## File System Locations

All machine-local state and caches are stored in standard Windows AppData locations:

| Path | Purpose |
| :--- | :--- |
| `%LOCALAPPDATA%\Quay2\workspaces.json` | Registered project folders, terminal history, and custom layout states |
| `%LOCALAPPDATA%\Quay2\swarms.json` | Your saved swarms from the Swarm Launcher |
| `%LOCALAPPDATA%\Quay2\token_stats_cache.json` | Deduplicated token accounting cache for sub-2ms spend calculation |
| `%LOCALAPPDATA%\Quay2\praxis\praxis.db` | SQLite database for the Machina Praxis AI Software Factory |
| `~/.claude/projects/` | Upstream Claude Code session transcripts scanned for token spend analytics |

---

## Environment Variables

Quay 2 injects these environment variables into Claude Code terminals to enable telemetry and tool approvals:

| Variable | Description |
| :--- | :--- |
| `CLAUDE_EVENTS_URL` | Bridge address on loopback (`http://127.0.0.1:<port>`) |
| `CLAUDE_EVENTS_TOKEN` | Bearer token the bridge checks on incoming requests |
| `CLAUDE_EVENTS_TAG` | The terminal id, so events reach the right terminal |
| `CLAUDE_EVENTS_TOOLS` | `full` |
| `CLAUDE_EVENTS_PERMISSIONS` | `host` routes tool approvals to Quay; `off` when "Skip Permissions" is enabled |

Quay 2 also reads `QUAY_BRIDGE_PORT` from its own environment at startup to pin the bridge port. See [Quay Startup Environment Variables](../reference/cli-flags.md#quay-startup-environment-variables).

---

## Custom CLI Flags & Shell Arguments

When launching a terminal via `Ctrl+B N`, you can specify custom startup flags:

### Claude Code Custom Flags
```powershell
--verbose --theme dark --max-thinking-tokens 16000
```
- `--dangerously-skip-permissions`: Bypasses interactive tool execution prompts.
- `--model <model_id>`: Forces Claude Code to run against specific Anthropic models.

### PowerShell Startup Flags
```powershell
-NoLogo -NoExit -ExecutionPolicy Bypass
```

---

## Audio Chimes Configuration

Quay 2 can emit subtle, non-intrusive audio tones when long-running agent tasks complete:

1. Press `Ctrl+B T` to open **Token Spend & Chimes**.
2. Toggle **Audio Turn Chimes**:
   - **On Completion**: Plays a soft chime when an agent finishes thinking and enters the `idle` state.
   - **On Prompt / Hold**: Plays an alert tone when an agent halts to ask a human operator for permission or input.
3. Chime volume and audio frequency can be adjusted in the settings modal.
