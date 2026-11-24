# Quickstart Tutorial

This tutorial guides you through your first session with **Quay 2**, from registering your workspace to launching autonomous multi-agent coding sessions.

---

## 1. Registering a Project Workspace

When Quay 2 launches, the **module bar** runs down the window's left edge, with the **Projects** panel open beside it. Click the **Projects** icon at the top of the bar to fold the panel away or bring it back.

Under the **Projects** icon, the bar shows one status dot per terminal: a pulsing green dot while it works, an amber dot with a halo while it waits on you, a hollow grey ring while it is idle and a red square once it has exited. Click a dot to show that terminal. The **Agents** icon counts what is waiting on you, the **Source control** icon counts open pull requests, and the bottom of the bar shows today's spend.

On the window's right, the **companion** shows what the selected terminal is working on. Select a terminal by its pane, its status dot or its row in the **Projects** panel, and the companion follows. For now it shows the terminal's repository: the project, the terminal, its branch and its folder. Drag the companion's left edge, or focus it and use the arrow keys, to make it between 340 and 560 px wide; Quay remembers the width.

Quay records which ticket and pull request each terminal belongs to, its **terminal link**, and the companion's header shows it with where it came from. It reads, strongest first: a link you pinned; how the terminal was launched (an Archon run's `ticket` input, or a worktree created from an issue); what the agent ran (`gh pr create` and the URL it printed, `gh pr checkout`, `gh issue edit --add-assignee`, `git worktree add` or `cd` into a worktree, an Archon run); and the branch (`ticket-N` or `feat/issue-N`, matched to its open pull request). A linked pull request's `Closes #N` fills the ticket, and the header lists every ticket it closes. Quay never reads pull request URLs from other terminal output. When two pull requests tie, the header asks "This terminal may belong to:" and one click pins the right one. While nothing is linked, **Link to...** in the Repository view lists guesses and a search; picking one pins it. Click a pinned link's pin mark to unpin it. The link is saved with the terminal and goes when you close it.

When the terminal has a pull request, the companion opens on the **Pull request** view: its title, state, base and head branches and diffstat, then the **readiness card**. The card's headline says whether it can merge (Ready to merge, checks failing or running, a blocked state such as merge conflicts or a required review, Merged, or Closed without merging) with one line of reason, and its Checks, Comments, Files and Commits cells count each with a bar. Click a cell to open its detail under the card, and click it again to close it; with no cell open, the pull request's description shows. When you arrive, the view opens a failing check, or else the unresolved comments, so you land on what needs you. **Checks** groups the checks failing, pending, skipped and successful, with each failing check's log open. **Comments** shows the timeline with **All**, **Unresolved** and **Mine** filters and **Newest first**; type in the box above it and press **Comment**, or **Close pull request** beside it. **Files** shows one file's diff at a time: pick a file (files with comments are marked) or step through with **Previous** and **Next**. **Commits** lists the commits. Line comments, reviews, re-running checks and reviewers stay on GitHub. Merge from the card: the arrow beside the merge button picks a merge commit, squash (the default) or rebase, and the confirm step shows the commit message and **Delete branch after merge**, ticked. Quay merges through GitHub's merge API and says why if the merge fails or GitHub has not finished it within a minute. After a merge or close, the card offers **Delete branch** or **Restore branch**, and **Reopen** after a close.

When the terminal has a ticket, the **Ticket** view shows it: its title and number, state, type and who opened it, then the **status card**, whose one button is the ticket's next step. A ticket that is ready to start offers **Implement**, and the arrow beside it **Triage** and **New worktree**. They start work in the terminal's repository; a ticket from another repository offers none and names where it lives. A blocked ticket offers **Show the blocker**, which pins the blocker to the terminal so the companion shows it. A ticket with an open pull request says how its checks stand and offers **Open pull request #N**. A closed ticket says why it closed and offers **Reopen**. The card's **Blocked by**, **Comments**, **Pull request** and **Details** cells open their detail under it, as the readiness card's do; when you arrive, the view opens an open blocker, or else the comments when one is new since you last commented. **Comments** has the comment box above the timeline; beside **Comment**, the close button reads **Close as completed**, or **Close with comment** once you type, and its arrow picks completed, not planned or duplicate. **Details** lists the assignees, labels and type, each with **Edit** (and **Assign yourself** while no one is assigned), then the milestone, parent, blockers and pull requests as links to GitHub. Edit the title, description, milestone and relationships on GitHub. When the terminal has both a pull request and a ticket, the pull request shows first, and the terminal link in the header becomes a switch, naming where each came from, that reaches the ticket.

To read a large change, open the **diff lens**: **Diff lens** in the companion's header, **Open in the diff lens** in the Files detail (on the file it shows), or `Ctrl+Shift+B D`. The lens slides over the terminal, up to the companion's edge, with a file filter, a file tree and every diff stacked. The tree marks files with comments, and files you tick **Viewed**. The companion stays usable beside it, so the readiness card and merge are still there. At the lens's foot, the **reply strip** shows the terminal's last waiting permission request with **Allow once**, **Allow for session** and **Deny**. When the request's input holds more than the strip's summary, **Whole input** opens the terminal's Activity view, where the request shows the rest of its input. Close the lens with **Close lens**, `Escape` or a click on a readiness cell; keyboard focus goes back to the terminal.

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

1. Press `Ctrl+Shift+B I`, or click the **Source control** icon on the module bar, to open the **Source control** panel.
2. Choose **Pull requests** or **Issues** to see the open ones for your repository; **All** adds closed ones.
3. Notice any issues marked with a red **Blocked by N** tag: those wait on open blockers.
4. Select a terminal, then pick a ready issue. It opens in the companion's Ticket view, where **Implement** starts an Archon run on it.

---

## 7. Tracking Spend & Audio Chimes (`Ctrl+Shift+B T`)

1. Check the spend ticker at the bottom of the module bar to see today's token spend.
2. Press `Ctrl+Shift+B T` to open the **Project** panel, and pick **Token spend** to open the token spend window.
3. Inspect model breakdowns (Opus 5.5, Sonnet 5.5, Haiku 5.5). Switch **Sound chime** on in the panel's **Quay · every project** group to hear a chime when long-running agent turns finish while you work in other applications.
