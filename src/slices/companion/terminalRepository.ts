import type { TerminalInfo } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import { isSamePath, normalizePath, resolveRootRepo } from "../../utils/paths.ts";

/** The repository a terminal works in, as the companion's Repository view shows it. */
export interface TerminalRepository {
  /** The project's name, or the folder's name for a terminal in no project. */
  name: string;
  /** The project's folder, or the terminal's own folder when it is in no project. */
  path: string;
  /** The folder the terminal runs in. */
  workingFolder: string;
  /** Whether the working folder is one of the project's linked worktrees. */
  worktree: boolean;
  /** The working folder's branch from the project's worktree list, or null when Quay has none. */
  branch: string | null;
}

/**
 * The repository `terminal` works in, from the projects and worktree lists Quay already holds, so
 * showing it needs no fetch.
 */
export function terminalRepository(
  terminal: Pick<TerminalInfo, "project_path">,
  projects: readonly Pick<Project, "path" | "name">[],
  projectWorktrees: Readonly<Record<string, readonly GitWorktree[]>>,
): TerminalRepository {
  const folder = terminal.project_path;
  const path = resolveRootRepo(folder, projects, projectWorktrees);
  const project = projects.find((p) => p.path === path);
  const worktrees = Object.prototype.hasOwnProperty.call(projectWorktrees, path) ? projectWorktrees[path] : [];
  const entry = worktrees.find((wt) => isSamePath(wt.path, folder));
  const name = project?.name ?? (normalizePath(folder).split("/").pop() || folder);
  return {
    name,
    path,
    workingFolder: folder,
    worktree: entry ? !entry.is_main : false,
    branch: entry?.branch ?? null,
  };
}
