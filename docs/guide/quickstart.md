# Quickstart Tutorial

This tutorial guides you through your first session with **Quay 2**, from registering your workspace to launching autonomous multi-agent coding sessions.

---

## 1. Registering a Project Workspace

When Quay 2 launches, you are greeted by the **Navigation Rail** on the left side of the window.

1. Click the **`+`** icon next to **Projects** in the rail, or press `Ctrl+K` and choose **"Add Project Folder"**.
2. Select your local git repository directory (e.g. `E:\Projects\MyProject`).
3. Quay 2 registers the workspace, detects existing git branches, and discovers any secondary git worktrees associated with the repository.

---

## 2. Launching Your First Terminal (`Ctrl+B N`)

1. Press `Ctrl+B N` (or click **"New Terminal"** in the navigation rail).
2. The **Launch Terminal** dialog appears with options:
   - **Command Type**: Choose from Claude Code, Antigravity CLI, OpenAI Codex, PowerShell, Cmd, WSL, or Custom Command.
   - **Model Selection**: When choosing Claude Code, select your target model (e.g. `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`).
   - **Permissions Mode**: Toggle `--dangerously-skip-permissions` for uninterrupted autonomous runs, or leave it off for interactive prompt approval.
   - **Terminal Name**: Give your session a descriptive name (e.g. `feature-auth`).
3. Press **Enter** or click **Launch**.
4. The terminal opens instantly, fitted to your window dimensions.

---

## 3. Keyboard Navigation Essentials

All workspace management in Quay 2 is driven by the `Ctrl+B` prefix key chord:

- **Switch Terminals**: Press `Ctrl+B 1` through `Ctrl+B 9` (or `Alt+1` .. `Alt+9`).
- **Split Stage Side-by-Side**: Press `Ctrl+B %` to split horizontally.
- **Split Stage Top-and-Bottom**: Press `Ctrl+B "` to split vertically.
- **2x2 Quad Grid**: Press `Ctrl+B G` to tile 4 terminals simultaneously.
- **Zoom / Maximize**: Press `Ctrl+B Z` to toggle zoom on the active pane.
- **Cycle Focus**: Press `Ctrl+B O` to cycle input focus between panes.
- **Unsplit**: Press `Ctrl+B X` to restore single active pane.

---

## 4. Spawning a 1-Click Multi-Agent Swarm (`Ctrl+B S`)

Instead of configuring multiple splits manually, Quay 2 provides **Swarm Presets**:

1. Press `Ctrl+B S` to open the Swarm Launcher.
2. Select a preset. The launcher selects the first built-in preset when it opens. [Swarm Presets & Splits](/features/swarm-presets) lists every built-in preset with its agents, and shows how to save your own swarms.
3. Click **Launch Swarm Now**. Quay automatically splits the stage and launches the coordinated processes.

---

## 5. Using the Agent-to-Agent (A2A) Bus

Every Claude Code session launched inside Quay 2 is automatically connected to the loopback MCP bus:

1. In Terminal 1 (`frontend-agent`), give Claude a task:
   ```text
   Use quay_list_agents to find 'backend-agent'. Ask them via quay_send_message
   what endpoint schema is expected for the user profile API, and wait for their response.
   ```
2. Claude calls `quay_list_agents`, discovers the recipient's terminal ID, and invokes `quay_send_message`.
3. Quay delivers the prompt to Terminal 2 (`backend-agent`), awaits its turn completion, and delivers the answer directly back to Terminal 1 without any manual copy-pasting.

---

## 6. Triaging GitHub Issues (`Ctrl+B I`)

1. Press `Ctrl+B I` to slide out the **GitHub Companion Drawer**.
2. View all open issues and pull requests for your repository.
3. Notice any issues marked with a red **`BLOCKED`** tag: hover over the tag to see the exact issue numbers currently blocking work.
4. Click **"Implement with Claude"** or **"Implement with Archon"** on any ready issue. Quay will automatically create an isolated worktree branch and prompt the agent to implement the requested solution.

---

## 7. Tracking Spend & Audio Chimes (`Ctrl+B T`)

1. Check the bottom toolbar in the navigation rail to see your live all-time token spend.
2. Press `Ctrl+B T` to open the **Token Spend & Audio Settings** dialog.
3. Inspect model breakdowns (Opus 5.5, Sonnet 5.5, Haiku 5.5) and enable subtle audio chimes to notify you when long-running agent turns finish while you work in other applications.
