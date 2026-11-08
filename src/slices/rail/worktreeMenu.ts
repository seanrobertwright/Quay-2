// The worktree row menu (#509), opened from a worktree's row in the Rail. This module only says
// what the menu offers; the Rail binds each action to the handler its own buttons already use.
//
// An item that applies but cannot run now is shown disabled, with the reason as its hint.

import type { ContextMenuItem } from "../overlay/ContextMenu.tsx";
import type { GitWorktree } from "../git/types.ts";

/** What a worktree menu item asks for. */
export type WorktreeMenuAction = "newTerminal" | "copyPath" | "copyBranchName" | "openFolder" | "remove";

/** One item of the worktree menu, before its action is bound to a handler. */
export type WorktreeMenuEntry = Omit<ContextMenuItem, "onChoose"> & { action: WorktreeMenuAction };

const DETACHED_HEAD = "Detached HEAD";

/** The branch a worktree has checked out, without git's `refs/heads/` prefix; null when its HEAD is detached. */
export function worktreeBranch(worktree: Pick<GitWorktree, "branch">): string | null {
  if (!worktree.branch) return null;
  return worktree.branch.startsWith("refs/heads/") ? worktree.branch.slice("refs/heads/".length) : worktree.branch;
}

/** The worktree menu for `worktree`, in order, its groups kept together. */
export function worktreeMenu(worktree: Pick<GitWorktree, "branch">): WorktreeMenuEntry[] {
  const onBranch = worktreeBranch(worktree) !== null;
  return [
    { action: "newTerminal", name: "New terminal here", group: "new", enabled: true },
    { action: "copyPath", name: "Copy path", group: "folder", enabled: true },
    { action: "copyBranchName", name: "Copy branch name", group: "folder", enabled: onBranch, hint: onBranch ? undefined : DETACHED_HEAD },
    { action: "openFolder", name: "Open folder in Explorer", group: "folder", enabled: true },
    { action: "remove", name: "Remove worktree…", group: "remove", enabled: true },
  ];
}

/** The menu's accessible name, which names the worktree by what its row shows. */
export function worktreeMenuLabel(rowName: string): string {
  return `Worktree ${rowName}`;
}
