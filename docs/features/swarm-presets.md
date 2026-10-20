# Swarm Presets & Tiling Stage

Managing multiple terminal windows and remembering split hotkeys slows down autonomous engineering. **Quay 2** provides built-in **1-Click Multi-Agent Swarm Presets** and a flexible tiling window manager.

---

## Tiling Layout Modes

Quay 2's stage supports four distinct layout modes:

```text
┌─────────────────┐  ┌────────┬────────┐  ┌─────────────────┐  ┌────────┬────────┐
│                 │  │        │        │  │                 │  │   1    │   2    │
│                 │  │        │        │  ├─────────────────┤  ├────────┼────────┤
│     Single      │  │ Left   │ Right  │  │                 │  │   3    │   4    │
│      View       │  │ (50%)  │ (50%)  │  │                 │  │        │        │
└─────────────────┘  └────────┴────────┘  └─────────────────┘  └────────┴────────┘
    Default View      Horizontal Split      Vertical Split         2x2 Quad Grid
                        (Ctrl+B %)            (Ctrl+B ")            (Ctrl+B G)
```

- **Single View**: Standard focused terminal window.
- **Horizontal Split (`Ctrl+B %`)**: Divides the viewport side-by-side. Ideal for frontend/backend pair programming.
- **Vertical Split (`Ctrl+B "`)**: Divides the viewport top-and-bottom. Ideal for terminal execution above and test runners below.
- **2x2 Quad Grid (`Ctrl+B G`)**: Tiles 4 terminals simultaneously into a responsive 4-pane grid.
- **Toggle Zoom (`Ctrl+B Z`)**: Temporarily maximizes the active pane to 100% width/height. Pressing `Ctrl+B Z` again restores the previous multi-pane layout.
- **Cycle Focus (`Ctrl+B O`)**: Quickly cycles keyboard focus between visible panes.
- **Unsplit (`Ctrl+B X`)**: Closes extra split panes and restores single view.

---

## 1-Click Multi-Agent Swarm Presets (`Ctrl+B S`)

Pressing `Ctrl+B S` opens the **Swarm Launcher** dialog. With one click, Quay 2 configures the split layout and launches each agent in its own terminal, labelled with its session name. The launcher lists the built-in presets in this order and selects the first one, Dev & Watcher, when it opens. In a 2x2 grid the agents fill the panes in launch order: top-left, top-right, bottom-left, bottom-right.

Every agent whose CLI takes a launch prompt starts with a role prompt in four parts: who it is, what it owns, what it leaves to teammates, and how it works. Each role prompt ends with the same teammate clause: "Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to." Shells and Antigravity get no launch prompt, so they get no role prompt.

### 1. Dev & Watcher
- **Layout**: Side-by-side split.
- **`lead-dev`** (Claude Code, left): the Lead Developer, who makes the code changes you ask for.
- **`build-watcher`** (PowerShell, right): a shell for running the build or tests in watch mode.

### 2. TDD Swarm
- **Layout**: 2x2 grid.
- **`test-architect`** (Claude Code, `--model claude-sonnet-5-5`): edits only `test/`, never `src/`.
- **`feature-impl`** (Claude Code): edits only `src/`, never `test/`.
- **`test-runner`** (PowerShell): a shell for running the tests.
- **`reviewer`** (Claude Code): edits nothing and only replies.
- The three agents read `AGENTS.md` before they start and wait for you between tasks.

### 3. Full-Stack Pair
- **Layout**: Side-by-side split. Both agents run with `--model claude-sonnet-5-5`.
- **`backend-agent`** (Claude Code, left): owns the server side and any API contract the project defines.
- **`frontend-agent`** (Claude Code, right): owns the UI, builds against the contract and never changes it.
- The role prompts name halves, not folders: which folders each agent owns comes from the project's `AGENTS.md`.

### 4. Bug Hunter
- **Layout**: 2x2 grid.
- **`reproducer`** (Claude Code, top-left): edits only `test/`, writing tests that fail on the current code and show the symptom as reported.
- **`tracer`** (Claude Code, top-right): writes only `TRACE.md`, naming the code that causes each failing test.
- **`patcher`** (Claude Code, bottom-left): edits only `src/`, with the smallest change that makes `npm test` pass.
- **`verifier`** (Claude Code, bottom-right): edits nothing, runs the commands itself and writes `VERDICT.md`.

### 5. Red/Blue Team
- **Layout**: Side-by-side split.
- **`red-team`** (Claude Code, left): edits only `test/exploits/`, writing tests that are red while a hole is open.
- **`blue-team`** (Claude Code, right): edits only `server/` and `.gitignore`, never weakens a test, and stops to say so when it believes a test is wrong.
- Neither agent commits.

### 6. Tri-Agent Council
- **Layout**: 2x2 grid.
- **`planner-agent`** (Claude Code): writes only `PLAN.md`, from `SPEC.md` and `AGENTS.md`.
- **`builder-agent`** (Claude Code): edits only `src/` and `test/`, following `PLAN.md`.
- **`verifier-agent`** (Claude Code): edits nothing, runs the commands itself and compares the output with `SPEC.md`.
- **`terminal-shell`** (PowerShell): a shell for the workspace.

### 7. Polyglot Agent Trio
- **Layout**: 2x2 grid.
- **`claude-dev`** (Claude Code): edits only `src/` and `test/`, following `PLAN.md`.
- **`agy-planner`** (Antigravity): gets no launch prompt, so you give it its role in its first message. It answers when asked but can't start a conversation, and hands its plan back as a file.
- **`codex-reviewer`** (Codex): edits only `review.md`, reviewing against `SPEC.md`.
- **`test-runner`** (PowerShell): a shell for running the tests.
- A reply from `agy-planner` holds at most 199 characters, so a longer answer goes through a file mailbox: the job is done when `agy-planner` is Idle and the agreed last line is in the file.

---

## Smooth Buffer Persistence

Unlike web-based terminal emulators that destroy DOM nodes when hidden, Quay 2 maintains background terminal xterm instances in memory. When you switch between single view and multi-pane splits, your output buffers, scroll positions, and running processes remain completely intact without blinking or resetting.
