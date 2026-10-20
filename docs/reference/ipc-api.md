# Tauri IPC API Specification

This document details the primary asynchronous commands exposed by the Rust backend to the React frontend via Tauri's IPC mechanism (`@tauri-apps/api/core::invoke`).

---

## 1. ConPTY & Terminal Lifecycle (`pty`)

### `spawn_terminal`
Spawns a new native Windows ConPTY terminal session.
- **Arguments**:
  - `project_path`: string
  - `command`: string (e.g. `"claude"`, `"pwsh"`, `"cmd"`)
  - `custom_flags`: optional string
  - `model`: optional string (e.g. `"claude-opus-5-5"`)
  - `skip_permissions`: boolean
  - `name`: optional string
  - `cols`: number
  - `rows`: number
- **Returns**: `TerminalInfo`

### `write_pty`
Writes raw keystrokes or input text into a running ConPTY process.
- **Arguments**:
  - `id`: string (terminal ID)
  - `data`: string

### `resize_pty`
Synchronizes the ConPTY buffer dimensions when the frontend xterm element resizes.
- **Arguments**:
  - `id`: string
  - `cols`: number
  - `rows`: number

### `kill_terminal`
Terminates a ConPTY session and forcefully closes child process trees.
- **Arguments**:
  - `id`: string

### `dismiss_plugin_hint`
Hides the plugin hint in a Claude terminal's pane until the terminal is relaunched. The terminal's status stays as it was. The backend sends the result as a `terminal-status` event (`terminal_id`, `claude_status`, `plugin_hint`), the same event it sends when a plugin event or 30 silent seconds move a terminal's status.
- **Arguments**:
  - `terminalId`: string

---

## 2. GitHub Companion (`github`)

### `list_github_issues`
Retrieves open or closed issues using `gh issue list`, augmented with GraphQL `blockedBy` dependencies.
- **Arguments**:
  - `repo_path`: string
  - `state`: optional string (`"open"` | `"closed"`)
  - `limit`: optional number
- **Returns**: `Vec<GithubIssue>`

### `get_github_issue`
Fetches detailed issue body and blocking issue references.
- **Arguments**:
  - `repo_path`: string
  - `issue_number`: number
- **Returns**: `GithubIssueDetail`

---

## 3. Token Analytics & Sessions (`sessions`)

### `get_claude_stats`
Scans all `.jsonl` transcript files in `~/.claude/projects/`, deduplicates `message.id` turns, and computes total token spend and session counts.
- **Arguments**: None.
- **Returns**: `ClaudeTokenStats`
  ```json
  {
    "total_sessions": 977,
    "total_input_tokens": 15420300,
    "total_output_tokens": 1890200,
    "total_cost_usd": 68.42,
    "model_breakdown": {
      "claude-opus-5-5": { "cost_usd": 48.20, "turns": 1288 },
      "claude-sonnet-5-5": { "cost_usd": 20.22, "turns": 450 }
    }
  }
  ```

---

## 4. Archon & SDD Workflows (`archon`)

### `get_archon_runs`
Fetches recent Archon workflow runs, active nodes, and completion statuses.
- **Arguments**: None.
- **Returns**: `Vec<ArchonRun>`

### `get_archon_run_detail`
Fetches full DAG graph topology, node inspector metadata, and ADRs for a specific run ID.
- **Arguments**:
  - `run_id`: string
- **Returns**: `ArchonRunDetail`
