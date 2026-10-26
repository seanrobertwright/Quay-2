# Code review: ticket-299, unidentified process flashes 20+ console windows

**Stats:**

- Files Modified: 3 (`src/slices/workspace/useWorkspace.ts`, `src-tauri/src/slices/git/commands.rs`, `scripts/diagnostics/procwatch.ps1`)
- Files Added: 2 (`src/slices/workspace/worktreeSync.ts`, `src/slices/workspace/worktreeSync.test.ts`)
- Files Deleted: 0

Checked: `cargo test --lib slices::git` (15 pass), `cargo test --lib spawn` (3 pass), `npm test` (192 pass), `npx tsc --noEmit` and `eslint "src/**/*.{ts,tsx}"` clean.

## Root cause analysis

Live diagnostics using `scripts/diagnostics/procwatch.ps1` captured the runaway process source: `tauri-app.exe` was executing `git worktree list --porcelain` 10+ times per second, accompanied by rapid `conhost.exe` allocations.

The root cause was a runaway React effect cycle in `src/slices/workspace/useWorkspace.ts`:
1. The auto-refresh worktrees effect checked if any open terminal belonged to a worktree subpath not yet in `projectWorktrees[p.path]`.
2. When a terminal was opened in a deleted worktree (such as a previously closed PR worktree) or in a non-worktree subdirectory (such as `src-tauri` or `docs`), `hasUnknownSubpath` evaluated to `true` on every render.
3. `refreshWorktrees` called `list_git_worktrees` and updated state via `setProjectWorktrees((prev) => ({ ...prev, [repoPath]: list }))`.
4. Because `setProjectWorktrees` always allocated a new object reference even when the worktree list was identical, and `projectWorktrees` was in the effect's dependency array, the effect re-executed immediately on the next render, repeating the cycle infinitely.
5. In addition, Claude Code plugin hooks (`security-guidance`, `.orca` hooks) execute `bash.exe` and `python.exe` during tool executions, contributing to console host window activity during tool bursts.

## Resolution

1. **Worktree list memoization (`worktreeSync.ts`)**:
   - `areWorktreesEqual` compares worktree lists structural equality (path, branch, head, flags).
   - `setProjectWorktrees` returns `prev` when the fetched list is structurally identical, avoiding redundant React renders.
2. **Subpath cache & loop prevention**:
   - `findProjectsNeedingWorktreeRefresh` tracks checked terminal paths in a ref (`checkedTerminalPathsRef`), ensuring unknown subpaths or deleted worktrees are checked only once per session rather than polling git on every render.
3. **In-flight deduplication**:
   - Concurrent `refreshWorktrees` calls for the same project path share a single in-flight promise.
4. **Backend guard (`src-tauri/src/slices/git/commands.rs`)**:
   - `list_git_worktrees` verifies the path exists and contains `.git` before invoking `git worktree list`, eliminating unnecessary process spawns for invalid or non-repo paths.
5. **Streaming diagnostic (`scripts/diagnostics/procwatch.ps1`)**:
   - Streams new process events to stdout immediately as they start instead of buffering until timeout.
