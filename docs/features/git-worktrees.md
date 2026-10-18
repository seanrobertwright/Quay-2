# Git Worktrees Management

Running multiple autonomous AI coding agents in the same working directory creates write collisions, dirty git indexes, and accidental merge conflicts.

**Quay 2** solves this by integrating native **Git Worktree** management directly into your workspace workflow.

---

## Why Git Worktrees for AI Agents?

```text
E:\Projects\Quay2\                <-- Main Repository (master branch)
├── .git/
├── src/
│
E:\Projects\Quay2-worktrees\
├── feat-auth\                    <-- Isolated Worktree (Branch: feat/auth, Agent: Claude)
│   └── (clean working tree)
└── fix-conpty\                   <-- Isolated Worktree (Branch: fix/conpty, Agent: Antigravity)
    └── (clean working tree)
```

By assigning each autonomous agent to its own dedicated worktree:
- **Zero Collision Risk**: Multiple agents edit, compile, test, and commit concurrently without clobbering each other's unstaged files.
- **Instant Branch Switching**: No waiting for `git checkout` or `git stash` to clean your directory.
- **Shared Git History**: All worktrees share the same underlying `.git` object store, saving disk space and eliminating redundant fetches.

---

## 1-Click Worktree Creation (`Ctrl+B W`)

Pressing `Ctrl+B W` opens the **Create Git Worktree** modal:
1. **Branch Name**: Enter a new or existing branch name (e.g. `feat/oauth2`).
2. **Directory Name**: Quay automatically proposes a clean directory path adjacent to your repository root.
3. **Launch Terminal**: Optionally check "Launch Agent in Worktree" to automatically open a Claude Code terminal inside the new directory immediately.
4. Click **Create Worktree**.

---

## Collapsible Navigation Rail Hierarchy

To preserve vertical real estate in your sidebar when managing repositories with dozens of worktrees:

- Secondary worktrees under each project start **collapsed by default**.
- Click the chevron next to **`Worktrees (N)`** to expand or collapse the worktree list.
- **Smart Focus Dot**: If your active terminal belongs to a worktree that is currently collapsed, Quay 2 displays a distinct blue dot on the worktree header, alerting you that the active session lives inside.
- 1-click **New Terminal in Worktree (`+`)** and **Remove Worktree (trash icon)** buttons appear when hovering over any worktree row.
