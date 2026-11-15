# Quickstart Tutorial

This tutorial guides you through your first session with **Quay 2**, from registering your workspace to launching autonomous multi-agent coding sessions.

---

## 1. Registering a Project Workspace

When Quay 2 launches, the **module bar** runs down the window's left edge, with the **Projects** panel open beside it. Click the **Projects** icon at the top of the bar to fold the panel away or bring it back.

Under the **Projects** icon, the bar shows one status dot per terminal: a pulsing green dot while it works, an amber dot with a halo while it waits on you, a hollow grey ring while it is idle and a red square once it has exited. Click a dot to show that terminal. The **Agents** icon counts what is waiting on you, the **Source control** icon counts open pull requests, and the bottom of the bar shows today's spend.

On the window's right, the **companion** shows what the selected terminal is working on. Select a terminal by its pane, its status dot or its row in the **Projects** panel, and the companion follows. For now it shows the terminal's repository: the project, the terminal, its branch and its folder. Drag the companion's left edge, or focus it and use the arrow keys, to make it between 340 and 560 px wide; Quay remembers the width.

Quay records which ticket and pull request each terminal belongs to, its **terminal link**, and the companion's header shows it with where it came from. It reads, strongest first: a link you pinned; how the terminal was launched (an Archon run's `ticket` input, or a worktree created from an issue); what the agent ran (`gh pr create` and the URL it printed, `gh pr checkout`, `gh issue edit --add-assignee`, `git worktree add` or `cd` into a worktree, an Archon run); and the branch (`ticket-N` or `feat/issue-N`, matched to its open pull request). A linked pull request's `Closes #N` fills the ticket. Quay never reads pull request URLs from other terminal output. When two pull requests tie, the header asks "This terminal may belong to:" and one click pins the right one. While nothing is linked, **Link to...** in the Repository view lists guesses and a search; picking one pins it. Click a pinned link's pin mark to unpin it. The link is saved with the terminal and goes when you close it.

1. Click **Add** at the top of the **Projects** panel, or press `Ctrl+Shift+P` and choose **"Add Project Folder"**.
2. Select your local git repository directory (e.g. `E:\Projects\MyProject`).
3. Quay 2 registers the workspace, detects existing git branches, and discovers any secondary git worktrees associated with the repository.

---

## 2. Launching Your First Terminal (`Ctrl+Shift+B N`)

1. Press `Ctrl+Shift+B N` (or click **Term** at the top of the **Projects** panel).
2. The **New Terminal** dialog appears with options:
   - **Command Type**: Choose an agent (Claude Code, Antigravity, Codex, Pi, PiG, Gemini, Grok, Aider, Kiro, Copilot or OpenCode), a PowerShell Console, or a Custom Command, which runs any command line, such as `cmd.exe` or `wsl.exe`.
   - **Model**: For an agent, pick one of its presets (for Claude Code, e.g. **Claude Opus 5.5** or **Claude Sonnet 5.5**), or leave it on **Default**, the agent's own setting. See the [Agent Compatibility Matrix](../features/agent-support.md#agent-compatibility-matrix).
   - **Permission Mode**: **Skip Permissions (Default)** starts the agent with its own flag for running tools without asking, where Quay passes one (for Claude Code, `--dangerously-skip-permissions`). **Interactive Approvals** leaves it off, so the agent asks before its tools. Pi never asks, so it has no choice here.
   - **Terminal Label (Optional)**: Give your session a descriptive name (e.g. `feature-auth`).
3. Press **Enter** or click **Start Terminal**.
4. The terminal opens instantly, fitted to your window dimensions.

---

## 3. Keyboard Navigation Essentials

All workspace management in Quay 2 is driven by the `Ctrl+Shift+B` prefix key chord:

- **Switch Terminals**: Press `Ctrl+Shift+B 1` through `Ctrl+Shift+B 9` (or `Alt+1` .. `Alt+9`).
- **Split Stage Side-by-Side**: Press `Ctrl+Shift+B %` to split horizontally.
- **Split Stage Top-and-Bottom**: Press `Ctrl+Shift+B "` to split vertically.
- **2x2 Quad Grid**: Press `Ctrl+Shift+B G` to tile 4 terminals simultaneously.
- **Zoom / Maximize**: Press `Ctrl+Shift+B Z` to toggle zoom on the active pane.
- **Cycle Focus**: Press `Ctrl+Shift+B O` to cycle input focus between panes.
- **Unsplit**: Press `Ctrl+Shift+B X` to restore single active pane.

---

## 4. Spawning a 1-Click Multi-Agent Swarm (`Ctrl+Shift+B S`)

Instead of configuring multiple splits manually, Quay 2 provides **Swarm Presets**:

1. Press `Ctrl+Shift+B S` to open the Swarm Launcher.
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

## 6. Triaging GitHub Issues (`Ctrl+Shift+B I`)

1. Press `Ctrl+Shift+B I` to slide out the **GitHub Companion Drawer**.
2. View all open issues and pull requests for your repository.
3. Notice any issues marked with a red **`BLOCKED`** tag: hover over the tag to see the exact issue numbers currently blocking work.
4. Click **"Implement with Claude"** or **"Implement with Archon"** on any ready issue. Quay will automatically create an isolated worktree branch and prompt the agent to implement the requested solution.

---

## 7. Tracking Spend & Audio Chimes (`Ctrl+Shift+B T`)

1. Check the status line at the bottom of the **Projects** panel to see your live all-time token spend.
2. Press `Ctrl+Shift+B T` to open the **Token Spend & Audio Settings** dialog.
3. Inspect model breakdowns (Opus 5.5, Sonnet 5.5, Haiku 5.5) and enable subtle audio chimes to notify you when long-running agent turns finish while you work in other applications.
