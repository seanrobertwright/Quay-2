# Git Worktrees Management

Running multiple autonomous AI coding agents in the same working directory creates write collisions, dirty git indexes, and accidental merge conflicts.

**Quay 2** solves this by integrating native **Git Worktree** management directly into your workspace workflow.

---

## Why Git Worktrees for AI Agents?

```text
E:\Projects\Quay2\                <-- Main Repository (master branch)
├── .git/
├── src/
└── .worktrees\
    ├── feat-auth\                <-- Isolated Worktree (Branch: feat/auth)
    │   └── (clean working tree)
    └── fix-conpty\               <-- Isolated Worktree (Branch: fix/conpty)
        └── (clean working tree)
```

Quay 2 creates each worktree in a `.worktrees` folder inside the project, in a folder named after the branch.

By assigning each autonomous agent to its own dedicated worktree:
- **Zero Collision Risk**: Multiple agents edit, compile, test, and commit concurrently without clobbering each other's unstaged files.
- **Instant Branch Switching**: No waiting for `git checkout` or `git stash` to clean your directory.
- **Shared Git History**: All worktrees share the same underlying `.git` object store, saving disk space and eliminating redundant fetches.

---

## 1-Click Worktree Creation (`Ctrl+B W`)

Pressing `Ctrl+B W` opens the **New Git Worktree** dialog for the active project. The dialog's footer shows the project folder it will use.

1. **Branch Name**: Enter a branch name (e.g. `feat/oauth2`), or click a prefix button (`+feat/issue-`, `+fix/issue-`, `+wayfinder/issue-`) to start one. The label beside the field shows the folder the worktree will get, `.worktrees/<branch>`, with each `/` or `\` in the branch name replaced by `-`. For example, `feat/oauth2` goes in `.worktrees/feat-oauth2`.
2. **Create as new branch**: Checked by default. Quay creates the branch from the base branch in the **from** field, which defaults to `main`. Uncheck it to check out an existing branch instead.
3. **Launch Claude Code terminal immediately**: Checked by default. Quay opens a Claude Code terminal inside the new worktree as soon as it is created.
4. Click **Create Worktree**.

Quay always creates the worktree from the project's root repository. Pressing `Ctrl+B W` while a worktree is selected adds another worktree of the project, never one nested inside the selected worktree.

---

## Collapsible Navigation Rail Hierarchy

To preserve vertical real estate in your sidebar when managing repositories with dozens of worktrees:

- Secondary worktrees under each project start **collapsed by default**.
- Click the chevron next to **`Worktrees (N)`** to expand or collapse the worktree list.
- **Smart Focus Dot**: If your active terminal belongs to a worktree that is currently collapsed, Quay 2 displays a distinct blue dot on the worktree header, alerting you that the active session lives inside.
- 1-click **New Terminal in Worktree (`+`)** and **Remove Worktree (trash icon)** buttons appear when hovering over any worktree row.
- **Safe removal**: before closing any terminal, Quay checks the worktree for modified or untracked files. If it finds any, Quay shows git's refusal with the changed files and leaves the worktree and its terminals untouched. **Remove anyway** runs `git worktree remove --force`, which discards those changes and closes the worktree's terminals.
