# Quay 2 (Tauri Edition)

Quay 2 is a high-performance Windows workspace and orchestrator for supervising and coordinating multiple autonomous AI agents (**Claude Code**, **Antigravity CLI**, **OpenAI Codex**, **Pi Coding Agent**, **Google Gemini CLI**, **xAI Grok**, **Aider**, **Kiro CLI**, **GitHub Copilot**, **OpenCode CLI**), **PowerShell**, and custom command sessions.

Built with **Tauri v2**, **Rust ConPTY (`portable-pty`)**, **xterm.js**, an embedded **`claude-mod-events`** HTTP bridge, an autonomous **A2A MCP bus**, and an integrated **Archon & Spec-Driven Development (SDD) Graph Inspector**, Quay 2 replaces the low-level multiplexer hacks of terminal multiplexers (`psmux`) with a native desktop interface.

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
   - Permission mode pill badge (`SKIP` in red) and the launch model (for example `sonnet-4-6`) when a terminal was started with `--model`.
   - Worktrees under each project start collapsed; a blue dot on the header marks one that hides the active terminal.
   - A compact tool row at the bottom (GitHub, sessions, audit, Archon, Machina, command palette, A2A) with the all-time spend beside it.
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

## Agent-to-Agent (A2A) Orchestration Guide

Quay 2 features a built-in **Agent-to-Agent (A2A) Orchestration Bus** powered by an embedded Model Context Protocol (MCP) server. Every Claude Code session spawned in Quay automatically connects to this loopback server (`http://127.0.0.1:<bridge_port>/mcp`) via `--mcp-config`.

This enables running Claude agents to **autonomously discover peers, delegate tasks, wait for answers, and broadcast notices** across terminals without human relaying.

### Native MCP Tools Exposed to Claude Code

Every Claude session in Quay has access to these 4 tools out of the box:

| Tool Name | Description |
| :--- | :--- |
| `quay_list_agents` | Lists all active agents in Quay, including terminal IDs, names, current run status (`working`, `idle`, `waiting`), and active project paths. |
| `quay_send_message` | Sends a prompt or task delegation to another agent. If `wait_for_reply: true` (default), waits up to 60s for the peer to complete their turn and returns their reply into the caller's context window. |
| `quay_broadcast` | Dispatches a toast notification or broadcast banner across all running Claude sessions simultaneously. |
| `quay_get_agent_status` | Returns real-time health, auto-approved tool count, and active tool execution state for a specific peer agent. |

---

### Step-by-Step Instructions

#### Option A: Autonomous A2A Collaboration (Hands-Off)

1. **Launch Your Agents**:
   - Open two or more terminals in Quay (e.g., using the **Swarm Presets** via `Ctrl+B S`, or manually with `Ctrl+B N`).
   - For example: Term 1 named `frontend-agent` and Term 2 named `backend-agent`.
2. **Instruct an Agent to Collaborate**:
   - In Term 1's terminal prompt, instruct Claude:
     ```text
     "List your peer agents using quay_list_agents, then ask the backend-agent to verify our database schema."
     ```
3. **Autonomous Execution**:
   - Claude automatically calls `quay_list_agents` to resolve the terminal ID of `backend-agent`.
   - Claude calls `quay_send_message` with `target_terminal_id` and the request.
   - Quay injects the prompt into `backend-agent`'s session.
   - When `backend-agent` finishes its turn, its response is automatically routed back to `frontend-agent`.

#### Option B: Operator Mission Control (UI-Assisted)

1. **Open the A2A Panel**:
   - Click the **A2A Orchestration Bus** icon (the network icon at the right end of the tool row at the bottom of the Navigation Rail), or press `Ctrl+K` and select **"A2A Orchestration Bus"**.
2. **Configure Your Dispatch**:
   - **From**: Select the sending terminal (or check **"Dispatch as User"** to send as the human supervisor).
   - **To**: Select the recipient terminal.
   - **Message**: Type the task description or query.
3. **Dispatch & Monitor**:
   - Click **"Dispatch Task"** (or press `Ctrl+Enter`).
   - The message feed updates in real time with live status badges (`pending`, `dispatched`, `completed`).
   - When the target agent finishes, the response card expands with the full output and a 1-click **Copy Response** button.

---

### 3 Practical Examples

#### Example 1: Autonomous Code Review & Pre-PR Gate Handoff
> **Goal**: Have your developer agent finish a feature and autonomously hand off the diff to a dedicated reviewer agent for security and quality verification before opening a PR.

1. Spawn a **"TDD Swarm"** (`Ctrl+B S` -> TDD Swarm) or two Claude terminals: `feature-dev` and `code-reviewer`.
2. In `feature-dev`, give your development prompt:
   ```text
   Implement the new session resume command in src/slices/sessions/commands.rs. 
   When finished, use quay_list_agents to find 'code-reviewer', send them the list 
   of modified files using quay_send_message, and wait for their review findings.
   ```
