import type { ToposTarget } from "../git/topos/Topos.tsx";
import type { GitWorktree } from "../git/types.ts";
import type { Project } from "../workspace/types.ts";
import { terminalRepository, worktreeDisplayName } from "./terminalRepository.ts";

/** The projects and worktree lists Quay holds. */
export interface KnownProjects {
  projects: readonly Pick<Project, "path" | "name">[];
  projectWorktrees: Readonly<Record<string, readonly GitWorktree[]>>;
}

/** What Topos works on for `folder`: the folder itself, and the graph of its repository's root. */
export function toposTargetOf(folder: string, { projects, projectWorktrees }: KnownProjects): ToposTarget {
  const { name, path, worktree, branch } = terminalRepository({ project_path: folder }, projects, projectWorktrees);
  return { path: folder, name: worktree ? worktreeDisplayName(name, branch) : name, repoPath: path };
}
