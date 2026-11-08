// The project row menu (#509), opened from a project's row in the Rail. This module only says
// what the menu offers; the Rail binds each action to the handler its own buttons already use.

import type { ContextMenuItem } from "../overlay/ContextMenu.tsx";
import type { Project } from "../workspace/types.ts";

/** What a project menu item asks for. */
export type ProjectMenuAction =
  | "newTerminal"
  | "newWorktree"
  | "swarm"
  | "topos"
  | "github"
  | "settings"
  | "copyPath"
  | "openFolder"
  | "toggleCollapse"
  | "remove";

/** One item of the project menu, before its action is bound to a handler. */
export type ProjectMenuEntry = Omit<ContextMenuItem, "onChoose"> & { action: ProjectMenuAction };

/** What the menu reads from the project's row: whether its terminals and worktrees are folded away. */
export interface ProjectMenuState {
  collapsed: boolean;
}

/** The project menu for a row in `state`, in order, its groups kept together. */
export function projectMenu({ collapsed }: ProjectMenuState): ProjectMenuEntry[] {
  return [
    { action: "newTerminal", name: "New terminal", group: "new", enabled: true },
    { action: "newWorktree", name: "New worktree…", group: "new", enabled: true, hint: "Ctrl+Shift+B w" },
    { action: "swarm", name: "Swarm preset…", group: "new", enabled: true },
    { action: "topos", name: "Open Topos", group: "tools", enabled: true },
    { action: "github", name: "GitHub issues & PRs", group: "tools", enabled: true },
    { action: "settings", name: "Workspace settings…", group: "tools", enabled: true },
    { action: "copyPath", name: "Copy path", group: "folder", enabled: true },
    { action: "openFolder", name: "Open folder in Explorer", group: "folder", enabled: true },
    { action: "toggleCollapse", name: collapsed ? "Expand" : "Collapse", group: "row", enabled: true },
    { action: "remove", name: "Remove workspace…", group: "row", enabled: true },
  ];
}

/** The menu's accessible name, which names the workspace it acts on. */
export function projectMenuLabel(project: Pick<Project, "name">): string {
  return `Workspace ${project.name}`;
}
