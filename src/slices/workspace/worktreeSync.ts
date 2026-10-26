import { isSamePath, isSubpathOf } from "../../utils/paths.ts";
import type { GitWorktree } from "../git/types";

/**
 * Checks whether two lists of git worktrees hold identical worktrees in the same order.
 * Compares paths using `isSamePath` so Windows slashes and case variations do not count as changes.
 */
export function areWorktreesEqual(a?: GitWorktree[], b?: GitWorktree[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every(
    (item, i) =>
      isSamePath(item.path, b[i].path) &&
      item.branch === b[i].branch &&
      item.head === b[i].head &&
      item.is_main === b[i].is_main &&
      item.is_locked === b[i].is_locked &&
      item.is_bare === b[i].is_bare
  );
}

/**
 * Checks if an open terminal sits inside a project's tree at a subpath that is not yet known
 * as a git worktree, and has not already been checked.
 */
export function shouldRefreshWorktreesForTerminal(
  terminalPath: string,
  projectPath: string,
  knownWorktrees: { path: string }[],
  checkedPaths: Set<string>
): boolean {
  if (!isSubpathOf(terminalPath, projectPath)) return false;
  if (isSamePath(terminalPath, projectPath)) return false;
  if (knownWorktrees.some((wt) => isSamePath(wt.path, terminalPath))) return false;
  if (checkedPaths.has(terminalPath)) return false;
  return true;
}

/**
 * Finds which project paths need a worktree refresh based on current terminals, and marks
 * any discovered subpaths as checked in `checkedPaths` to prevent runaway polling loops.
 */
export function findProjectsNeedingWorktreeRefresh(
  projects: { path: string }[],
  terminals: { project_path: string }[],
  projectWorktrees: Record<string, { path: string }[]>,
  checkedPaths: Set<string>
): string[] {
  const needingRefresh: string[] = [];

  for (const p of projects) {
    const knownWts = projectWorktrees[p.path] || [];
    let projectNeedsRefresh = false;

    for (const t of terminals) {
      if (shouldRefreshWorktreesForTerminal(t.project_path, p.path, knownWts, checkedPaths)) {
        projectNeedsRefresh = true;
        checkedPaths.add(t.project_path);
      }
    }

    if (projectNeedsRefresh) {
      needingRefresh.push(p.path);
    }
  }

  return needingRefresh;
}
