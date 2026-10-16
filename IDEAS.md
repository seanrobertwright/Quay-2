# Quay 2 — Ideas & Feature Roadmap

This document captures the strategic features, architectural proposals, and future ideas identified for **Quay 2**. 

---

## 1. Status Overview

### ✅ Implemented Capabilities
* **Expanded Multi-Agent Engine**: Unified terminal support for **10 first-class AI coding agents**: **Claude Code**, **Antigravity CLI**, **Codex CLI**, **Pi Coding Agent**, **Google Gemini CLI**, **xAI Grok CLI**, **Aider Pair Programmer**, **Kiro CLI**, **GitHub Copilot CLI**, and **OpenCode CLI** with authentic brand iconography, model presets, thinking level selectors, and auto-approval modes.
* **Archon & Spec-Driven Development (SDD) Graph Inspector (`Ctrl+B R`)**: Interactive task dependency DAG viewer connecting to local Archon service (`http://127.0.0.1:3090` / `3737`), parsing project specification files (`SPEC.md`, `CONTEXT.md`, `IDEAS.md`), visualizing Architecture Decision Records (`docs/adr/`), and providing 1-click **"Assign to Agent"** and **"Run Workflow"** execution.
* **Autonomous Agent-to-Agent (A2A) Bus**: Built-in loopback MCP server (`http://127.0.0.1:<port>/mcp`) exposing `quay_list_agents`, `quay_send_message`, `quay_broadcast`, and `quay_get_agent_status` for autonomous peer collaboration without human relays.
* **1-Click Multi-Agent Swarm Presets**: Frontier Federation, TDD Swarm, Full-Stack Pair, and Multi-Agent Trio layouts.
* **Git Worktrees**: 1-click isolated worktree provisioning and Claude Code auto-launch.
* **Pre-PR Audit Gate**: Secret and API key leak detection before opening PRs (`Ctrl+B A`).
* **Session History & Auto-Resume**: Direct session inspection with `--resume <id>` relaunching (`Ctrl+B H`).
* **Live Spend Meter & Audio Chimes**: Token cost tracking and audible turn completion notifications (`Ctrl+B T`).
* **GitHub Companion**: Drawer for triage of open issues and PRs (`Ctrl+B I`).
* **Terminal Session State & Scrollback Persistence Across Restarts**: Persistent storage of session metadata in `%LOCALAPPDATA%\Quay2\sessions\sessions.json` and real-time streaming of ANSI/color scrollback logs to `<session_id>.log`. Reopening Quay 2 automatically restores dormant sessions with their complete historical scrollback, and features a 1-click **"Relaunch Agent"** button in both `TerminalView` and `Rail` to instantly resume work in the same project directory.
* **Terminal Engine Stabilization**: Fixed ConPTY UTF-8 character boundary panics, single-layout pane switching, duplicate CPR `CC` input injection, and automatic `Starting... -> Ready` status transitions.

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

### 2. Dual-Pane Visual Diff & Merge Conflict Resolver (`Ctrl+B D`)
* **Current Behavior**: Git Diff Inspector shows a unified diff view.
* **Proposed Enhancement**: Add a side-by-side diff view with 1-click stage/unstage buttons and conflict markers resolution for active git worktrees.

### 3. Customizable Shortcut Manager & Keybinding Re-mapper
* **Current Behavior**: Shortcuts are hardcoded to tmux-style conventions (`Ctrl+B <key>`).
* **Proposed Enhancement**: An interactive Settings tab to customize chord prefixes (e.g., `Ctrl+A`, `Alt+Q`, or `Cmd+B` on macOS) and customize keybindings.

### 4. Token Spend Budget Guardrails & Hard Caps
* **Current Behavior**: Live token spend meter tracks cumulative cost and displays it in the Rail.
* **Proposed Enhancement**: Allow setting a per-session or per-day spending limit (e.g., $10.00/day). If an agent loop approaches the cap, Quay pauses the session and triggers an alert.

---

## 4. Priority Recommendation

| Priority | Feature | Estimated Effort | Impact |
| :--- | :--- | :--- | :--- |
| **P1** | **Visual "What's Next?" Pipeline Runner** | Medium (1-2 days) | High — Eliminates frequent prompt copy-pasting; directly speeds up your core `/ask-sean` workflow. |
| **P2** | **"System One" Laya Process Supervisor** | Medium (1-2 days) | High — Solves the long-standing server lifecycle issue and enables free zero-token local evaluations. |
| **P3** | **Archon & SDD Graph Inspector** | High (2-3 days) | High — Provides the visual alignment and DAG clarity missing from the terminal Archon mod. |
| **P4** | **Dual-Pane Diff & Conflict Resolver** | Medium (1 day) | Medium — Enhances git workflow during worktree merges. |
| **P5** | **Session Scrollback Persistence** | Low-Medium (1 day) | Medium — Prevents lost terminal output when restarting the app. |
