# Quay 2 (Tauri Edition)

Quay 2 is a high-performance Windows workspace and orchestrator for supervising and coordinating multiple **Claude Code**, **PowerShell**, and custom command sessions.

Built with **Tauri v2**, **Rust ConPTY (`portable-pty`)**, **xterm.js**, and an embedded **`claude-mod-events`** HTTP bridge, Quay 2 replaces the low-level multiplexer hacks of terminal multiplexers (`psmux`) with a native desktop interface.

---

## Architecture: Vertical Slice Architecture (VSA)

Quay 2 is structured into cohesive end-to-end vertical feature slices across both the Rust backend and the React frontend:

### Backend Slices (`src-tauri/src/slices/`)
1. **`pty`**: Manages native Windows ConPTY process lifecycles via `portable-pty`.
   - Spawns `claude.cmd`, `pwsh.exe`, or arbitrary commands.
   - Streams PTY output over background threads via Tauri events (`pty-output`).
   - Watches child process exit status (`terminal-exited`).
   - Injects `claude-mod-events` environment variables (`CLAUDE_EVENTS_URL`, `CLAUDE_EVENTS_TOKEN`, `CLAUDE_EVENTS_TAG`, etc.).
2. **`bridge`**: Embedded loopback HTTP listener (`127.0.0.1:<port>`) implementing the `claude-mod-events` v1 wire protocol.
   - Ingests `POST /v1/events` (`turn.started`, `turn.completed`, `tool.started`, `tool.finished`, etc.).
   - Holds `GET /v1/commands` long-polls for command execution (`prompt`, `interrupt`, `toast`).
   - Evaluates `POST /v1/permission` tool approval requests.
   - Validates Bearer tokens in constant-time and enforces anti-CSRF loopback security.
3. **`workspace`**: Project directory registration, persistence, and terminal affiliation.
4. **`orchestrator`**: The Agent-to-Agent (A2A) message router for dispatching prompts, handoffs, and broadcasts across running sessions.

### Frontend Slices (`src/slices/`)
1. **`terminal`**: Full terminal lifecycle powered by `@xterm/xterm` and `@xterm/addon-fit`.
   - Handles PTY IO, keyboard keystroke forwarding, auto-fitting, and resize events.
   - Provides the keyboard-navigable `NewTerminalModal` (`Ctrl+B N`).
2. **`rail`**: Left-hand navigation panel matching Quay design:
   - Projects list with active project indicator (`▸`).
   - Terminals list with Run Kind icons (`claude`, `pwsh`, `› cmd`).
   - Permission mode pill badge (`SKIP` in red).
   - Live Claude status indicators (`Starting`, `Working`, `Waiting ◆`, `Idle`, `Exited`).
   - Auto-approved tool action counter.
3. **`stage`**: Main viewport area:
   - `SkipBanner`: Danger alert when running `--dangerously-skip-permissions`.
   - Active terminal viewport (maintains background terminals mounted so output buffers smoothly).
   - `StatusStrip`: Bottom status bar showing active tool (`Bash`, `FileEdit`), token usage, and turn duration.
   - `Placeholder`: Displays when no terminals are active in the open project.
4. **`bridge`**: Real-time telemetry:
   - `ActionLogDrawer`: Slide-over audit history of all tool executions with destructive command detection (`rm -rf`, `git push --force`).
5. **`orchestrator`**: A2A Mission Control modal:
   - Dispatch tasks between peer Claude Code agents.
   - Broadcast announcements to all active sessions.

---

## Keyboard Shortcuts

- `Ctrl+B N`: Open New Terminal modal.
- `Ctrl+B 1` through `Ctrl+B 9`: Switch directly to Terminal 1..9.
- `Alt+1` through `Alt+9`: Alternative direct terminal switcher.
- `Esc`: Close open modals or drawers.

---

## Development

```powershell
# Install frontend packages
pnpm install

# Run desktop dev environment
pnpm tauri dev
```
