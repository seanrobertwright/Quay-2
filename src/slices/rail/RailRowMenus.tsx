// The project row and worktree row menus (#509). The items come from `projectMenu` and
// `worktreeMenu`; the Rail hands in the handlers its own buttons already call, and these
// components add the clipboard and folder actions, shared with the terminal menu.
import type { FC } from "react";
import { ContextMenu, type MenuPoint } from "../overlay/ContextMenu.tsx";
import { bindMenuItems, copyToClipboard, revealFolder } from "../overlay/menuActions.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import { projectMenu, projectMenuLabel, type ProjectMenuAction } from "./projectMenu.ts";
import { worktreeBranch, worktreeMenu, worktreeMenuLabel, type WorktreeMenuAction } from "./worktreeMenu.ts";

interface MenuProps<A extends string> {
  at: MenuPoint;
  onClose: (refocus: boolean) => void;
  /** The Rail's handlers. An item whose handler is missing is left out. */
  handlers: Partial<Record<A, () => void>>;
}

/** What each of the project menu's items does; the clipboard and folder ones are the menu's own. */
export type ProjectMenuHandlers = Record<Exclude<ProjectMenuAction, "copyPath" | "openFolder">, () => void>;

export const ProjectMenu: FC<MenuProps<keyof ProjectMenuHandlers> & { project: Project; collapsed: boolean }> = ({
  project,
  collapsed,
  at,
  onClose,
  handlers,
}) => {
  const items = bindMenuItems<ProjectMenuAction>(projectMenu({ collapsed }), {
    ...handlers,
    copyPath: () => copyToClipboard(project.path, "path"),
    openFolder: () => revealFolder(project.path),
  });
  return <ContextMenu label={projectMenuLabel(project)} items={items} at={at} onClose={onClose} />;
};

/** What each of the worktree menu's items does; the clipboard and folder ones are the menu's own. */
export type WorktreeMenuHandlers = Record<Exclude<WorktreeMenuAction, "copyPath" | "copyBranchName" | "openFolder">, () => void>;

export const WorktreeMenu: FC<MenuProps<keyof WorktreeMenuHandlers> & { worktree: GitWorktree; rowName: string }> = ({
  worktree,
  rowName,
  at,
  onClose,
  handlers,
}) => {
  const branch = worktreeBranch(worktree);
  const items = bindMenuItems<WorktreeMenuAction>(worktreeMenu(worktree), {
    ...handlers,
    copyPath: () => copyToClipboard(worktree.path, "path"),
    copyBranchName: () => {
      if (branch !== null) copyToClipboard(branch, "branch name");
    },
    openFolder: () => revealFolder(worktree.path),
  });
  return <ContextMenu label={worktreeMenuLabel(rowName)} items={items} at={at} onClose={onClose} />;
};
