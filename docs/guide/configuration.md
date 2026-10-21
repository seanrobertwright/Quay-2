# Configuration & Settings

Quay 2 keeps its state in your user profile. Each project can carry its own environment variables and default CLI flags, and each agent terminal gets the variables that put it on the A2A bus.

---

## File System Locations

On Windows, Quay keeps its state under `%LOCALAPPDATA%\Quay2`. Without `LOCALAPPDATA` (on macOS and Linux), it uses `~/.quay2` instead.

| Path | Purpose |
| :--- | :--- |
| `%LOCALAPPDATA%\Quay2\workspaces.json` | Registered projects: each one's terminals, last viewed terminal, environment variables and default CLI flags |
| `%LOCALAPPDATA%\Quay2\swarms.json` | Your saved swarms from the Swarm Launcher |
| `%LOCALAPPDATA%\Quay2\sessions\sessions.json` | The terminals Quay restores at startup |
| `%LOCALAPPDATA%\Quay2\sessions\<terminal id>.log` | Each terminal's scrollback |
| `%LOCALAPPDATA%\Quay2\token-ledger.json` | Quay's token ledger, behind the daily totals in Token Spend |
| `%LOCALAPPDATA%\Quay2\machina\` | Machina Praxis state (`state.json`) and its holdback vault (`vault\`) |
| `~/.claude/projects/` | Claude Code session transcripts, scanned for token spend. `CLAUDE_CONFIG_DIR` replaces `~/.claude` when set |

---

## Workspace Settings

Each project has its own settings:

- **Default Claude CLI Flags**: the custom flags a terminal in this project gets when it is launched without any.
- **Workspace Environment Variables**: set in every terminal launched in this project, before Quay's own variables, so a workspace variable never replaces one of Quay's.

---

## Environment Variables

Quay 2 sets these in Claude Code terminals for the event-bridge plugin:

| Variable | Description |
| :--- | :--- |
| `CLAUDE_EVENTS_URL` | The bridge's base address on loopback (`http://127.0.0.1:<port>`), with no path. The plugin adds `/v1/events` and its other paths |
| `CLAUDE_EVENTS_TOKEN` | Bearer token the bridge checks on incoming requests |
| `CLAUDE_EVENTS_TAG` | The terminal id, so events reach the right terminal |
| `CLAUDE_EVENTS_TOOLS` | `full` |
| `CLAUDE_EVENTS_PERMISSIONS` | `host` routes tool approvals to Quay; `off` when **Skip Permissions** is chosen |

Every agent terminal on the A2A bus, whatever its CLI and its level (full peer, responder or listener), also gets these. PowerShell, Custom Command and Archon terminals don't:

| Variable | Description |
| :--- | :--- |
| `QUAY_TERMINAL_ID` | The terminal id |
| `QUAY_A2A_TOKEN` | The terminal's bearer token for the bridge |
| `QUAY_MCP_URL` | Quay's MCP server (`http://127.0.0.1:<port>/mcp`) |
| `QUAY_EVENTS_URL` | The bridge's event endpoint (`http://127.0.0.1:<port>/v1/events`) |

A workspace environment variable with one of these names doesn't replace it. The [CLI flags reference](../reference/cli-flags.md#injected-environment-variables) lists the variables each CLI gets besides these.

Quay 2 also reads `QUAY_BRIDGE_PORT` from its own environment at startup to pin the bridge port. It is not passed to terminals. See [Quay Startup Environment Variables](../reference/cli-flags.md#quay-startup-environment-variables).

---

## Custom CLI Flags

When you launch an agent terminal with `Ctrl+B N`, you can pick a model and add **Custom CLI Arguments**. Quay puts the model's flag first, then your arguments:

```powershell
--model claude-sonnet-5-5 --verbose
```

- Quay splits custom flags on whitespace, so a flag's value can't contain a space.
- Custom flags apply to agent terminals only. A PowerShell Console or Custom Command terminal takes none.
- **Skip Permissions** and **Interactive Approvals** choose the permission flag for you, such as `--dangerously-skip-permissions` for Claude Code.

The [CLI flags reference](../reference/cli-flags.md#how-a-command-line-is-built) shows where custom flags go in each CLI's command line.

---

## Audio Chimes

Quay 2 can play a chime when an agent needs you:

1. Press `Ctrl+B T` to open **Token Spend & Audio Chime Meter**.
2. Under **Background Turn Chimes**, click the button to switch between **Chimes Active** and **Muted**.
3. While chimes are active, set the **Volume** slider and try the sounds with **Test Completion Chime** and **Test Attention Ping**.

The completion chime plays when a Claude Code or Codex turn ends, as reported by Claude Code's event-bridge plugin or Codex's turn-end helper. The attention chime plays when Claude Code asks for your input or a tool approval.
