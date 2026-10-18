# Configuration & Settings

Quay 2 provides extensive customization options for terminal styling, environment variables, model defaults, audio notifications, and storage paths.

---

## File System Locations

All machine-local state and caches are stored in standard Windows AppData locations:

| Path | Purpose |
| :--- | :--- |
| `%LOCALAPPDATA%\Quay2\workspaces.json` | Registered project folders, terminal history, and custom layout states |
| `%LOCALAPPDATA%\Quay2\token_stats_cache.json` | Deduplicated token accounting cache for sub-2ms spend calculation |
| `%LOCALAPPDATA%\Quay2\praxis\praxis.db` | SQLite database for the Machina Praxis AI Software Factory |
| `~/.claude/projects/` | Upstream Claude Code session transcripts scanned for token spend analytics |

---

## Environment Variables

Quay 2 injects several environment variables into every spawned terminal session to enable telemetry and A2A routing:

| Variable | Injected By Quay | Description |
| :--- | :--- | :--- |
| `CLAUDE_EVENTS_URL` | Yes | HTTP loopback URL for event ingestion (`http://127.0.0.1:<port>/v1/events`) |
| `CLAUDE_EVENTS_TOKEN` | Yes | Cryptographically random Bearer authorization token for loopback security |
| `CLAUDE_EVENTS_TAG` | Yes | Unique terminal identifier (`term-<uuid>`) |
| `ANTHROPIC_MODEL` | Optional | Forced model override when launched via the model picker (e.g. `claude-opus-5-5`) |
| `QUAY_TERMINAL_ID` | Yes | Internal terminal identifier for A2A bus addressing |
| `QUAY_BRIDGE_PORT` | Yes | Active port of the embedded Axum HTTP bridge |

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
