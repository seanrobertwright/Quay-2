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

Pressing `Ctrl+B S` opens the **Swarm Launcher** dialog. With one click, Quay 2 automatically configures the split layout and launches the designated agents with optimized roles:

### 1. TDD Swarm (Test-Driven Development)
- **Layout**: Side-by-Side Horizontal Split (`50% / 50%`).
- **Terminal 1 (`tdd-spec-runner`)**: Focuses on authoring unit tests, integration tests, and running `cargo test` / `pnpm test`.
- **Terminal 2 (`tdd-impl-dev`)**: Observes test results, authors implementation code, and refactors until green.

### 2. Full-Stack Pair
- **Layout**: Side-by-Side Horizontal Split.
- **Terminal 1 (`frontend-agent`)**: Specializes in React, UI components, Tailwind CSS styling, and client-side state.
- **Terminal 2 (`backend-agent`)**: Specializes in Rust Axum endpoints, database schemas, IPC commands, and API contracts.

### 3. Red/Blue Team (Security & Resilience)
- **Layout**: Side-by-Side Horizontal Split.
- **Terminal 1 (`red-team-prober`)**: Analyzes code for input injection, credential leaks, edge cases, and authorization bypasses.
- **Terminal 2 (`blue-team-defender`)**: Implements sanitization, encryption, token checks, and defensive hardening.

### 4. Bug Hunter Swarm
- **Layout**: 2x2 Quad Grid (`4 panes`).
- **Terminal 1 (`reproducer`)**: Crafts minimal reproduction scripts and failing tests.
- **Terminal 2 (`tracer`)**: Analyzes execution traces, logs, and stack dumps.
- **Terminal 3 (`patcher`)**: Authors fix commits.
- **Terminal 4 (`verifier`)**: Runs regression suites across the entire repository.

---

## Smooth Buffer Persistence

Unlike web-based terminal emulators that destroy DOM nodes when hidden, Quay 2 maintains background terminal xterm instances in memory. When you switch between single view and multi-pane splits, your output buffers, scroll positions, and running processes remain completely intact without blinking or resetting.