3. **What Happens Behind the Scenes**:
   - `feature-dev` finishes coding and inspects active agents via `quay_list_agents`:
     ```json
     { "name": "code-reviewer", "terminal_id": "term-2", "status": "idle" }
     ```
   - `feature-dev` executes `quay_send_message`:
     ```json
     {
       "target_terminal_id": "term-2",
       "message": "I've updated src/slices/sessions/commands.rs. Please review for error handling and memory leaks.",
       "wait_for_reply": true
     }
     ```
   - `code-reviewer` wakes up, inspects the diff, runs `cargo check` and `cargo test`, and outputs its review.
   - `feature-dev` receives the reply directly, fixes any flagged issues, and confirms completion.

---

#### Example 2: Full-Stack Pair Programming (Rust Backend + React Frontend)
> **Goal**: Dual-agent coordinated development where the backend agent implements an API endpoint, and then hands the type definitions and instructions to the frontend agent to build the UI.

1. Launch the **"Full-Stack Pair"** preset (`Ctrl+B S` -> Full-Stack Pair), which sets up a side-by-side split (`Ctrl+B %`) with `backend-agent` and `frontend-agent`.
2. In `backend-agent`, enter:
   ```text
   Implement a new Tauri IPC command 'get_audit_report' in src-tauri/src/slices/audit/commands.rs.
   Once compiled, notify the 'frontend-agent' via quay_send_message with the exact TypeScript
   interface and instruction to build the AuditModal.tsx component.
   ```
3. **What Happens Behind the Scenes**:
   - `backend-agent` writes the Rust code and verifies it with `cargo test`.
   - `backend-agent` triggers `quay_send_message`:
     ```json
     {
       "target_terminal_id": "frontend-agent-id",
       "message": "The 'get_audit_report' command is live. TypeScript interface:\nexport interface AuditReport { passed: boolean; violations: AuditViolation[]; }\nPlease build the modal in src/slices/audit/AuditModal.tsx.",
       "wait_for_reply": false
     }
     ```
   - `frontend-agent` immediately receives the prompt, creates `src/slices/audit/AuditModal.tsx`, and imports the types without any manual copy-pasting from the operator.

---

#### Example 3: Supervisor Broadcast & Database Migration Alert
> **Goal**: The human operator (or a lead architect agent) needs to alert all running Claude sessions of an updated database schema or shared dependency change.

1. Press `Ctrl+K` -> **"A2A Orchestration Bus"** (or click the bottom Rail button).
2. Switch to the **"Broadcast"** tab.
3. Enter the notice:
   ```text
   Notice: Database schema updated to v2.4 (migration 004 applied). Please pull latest changes and run 'pnpm install' before continuing.
   ```
4. Click **"Broadcast Notice"**.
5. **What Happens Behind the Scenes**:
   - Quay dispatches a non-intrusive toast notification and event banner to every active Claude Code terminal.
   - All active agents log the system message into their telemetry feed without aborting their currently running commands.
   - Alternatively, an agent can perform this autonomously at any time by calling `quay_broadcast({ text: "..." })`.

---

## Complete Keyboard Shortcuts Reference

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+B N` | Open New Terminal modal |
| `Ctrl+B 1` .. `9` | Switch directly to Terminal 1 through 9 |
| `Alt+1` .. `9` | Alternative quick terminal switcher |
| `Ctrl+B %` | Split Stage side-by-side (Horizontal split) |
| `Ctrl+B "` | Split Stage top-and-bottom (Vertical split) |
| `Ctrl+B G` | 2x2 Quad Grid layout |
| `Ctrl+B Z` | Toggle Zoom on the active pane (Full screen toggle) |
| `Ctrl+B O` | Cycle focus to the next pane |
| `Ctrl+B X` | Unsplit / Return to single active pane |
| `Ctrl+B S` | Open 1-Click Multi-Agent Swarm Preset modal |
| `Ctrl+B D` | Open Visual Git Diff & File Changes Inspector |
| `Ctrl+B W` | Open Git Worktree Creation modal |
| `Ctrl+B I` | Open GitHub Companion drawer (Issues & PR triage) |
| `Ctrl+B A` | Run Pre-PR Audit Gate scanner (Secret & Leak scanner) |
| `Ctrl+B H` | Open Claude Session History & Auto-Resume drawer |
| `Ctrl+B T` | Open Live Token Spend Meter & Turn Chime settings |
| `Ctrl+B R` | Open Archon & SDD Graph Inspector (DAGs, spec tasks, ADRs) |
| `Ctrl+K` | Open Global Command Palette |
| `Esc` | Close any open modal or drawer |

---

## Development

```powershell
# Install frontend packages
pnpm install

# Run desktop dev environment
pnpm tauri dev
```
