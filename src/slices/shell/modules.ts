/** The five modules on the module bar, top to bottom. */
export const MODULES = ["projects", "source-control", "agents", "workflows", "project"] as const;

export type ModuleId = (typeof MODULES)[number];

/** Each module's name, as its icon's accessible name and its panel's label. */
export const MODULE_NAMES: Record<ModuleId, string> = {
  projects: "Projects",
  "source-control": "Source control",
  agents: "Agents",
  workflows: "Workflows",
  project: "Project",
};

/**
 * The module whose panel shows after the user clicks `clicked`'s icon while `open` shows, or
 * null for a folded panel. Clicking the open module's icon folds the panel; any other click
 * opens that module's panel.
 */
export function moduleAfterClick(open: ModuleId | null, clicked: ModuleId): ModuleId | null {
  return open === clicked ? null : clicked;
}
