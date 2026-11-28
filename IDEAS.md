# Quay 2 — Ideas & Feature Roadmap

This document captures the strategic features, architectural proposals, and future ideas identified for **Quay 2**. 

---

## 1. Status Overview

### ✅ Implemented Capabilities
* **Expanded Multi-Agent Engine**: Unified terminal support for **10 first-class AI coding agents**: **Claude Code**, **Antigravity CLI**, **Codex CLI**, **Pi Coding Agent**, **Google Gemini CLI**, **xAI Grok CLI**, **Aider Pair Programmer**, **Kiro CLI**, **GitHub Copilot CLI**, and **OpenCode CLI** with authentic brand iconography, model presets, thinking level selectors, and auto-approval modes.
* **Archon & Spec-Driven Development (SDD) Graph Inspector**: Interactive task dependency DAG viewer connecting to local Archon service (`http://127.0.0.1:3090` / `3737`), parsing project specification files (`SPEC.md`, `CONTEXT.md`, `IDEAS.md`), visualizing Architecture Decision Records (`docs/adr/`), and providing 1-click **"Assign to Agent"** and **"Run Workflow"** execution.
* **Autonomous Agent-to-Agent (A2A) Bus**: Built-in loopback MCP server (`http://127.0.0.1:<port>/mcp`) exposing `quay_list_agents`, `quay_send_message`, `quay_broadcast`, and `quay_get_agent_status` for autonomous peer collaboration without human relays.
* **1-Click Multi-Agent Swarm Presets**: Dev & Watcher, TDD Swarm, Full-Stack Pair, Bug Hunter, Red/Blue Team, Tri-Agent Council, and Polyglot Agent Trio layouts.
* **Git Worktrees**: 1-click isolated worktree provisioning and Claude Code auto-launch.
* **Pre-PR Audit Gate**: Secret and API key leak detection before opening PRs (`Ctrl+Shift+B a`).
* **Session History & Auto-Resume**: Direct session inspection with `--resume <id>` relaunching (`Ctrl+Shift+B h`).
* **Live Spend Meter & Audio Chimes**: Token cost tracking, a daily spend chart for the last 30 days, and audible turn completion notifications.
* **GitHub Companion**: Source control panel for triage of open issues and PRs (`Ctrl+Shift+B i`).
* **Terminal Session State & Scrollback Persistence Across Restarts**: Persistent storage of session metadata in `%LOCALAPPDATA%\Quay2\sessions\sessions.json` and real-time streaming of ANSI/color scrollback logs to `<session_id>.log`. Reopening Quay 2 automatically restores dormant sessions with their complete historical scrollback, and features a 1-click **"Relaunch Agent"** button in both `TerminalView` and `Rail` to instantly resume work in the same project directory.
* **Terminal Engine Stabilization**: Fixed ConPTY UTF-8 character boundary panics, single-layout pane switching, duplicate CPR `CC` input injection, and automatic `Starting... -> Ready` status transitions.
* **Topos Git Graph**: GitKraken-style commit graph, staging inspector, and git operations inside Quay (v1 finished 2026-11-01). This covers notebook idea 4 below, and the dual-pane diff and conflict resolver: a Split diff view with hunk and line staging (#416, #419) and a three-pane conflict resolver (#424).
* **Error Logs & Panic Capture**: Quay writes daily `quay.*.log` files to the `logs` folder in its data folder, keeping the newest seven, and a panic hook records the panic to `crash.log` before the release build aborts. **Open logs folder** in the command palette opens them (#498). This covers notebook idea 6 below.
* **Attention Queue**: One list of every session waiting on the user, with a badge, a drawer, answer-in-place permission prompts, and **Next Waiting Terminal** (`Ctrl+Shift+B q`). Spec #527, tickets #529 to #533. This covers notebook idea 11 below.
* **Context Menus & Open-Project Double-Click**: One shared context menu for Rail project, worktree and terminal rows, pane headers and the terminal body, with no browser menu elsewhere (spec #506, tickets #507 to #511). In the Open Project dialog, double-clicking goes into a folder and only **Open** opens the project (#512). This covers notebook ideas 7 and 8 below.

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
An interactive task dependency graph (DAG) viewer embedded inside Quay 2. It connects to your local Archon service (`http://127.0.0.1:3090` or `3737`) and parses repo specification files (`SPEC.md`, `CONTEXT.md`, and `docs/adr/`). 

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
* **Current Behavior**: Shortcuts are hardcoded to a tmux-style chord prefix, `Ctrl+Shift+B <key>` (`src/slices/workspace/ctrlBPrefix.ts`).
* **Proposed Enhancement**: First, a setting that picks the chord prefix (e.g., `Ctrl+A` or `Alt+Q`). Later, an interactive Settings tab that re-maps individual keybindings.

### 4. Token Spend Budget Guardrails & Hard Caps
* **Current Behavior**: Live token spend meter tracks cumulative cost and displays it in the Rail.
* **Proposed Enhancement**: Allow setting a per-day spending limit (e.g., $10.00/day). First step: when the day's spend crosses the limit, Quay raises an alert, for example an attention queue item and a chime. Later: per-session limits, and pausing a session that nears its cap.

### 5. Start the app maximized
* **Current Behavior**: The main window opens at 1280 × 800 (`src-tauri/tauri.conf.json`), and Quay does not remember the window's size or position between launches.
* **Proposed Enhancement**: Open the main window maximized. A later step could remember the last size, position and maximized state instead.

### 6. Status bar at the bottom of the window (like Orca's)
* **Current Behavior**: Quay has no status bar. The shell redesign removed the old status strip; pane headers and the module bar badges carry its signals now.
* **Reference**: Orca, which is installed on this machine, has a status bar along the bottom of its window. It can be shown or hidden from the View menu (**Show Status Bar**), shows usage meters for the agents you pick (Claude, Codex, Antigravity and others), and plugins can add up to eight items of their own that update live and run a command when pressed.
* **Proposed Enhancement**: A thin bar along the bottom of Quay's window, which can be turned off, showing the selected project and branch, the day's spend, agent usage and rate limits, the count of sessions waiting on you, and Archon server health. Each item opens its panel when pressed. Once the daily spend limit exists (enhancement 4), the spend item shows the day's total against it and changes color as it nears the limit, for example amber at 80% and red once over; the alert itself stays separate so it still fires when the bar is turned off. A later step could let plugins add items.

### 7. A dedicated Settings dialog, opened from the module bar
* **Current Behavior**: Quay has no Settings dialog. App-wide preferences live in the Project panel's **Quay · every project** group (pie palette, pie label outline, pie display delay, merge undo window, what the companion opens on, the turn chime) and in the command palette's **Preferences** commands. The panel's **This project** group also holds app-wide entries, **Token spend** and **Logs folder**, beside the project's own **Workspace settings** (environment variables and default flags).
* **Proposed Enhancement**: A Settings dialog for the whole app, opened from its own icon in the module bar (the icon bar on the window's left edge). The Project panel keeps only settings for the selected project. The dialog becomes the home for the app-wide settings other ideas add: the daily spend limit, the chord prefix, the status bar's items, the GitHub polling intervals, and how the window starts.

### 8. A resizable, collapsible side panel with a wider minimum
* **Current Behavior**: The panel beside the module bar, which shows the open module such as the Projects panel, is fixed at 280 px (`PANEL_WIDTH` in `src/slices/shell/ModulePanel.tsx`). That is too narrow for the Projects panel's header: its **Swarm**, **Term** and **Add** buttons sit beside the **Workspaces** label, and **Add** (add a project) gets cut off. The panel can already be folded, but only by clicking the open module's icon again, which is easy to miss. The companion on the other side already resizes with a draggable divider, between 340 and 560 px (`src/slices/companion/companionPrefs.ts`).
* **Proposed Enhancement**:
  * **Minimum width**: raise it so the whole Projects header fits. Recommended: **340 px**, the same minimum as the companion. Confirm it by checking that **Add** shows in full.
  * **Resizable**: a draggable divider on the panel's edge, built the same way as the companion's (drag, or arrow keys when focused), with the width saved between launches.
  * **Maximum width**: recommended **480 px**. On a 1280 px window that still leaves the stage about 410 px beside a companion at its 340 px minimum, which is about the narrowest a terminal stays usable. On a maximized 1920 px window it leaves over 1,000 px. A fixed cap is simpler than a share of the window and behaves the same on every screen.
  * **Collapsible**: a visible collapse button in the panel's header and a keyboard shortcut, alongside the existing click on the open module's icon. A collapsed panel leaves only the module bar.

### 9. A file explorer in the side panel
* **Current Behavior**: Quay shows no files. Seeing a project's folders means opening VS Code or Explorer.
* **Proposed Enhancement**: A file icon at the top of the side panel, in the Projects panel header, that opens the selected project's folder as a folder and file tree. Folders load their contents only when expanded, so a large repository stays fast, and long folders are capped or paged. Files that git ignores, such as `node_modules`, are hidden or dimmed. Picking a file could open it in VS Code or in the companion; the tree could later show each file's git status.

### 10. Source control follows the selected project at once (critical)
* **Current Behavior**: Switching projects often leaves the Source control module showing the previous repository for a long time. Each switch starts three fresh `gh` processes (repo info, pull requests, issues) with no cache, the previous repository's lists stay on screen until the new answers arrive, and nothing loads while the module is closed.
* **Proposed Enhancement**: On every project switch, clear the previous repository's lists at once and show a loading message with the new repository's name and a spinner until fresh data arrives; never show one repository's lists under another's name. Start loading on the switch itself, even while the module is closed. The spinner is a ThinkingOrbs orb (enhancement 12); a plain spinner stands in until that port lands.

### 11. GitHub views update themselves, with a refresh button as backup
* **Goal**: Every part of Quay that shows GitHub data (the Source control lists, the open pull request count, the companion's issue and pull request views, the Projects panel's ticket pipeline lanes) updates by itself when an issue closes, a pull request merges, or commits are pushed to GitHub. Only the selected project stays live; other projects refresh when you switch to them.
* **Webhooks first**: GitHub can only push events to a public address, so Quay uses the official `gh webhook forward` extension (`cli/gh-webhook`). While it runs, it creates a temporary webhook on the repository and relays `issues`, `pull_request` and `push` events to Quay over a connection it holds open; the webhook goes away when it stops. Requirements: admin or owner rights on the repository (automatic on your own repositories), a `gh` login allowed to manage webhooks (the `repo` scope you already have should cover repository webhooks; confirm on the first run), and the extension installed once. An organization owner can forward one org-wide webhook for every repository in the org with the `admin:org_hook` scope. Limits: GitHub calls it a testing tool, and only one forwarder may run per repository at a time, so a second Quay, or anyone else, gets "Hook already exists". Quay supervises the forwarder for the selected project and moves it on each switch.
* **Polling as backup**: Whenever webhooks are unavailable (not an admin, another forwarder holds the repository, the forwarder stopped, or during a project switch), Quay polls instead. Defaults: every **15 s** while Quay is in front and **60 s** in the background, paused while minimized, with both intervals in the Settings dialog (enhancement 7). Quay also refreshes at once on a project switch, when the window regains focus, and after its own actions such as a merge. Polling uses a direct HTTP client with conditional requests (`If-None-Match` with the last ETag), not a new `gh` process each time; a `304 Not Modified` answer made with an authorized token does not count against the rate limit. Two small requests per tick cover it: the issues list sorted by last update (it includes pull requests, so a close or a merge shows up there) and the default branch's latest commit.
* **Mode marker**: A quiet **Live** or **Polling 15 s** marker in the Source control header shows which mode the selected repository is in; falling back to polling never interrupts you.
* **Fetch on push**: When a push to the selected repository is detected, Quay runs a background `git fetch` for that repository so Topos and the branch graph show the new commits. It never pulls, and never changes working files or local branches.
* **Refresh button**: Every GitHub view gets a refresh icon button with an accessible label, for the times the automatic update misses something.

### 12. ThinkingOrbs loading indicators
* **Source**: [ThinkingOrbs](https://github.com/haplollc/ThinkingOrbs), nine dotted loading indicators (Working, Searching, Solving, Listening, Connecting, Weaving, Composing, Breathing and Shaping), each in a regular and a small size. It is a SwiftUI library for Apple platforms under the MIT license, so Quay cannot use it directly.
* **Proposed Enhancement**: Port all nine designs to a TypeScript React component drawn on canvas or SVG, keeping the MIT copyright notice. Keep the library's behavior: grayscale dots that suit Quay's dark theme, pausing offscreen, and a still frame when the system asks for reduced motion. First use: the loading state on a project switch (enhancement 10), with **Connecting** a natural fit for GitHub loads. Other loading states, such as an agent thinking or an Archon run starting, can pick their own design.

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
  Done in #512; see the status overview.
* **8.** **A context menu for each area.** Done in spec #506 (tickets #507 to
  #511); see the status overview.
* **9.** **Run PowerShell with administrator privileges.** An elevated process
  cannot run inside a terminal owned by a non-elevated Quay, so this needs
  an elevated helper and a clear marker on elevated panes. Treat it as a
  security feature and design it before building.
* **10.** **Drag and drop.** Projects should be draggable, and so should terminals.
   Nothing in the Projects panel is draggable today. Reordering projects is the small
   first step; dragging terminals between panes or worktrees needs a decision
   on what a drop changes.
* **11.** **An attention queue.** Done in spec #527 (tickets #529 to #533); see
   the status overview.

---

## 5. Priority Recommendation

Re-prioritized 2026-11-28, after the attention queue, context menus and
open-project double-click were done. P1 comes first because it is critical
and small. The next items are the quickest to build: each is a small first
step on code that already exists. The rest are ranked by value against
effort. Effort is S, M or L.

| Priority | Feature | Effort | Why this rank |
| :--- | :--- | :--- | :--- |
| **P1** | **Source control follows the selected project** (enhancement 10) | S | Critical: today the module can show the wrong repository for a long time. Clear the old lists at once, show a loading message with the new repository's name, and start loading on the switch even while the module is closed. A plain spinner stands in until P9's orbs land. |
| **P2** | **Start the app maximized** (enhancement 5) | S | A one-line window setting in `src-tauri/tauri.conf.json`. Remembering the last size and position comes later. |
| **P3** | **Wider side panel minimum** (first step of enhancement 8) | S | Fixes the cut-off **Add** button today. One constant, `PANEL_WIDTH`, goes from 280 px to the recommended 340 px. |
| **P4** | **Refresh button on every GitHub view** (part of enhancement 11) | S | The backup for automatic updates, and useful on its own before they exist. Each view already has a load function to call. |
| **P5** | **Daily spend alert** (first step of spend budget caps, enhancement 4) | S | The spend meter already totals cost per day. Add one limit setting and raise an attention queue item and a chime when the day's total crosses it. Per-session caps and pausing come later. |
| **P6** | **Reorder projects by drag** (first step of drag and drop, idea 10) | S | One list in the Projects panel and one saved order; no decision about panes or worktrees yet. Dragging terminals comes later. |
| **P7** | **Resizable, collapsible side panel** (rest of enhancement 8) | S–M | The companion's divider is a working pattern to copy; add a saved width, the 480 px cap, and a collapse button and shortcut. |
| **P8** | **Configurable chord prefix** (first step of the shortcut manager, enhancement 3) | S–M | The prefix lives in one module, `src/slices/workspace/ctrlBPrefix.ts`. Make the key a setting with a small picker; per-key re-mapping comes later. |
| **P9** | **ThinkingOrbs loading indicators** (enhancement 12) | M | A port of nine designs from SwiftUI to a React component. Replaces P1's plain spinner, then serves every other loading state. |
| **P10** | **Settings dialog** (enhancement 7) | M | Gives every app-wide setting one home and leaves the Project panel to the selected project. Move the **Quay · every project** group, **Token spend** and **Logs folder** into it, and add a module bar icon. The settings that P5, P8 and P11 add move into it once it exists. |
| **P11** | **GitHub views update themselves** (rest of enhancement 11) | M–L | Polling first: a direct HTTP client with conditional requests, 15 s in front and 60 s in the background, fetch on push, and the **Live** or **Polling** marker. Then the `gh webhook forward` supervisor for repositories you administer. Builds on P1 and P4. |
| **P12** | **Status bar** (enhancement 6) | M | Puts spend, usage, waiting sessions and Archon health in view at all times. Most of the data exists already; the work is the bar, its items and a show or hide setting. Its spend item shows progress toward P5's daily limit; P5's alert stays separate. Plugin items come later. |
| **P13** | **File explorer** (enhancement 9) | M | A backend command that lists one folder at a time, honoring `.gitignore`, and a tree in the side panel. Benefits from the wider, resizable panel (P3, P7). |
| **P14** | **Visual "What's Next?" Pipeline Runner** | M | Removes prompt copy-pasting from the `/ask-sean` workflow. The Projects panel's ticket pipeline lanes (#651) and the attention queue already cover part of it; what is left is the action cards that send a prompt to a terminal. |
| **P15** | **"System One" Laya Process Supervisor** | M | Self-contained in the backend, but no current work depends on it. |
| **P16** | **Administrator PowerShell** (idea 9) | M–L | Needed for admin tasks such as the kill audit, but a security boundary; design first. |
| **P17** | **Agentic group chat** (idea 2) | L | High value, and builds on the A2A bus and council preset, but needs a design for turns, consensus, and cost limits. |
| **P18** | **Observability** (idea 5) | L | Cross-repo with AI-WS-SDK; the error logs it builds on are done. |
| **P19** | **Praxis server** (idea 1) and **Android app** (idea 3) | L | Largest scope; the server comes first. |

Done and removed from the ranking: the Archon & SDD Graph Inspector, session
scrollback persistence, GitKraken-like functionality and the dual-pane diff
and conflict resolver (both Topos), error logs with panic capture (#498), the
attention queue (#527), and context menus with the open-project double-click
(#506, #512).