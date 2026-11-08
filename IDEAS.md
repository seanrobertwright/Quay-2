# Quay 2 — Ideas & Feature Roadmap

This document captures the strategic features, architectural proposals, and future ideas identified for **Quay 2**. 

---

## 1. Status Overview

### ✅ Implemented Capabilities
* **Expanded Multi-Agent Engine**: Unified terminal support for **10 first-class AI coding agents**: **Claude Code**, **Antigravity CLI**, **Codex CLI**, **Pi Coding Agent**, **Google Gemini CLI**, **xAI Grok CLI**, **Aider Pair Programmer**, **Kiro CLI**, **GitHub Copilot CLI**, and **OpenCode CLI** with authentic brand iconography, model presets, thinking level selectors, and auto-approval modes.
* **Archon & Spec-Driven Development (SDD) Graph Inspector (`Ctrl+B R`)**: Interactive task dependency DAG viewer connecting to local Archon service (`http://127.0.0.1:3090` / `3737`), parsing project specification files (`SPEC.md`, `CONTEXT.md`, `IDEAS.md`), visualizing Architecture Decision Records (`docs/adr/`), and providing 1-click **"Assign to Agent"** and **"Run Workflow"** execution.
* **Autonomous Agent-to-Agent (A2A) Bus**: Built-in loopback MCP server (`http://127.0.0.1:<port>/mcp`) exposing `quay_list_agents`, `quay_send_message`, `quay_broadcast`, and `quay_get_agent_status` for autonomous peer collaboration without human relays.
* **1-Click Multi-Agent Swarm Presets**: Dev & Watcher, TDD Swarm, Full-Stack Pair, Bug Hunter, Red/Blue Team, Tri-Agent Council, and Polyglot Agent Trio layouts.
* **Git Worktrees**: 1-click isolated worktree provisioning and Claude Code auto-launch.
* **Pre-PR Audit Gate**: Secret and API key leak detection before opening PRs (`Ctrl+B A`).
* **Session History & Auto-Resume**: Direct session inspection with `--resume <id>` relaunching (`Ctrl+B H`).
* **Live Spend Meter & Audio Chimes**: Token cost tracking and audible turn completion notifications (`Ctrl+B T`).
* **GitHub Companion**: Drawer for triage of open issues and PRs (`Ctrl+B I`).
* **Terminal Session State & Scrollback Persistence Across Restarts**: Persistent storage of session metadata in `%LOCALAPPDATA%\Quay2\sessions\sessions.json` and real-time streaming of ANSI/color scrollback logs to `<session_id>.log`. Reopening Quay 2 automatically restores dormant sessions with their complete historical scrollback, and features a 1-click **"Relaunch Agent"** button in both `TerminalView` and `Rail` to instantly resume work in the same project directory.
* **Terminal Engine Stabilization**: Fixed ConPTY UTF-8 character boundary panics, single-layout pane switching, duplicate CPR `CC` input injection, and automatic `Starting... -> Ready` status transitions.
* **Topos Git Graph**: GitKraken-style commit graph, staging inspector, and git operations inside Quay (v1 finished 2026-11-01). This covers notebook idea 4 below, and the dual-pane diff and conflict resolver: a Split diff view with hunk and line staging (#416, #419) and a three-pane conflict resolver (#424).
* **Error Logs & Panic Capture**: Quay writes daily `quay.*.log` files to the `logs` folder in its data folder, keeping the newest seven, and a panic hook records the panic to `crash.log` before the release build aborts. **Open logs folder** in the command palette opens them (#498). This covers notebook idea 6 below.

---

## 2. Leftover Proposed Features (Strategic Roadmap)

During the analysis of your local Claude Code session logs across `AI-WS-SDK`, `claude-mods`, `AIC-reader`, and `fpv`, **3 major strategic features** were recommended. Because priorities shifted to resolving terminal engine bugs and multi-agent CLI support, these features remain on the roadmap:

---

### Feature 1: Visual "What's Next?" Pipeline Runner & 1-Click Action Board

#### Overview
A dedicated workflow stage and side-drawer in Quay 2 that visualizes a project's end-to-end SDLC pipeline:

$$\text{Grill / Wayfinder} \longrightarrow \text{to-spec} \longrightarrow \text{to-tickets} \longrightarrow \text{implement (TDD)} \longrightarrow \text{code-review} \longrightarrow \text{PR}$$

Quay inspects the active project's git branches, open PRs, and test suites to compute the next recommended actions. Instead of requiring you to manually copy-paste prompt text, Quay displays **interactive, 1-click executable action cards** that can inject prompts directly into any running terminal pane via the A2A bus or ConPTY writer.

#### Log Evidence & User Rationale
* **Ubiquitous `/ask-sean` invocation**: Across your session logs in `AI-WS-SDK`, `claude-mods`, and `Quay-2`, the prompt executed most frequently was `/ask-sean`:
  > *"What's next? Read the project's state as you normally would. Then, instead of a single recommendation, list the next steps in my workflow in the order I should take them... Prompt = `<ready-to-paste prompt>`"*
* **Friction with manual prompt copying**: In `claude-mods` session `e6799823`, you noted: *"whats-next skill: when I click an item in the panel, the prompt does not open up for me to copy."* In `fpv`, you experienced manual context-switching friction (*"shit, I did not mean to cancel!!"*).
* **Quay Fit**: Quay already has the ConPTY stdin pipe and the `A2APanel` dispatcher. Bringing the pipeline into a first-class React slice eliminates manual prompt copy-pasting and lets you advance your multi-step SDLC with a single click.

#### Proposed Architecture
* **Frontend Slice**: `src/slices/pipeline/` (`PipelineBoard.tsx`, `ActionCard.tsx`).
* **Backend Command**: `get_pipeline_state(projectPath)`:
  - Checks git branch status and uncommitted diffs.
  - Detects existing spec files (`SPEC.md`, `CONTEXT.md`, `docs/adr/`).
  - Scans recent test outcomes and open GitHub issues.
  - Returns ordered actionable cards with pre-filled target prompts.
* **Dispatch Action**: Clicking **"Run Step"** routes the prompt into the currently active or designated agent terminal.

---

### Feature 2: Archon & Spec-Driven Development (SDD) Graph Inspector [COMPLETED ✅]

#### Overview
An interactive task dependency graph (DAG) viewer embedded inside Quay 2 (`Ctrl+B R`). It connects to your local Archon service (`http://127.0.0.1:3090` or `3737`) and parses repo specification files (`SPEC.md`, `CONTEXT.md`, and `docs/adr/`). 

Selecting any node on the graph displays the spec requirements, dependency status (blocked vs. ready to start), and provides a 1-click **"Assign to Agent"** button that launches or routes the task to a specific Claude Code, Antigravity, or Codex terminal pane.

#### Log Evidence & User Rationale
* **Archon setup & UI frustrations**: In sessions `1ba47b6b` and `56cf6684`, you installed Archon (`github.com/coleam00/Archon`), set it up as a persistent Windows service, installed the `archon-panel` plugin, and explicitly requested:
  > *"I feel like the Archon Mod can use some refinement - the graph does not look very good. Is there any way to add some alignment code so that it displays more elegantly?"*
* **Kiro-IDE Spec-Driven analysis**: In `AIC-reader` session `e8a47b72`, you reverse-engineered Kiro-IDE's `.asar` packages:
  > *"explain how spec-driven and test-driven development work in Kiro-IDE... analyze the asar files. I need to understand how Kiro does its spec development / creation."*
* **Quay Fit**: Terminal emulators and basic webviews struggle to render clean, readable dependency DAGs. Quay 2 is a native desktop application with full SVG and React layout engines. Hosting the Archon/Kiro-style task graph inside Quay gives you clean visual alignment while directly linking task nodes to active `TerminalView` instances.

#### Proposed Architecture
* **Frontend Slice**: `src/slices/archon/` (`ArchonGraphModal.tsx`, `NodeDetailsPanel.tsx`).
* **Graph Engine**: Lightweight SVG DAG layout (or `@xyflow/react` / Dagre) matching Quay's GitHub dark design system.
* **Backend Slice**: `src-tauri/src/slices/archon/`:
  - Proxy client querying local Archon endpoints on port 3737.
  - Local spec file parser for markdown tasks (`- [ ]`, `- [x]`).

---

### Feature 3: "System One" Local LLM Sidecar & Laya/Jev Lifecycle Supervisor

#### Overview
A local model supervisor embedded in Quay 2's Rust backend that manages the lifecycle of local loopback endpoints (such as `laya-serve` or local Ollama instances) and provides a secure proxy for cloud fallback models (Jev / Anthropic / OpenAI).

Quay performs automatic health checks (`GET /openapi.json` or `/v1/models`), starts/stops the local server as needed, and exposes a unified local MCP tool (`quay_system_one_eval`) for fast, zero-token tasks (e.g., instant terminal turn summarization, destructive command screening, or quick-replies).

#### Log Evidence & User Rationale
* **Process persistence mismatch**: Across `claude-mods` issues [#79, #80, #82, #85, #86, #87, and #88](https://github.com/seanrobertwright/claude-mods/issues), you spent numerous sessions solving the operational boundaries of System One models:
  * Issue #86: *"What counts as 'Laya is installed', and who starts the server?"*
  * Issue #82: *"a spawned laya-serve dies with the session."*
  * Issue #87: Local model precedence first, hosted model only by explicit choice.
  * Issue #85: Managing where the API key lives.
* When `laya-serve` is launched inside individual terminal tabs, the server terminates as soon as that tab exits or restarts.
* **Quay Fit**: Quay 2's backend already runs an embedded Axum loopback server in `src-tauri/src/slices/bridge/server.rs`. Quay is the natural desktop process supervisor to keep `laya-serve` alive independently of terminal lifecycles and route quick local evaluations without API costs.

#### Proposed Architecture
* **Backend Daemon**: `src-tauri/src/slices/system_one/`:
  - Process supervisor for `laya-serve` (spawns hidden child process, watches health, auto-restarts on crash).
  - Configurable port and model selection in project settings.
* **MCP Integration**: Register `quay_system_one_eval` in Quay's MCP server for running fast sub-tasks without incurring Claude API token fees.
* **UI Controls**: Status pill in Rail/StatusStrip showing local model status (e.g., `Laya: Ready (Qwen2.5-7B)`).

---

## 3. Additional Future Ideas & Enhancements

Beyond the three strategic features above, several tactical enhancements have emerged during daily use:

### 1. Terminal Session State Persistence Across App Restarts [COMPLETED ✅]
* **Implementation**: Persists session metadata to `%LOCALAPPDATA%\Quay2\sessions\sessions.json` and streams ANSI output to `<terminal_id>.log`. Restores dormant sessions with full scrollback in `xterm.js` on app launch with 1-click **"Relaunch Agent"** functionality.

### 2. Dual-Pane Visual Diff & Merge Conflict Resolver [COMPLETED ✅]
* **Implementation**: Built in Topos (`Ctrl+Shift+B C`). The staging inspector opens a diff with a Split toggle, Stage hunk and Unstage hunk, and line staging (#416, #419). Conflicted files open in a three-pane resolver from the inspector's Conflicts list, non-text conflicts get side-picker cards, and a conflicted file can be handed to an agent (#424, #425, #427).

### 3. Customizable Shortcut Manager & Keybinding Re-mapper
* **Current Behavior**: Shortcuts are hardcoded to tmux-style conventions (`Ctrl+B <key>`).
* **Proposed Enhancement**: An interactive Settings tab to customize chord prefixes (e.g., `Ctrl+A`, `Alt+Q`, or `Cmd+B` on macOS) and customize keybindings.

### 4. Token Spend Budget Guardrails & Hard Caps
* **Current Behavior**: Live token spend meter tracks cumulative cost and displays it in the Rail.
* **Proposed Enhancement**: Allow setting a per-session or per-day spending limit (e.g., $10.00/day). If an agent loop approaches the cap, Quay pauses the session and triggers an alert.

---

## 4. Notebook Ideas (added 2026-11-07)

Two notebook pages, kept in `.ideas/`. The numbers are the notebook's own.

### Ideas to explore

* **1.** **Praxis server, with a backend UI and an Android app.** It reads as a
  server that lets Quay be reached away from the desk, which is also what
  idea 3 needs.
* **2.** **Agentic group chat.** Create an orchestrated "chat room" for agents. The
  user picks how many agents and states the problem, and a chat-room window
  opens so the user can watch. Example: ten agents asked to "recommend
  improvements to the codebase".
  * The orchestrator opens with "OK team, how do you suggest we approach
    this problem?"
  * Every agent recommends how it would tackle the problem.
  * The team reaches consensus and begins the work.
  * Builds on the A2A bus and the Tri-Agent Council preset.
* **3.** **Quay mobile app for Android, built with Tauri.** Quay's core is Windows
  ConPTY terminals, so a phone app is a remote client for a desktop Quay.
  It depends on a server like idea 1.
* **4.** **GitKraken-like functionality ("GitKraken in Quay", or GiQ).** Done as
  Topos; see the status overview.
* **5.** **Observability in Quay.** May belong to AI-WS-SDK: the SDK provides the
  framework and Quay does the implementation. Plan it with the AI-WS-SDK
  side, now that idea 6 gives Quay logs to observe.
* **6.** **Debugging and logging of errors: error logs.** Done in #498; see
  the status overview. Quay used to log only to stdout, which a packaged
  Windows app never shows, and `panic = "abort"` left no message.

### Features

* **7.** **Open-project dialog: double-click opens a folder, not the project.**
  Double-clicking a folder in `OpenProjectDialog` should show its
  sub-directories. Only the "Open" button opens the project. (The top of the
  page is cut off; this is the legible part.) Ticket #512.
* **8.** **A context menu for each area.** Only the Topos graph and the Praxis
  builder have context menus today. Planned in spec #506: menus for project,
  worktree, and terminal rows in the Rail, for pane headers, and for the
  terminal body, on one shared menu, and no browser menu on right-click
  anywhere else. Tickets #507 to #511.
* **9.** **Run PowerShell with administrator privileges.** An elevated process
  cannot run inside a terminal owned by a non-elevated Quay, so this needs
  an elevated helper and a clear marker on elevated panes. Treat it as a
  security feature and design it before building.
* **10.** **Drag and drop.** Projects should be draggable, and so should terminals.
   Nothing in Quay is draggable today.
* **11.** **An attention queue.** One list of every session waiting for the user
   (permission prompts, questions, finished turns, Archon approvals), oldest
   first. Today the only signal is a chime.

---

## 5. Priority Recommendation

Re-prioritized 2026-11-07 across the whole backlog, and updated the same day
when error logs and the diff and conflict resolver were done. Effort is S, M
or L.

| Priority | Feature | Effort | Why this rank |
| :--- | :--- | :--- | :--- |
| **P1** | **Attention queue** (idea 11) | M | With several agents and Archon runs at once, a missed prompt stalls work. The bridge already raises an event, with a chime, when a session asks for permission. |
| **P2** | **Context menus** (idea 8) and **open-project double-click** (idea 7) | S–M | Daily friction in the core UI; small, independent changes. Specified in #506 (tickets #507 to #511) and #512; start with #507. |
| **P3** | **Visual "What's Next?" Pipeline Runner** | M | Removes prompt copy-pasting from the `/ask-sean` workflow. Its cards can feed the attention queue. |
| **P4** | **Drag and drop** for projects and terminals (idea 10) | M | Layout comfort; needs a decision on what a drop changes (order, pane, worktree). |
| **P5** | **Agentic group chat** (idea 2) | L | High value, and builds on the A2A bus and council preset, but needs a design for turns, consensus, and cost limits. |
| **P6** | **Administrator PowerShell** (idea 9) | M–L | Needed for admin tasks such as the kill audit, but a security boundary; design first. |
| **P7** | **Observability** (idea 5) | L | Cross-repo with AI-WS-SDK; the error logs it builds on are done. |
| **P8** | **"System One" Laya Process Supervisor** | M | Still useful, but no current work depends on it. |
| **P9** | **Shortcut manager** and **spend budget caps** | S–M each | Nice to have. |
| **P10** | **Praxis server** (idea 1) and **Android app** (idea 3) | L | Largest scope; the server comes first. |

Done and removed from the ranking: the Archon & SDD Graph Inspector, session
scrollback persistence, GitKraken-like functionality and the dual-pane diff
and conflict resolver (both Topos), and error logs with panic capture (#498).
