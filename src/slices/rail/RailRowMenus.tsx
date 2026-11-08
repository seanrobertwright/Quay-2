// The project row and worktree row menus (#509). The items come from `projectMenu` and
// `worktreeMenu`; the Rail hands in the handlers its own buttons already call, and these
// components add the clipboard and folder actions, which go through the clipboard and the
// opener plugin as the terminal menu's do.
import type { FC } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ContextMenu, type ContextMenuItem, type MenuPoint } from "../overlay/ContextMenu.tsx";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import { projectMenu, projectMenuLabel, type ProjectMenuAction } from "./projectMenu.ts";
import { worktreeBranch, worktreeMenu, worktreeMenuLabel, type WorktreeMenuAction } from "./worktreeMenu.ts";

/** Copies `text` to the clipboard; `what` names it in the log when that fails. */
function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).catch((err) => console.error(`Failed to copy the ${what}:`, err));
}

/** Opens Explorer on a folder, through the opener plugin. */
function openFolder(path: string) {
  revealItemInDir(path).catch((err) => console.error("Failed to open the folder in Explorer:", err));
}

/** Binds each entry to its handler. An entry whose handler is missing is left out. */
function bind<A extends string>(
  entries: (Omit<ContextMenuItem, "onChoose"> & { action: A })[],
  handlers: Partial<Record<A, () => void>>
): ContextMenuItem[] {
  return entries.flatMap(({ action, ...item }) => {
    const run = handlers[action];
    return run ? [{ ...item, onChoose: run }] : [];
  });
}

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
  const items = bind<ProjectMenuAction>(projectMenu({ collapsed }), {
    ...handlers,
    copyPath: () => copy(project.path, "path"),
    openFolder: () => openFolder(project.path),
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
  const items = bind<WorktreeMenuAction>(worktreeMenu(worktree), {
    ...handlers,
    copyPath: () => copy(worktree.path, "path"),
    copyBranchName: () => {
      if (branch !== null) copy(branch, "branch name");
    },
    openFolder: () => openFolder(worktree.path),
  });
  return <ContextMenu label={worktreeMenuLabel(rowName)} items={items} at={at} onClose={onClose} />;
};
