import { STAGE_LAYOUTS, type StageLayout } from "../terminal/types.ts";
import { isSamePath } from "../../utils/paths.ts";
import type { GridSlots } from "./gridSlots.ts";

export type PaneKey = "primary" | "secondary" | "grid-0" | "grid-1" | "grid-2" | "grid-3";

const PANE_KEYS: readonly PaneKey[] = ["primary", "secondary", "grid-0", "grid-1", "grid-2", "grid-3"];

/**
 * How one project's stage is laid out: the layout, which terminal each pane shows, the split
 * ratio, zoom, the focused pane and the selected terminal. Overlays are not part of it.
 */
export interface ProjectView {
  layout: StageLayout;
  primaryTerminalId: string | null;
  secondaryTerminalId: string | null;
  gridTerminalIds: GridSlots;
  focusedPane: PaneKey;
  splitRatio: number;
  /** The layout a zoom came from; set while a split or grid pane is zoomed to fill the stage. */
  zoomedFromLayout: StageLayout | null;
  activeTerminalId: string | null;
}

/** The record the backend keeps per project path in `workspaces.json` (`ProjectView` in Rust). */
export interface StoredProjectView {
  layout: string;
  primary_terminal_id: string | null;
  secondary_terminal_id: string | null;
  grid_terminal_ids: (string | null)[];
  split_ratio: number;
  zoomed_from_layout: string | null;
  focused_pane: string;
  active_terminal_id: string | null;
}

export const DEFAULT_SPLIT_RATIO = 50;
const MIN_SPLIT_RATIO = 15;
const MAX_SPLIT_RATIO = 85;

export function toStoredView(view: ProjectView): StoredProjectView {
  return {
    layout: view.layout,
    primary_terminal_id: view.primaryTerminalId,
    secondary_terminal_id: view.secondaryTerminalId,
    grid_terminal_ids: [...view.gridTerminalIds],
    split_ratio: view.splitRatio,
    zoomed_from_layout: view.zoomedFromLayout,
    focused_pane: view.focusedPane,
    active_terminal_id: view.activeTerminalId,
  };
}

/**
 * The view to show for a project whose terminals are `projectTerminalIds`. A saved view comes
 * back as it was, except that a terminal that no longer exists leaves its pane empty: it is
 * never swapped for another terminal. A project with nothing saved shows its first terminal.
 */
export function restoreProjectView(stored: unknown, projectTerminalIds: readonly string[]): ProjectView {
  if (!isRecord(stored)) {
    const first = projectTerminalIds[0] ?? null;
    return {
      layout: "single",
      primaryTerminalId: first,
      secondaryTerminalId: null,
      gridTerminalIds: [null, null, null, null],
      focusedPane: "primary",
      splitRatio: DEFAULT_SPLIT_RATIO,
      zoomedFromLayout: null,
      activeTerminalId: first,
    };
  }
  return dropMissingTerminals(parseStoredView(stored), projectTerminalIds);
}

/**
 * Empties every pane whose terminal isn't in `terminalIds`, and a secondary pane that repeats
 * the primary. When the selected terminal is gone, the selection moves to the terminal in the
 * focused pane, if any. Returns `view` itself when nothing changes.
 */
export function dropMissingTerminals(view: ProjectView, terminalIds: readonly string[]): ProjectView {
  const exists = (id: string | null) => (id !== null && terminalIds.includes(id) ? id : null);

  const primaryTerminalId = exists(view.primaryTerminalId);
  let secondaryTerminalId = exists(view.secondaryTerminalId);
  if (secondaryTerminalId !== null && secondaryTerminalId === primaryTerminalId) secondaryTerminalId = null;
  const gridTerminalIds = view.gridTerminalIds.map(exists) as GridSlots;

  const next: ProjectView = { ...view, primaryTerminalId, secondaryTerminalId, gridTerminalIds };
  next.activeTerminalId = exists(view.activeTerminalId) ?? paneTerminal(next, view.focusedPane);

  const unchanged =
    next.primaryTerminalId === view.primaryTerminalId &&
    next.secondaryTerminalId === view.secondaryTerminalId &&
    next.activeTerminalId === view.activeTerminalId &&
    next.gridTerminalIds.every((id, i) => id === view.gridTerminalIds[i]);
  return unchanged ? view : next;
}

/**
 * Selects `terminalId`: focuses the pane already showing it, or else puts it in the focused
 * pane (the primary pane of a single layout).
 */
export function showTerminal(view: ProjectView, terminalId: string): ProjectView {
  const showing = paneShowing(view, terminalId);
  if (showing) return { ...view, focusedPane: showing, activeTerminalId: terminalId };

  if (view.layout === "grid") {
    const slot = gridSlotIndex(view.focusedPane) ?? 0;
    const gridTerminalIds = [...view.gridTerminalIds] as GridSlots;
    gridTerminalIds[slot] = terminalId;
    return { ...view, gridTerminalIds, focusedPane: `grid-${slot}` as PaneKey, activeTerminalId: terminalId };
  }
  if (isSplit(view.layout) && view.focusedPane === "secondary") {
    return { ...view, secondaryTerminalId: terminalId, activeTerminalId: terminalId };
  }
  return { ...view, primaryTerminalId: terminalId, focusedPane: "primary", activeTerminalId: terminalId };
}

/**
 * Switches to `layout` at the user's request. Going into a split with no usable second pane
 * fills it with the first other terminal; with no other terminal the layout stays as it was.
 * (Restoring a saved split instead leaves a missing second terminal's pane empty.)
 */
export function switchLayout(
  view: ProjectView,
  layout: StageLayout,
  terminalIds: readonly string[]
): ProjectView {
  if (!isSplit(layout)) return { ...view, layout };
  const secondary = view.secondaryTerminalId;
  if (secondary !== null && secondary !== view.primaryTerminalId && terminalIds.includes(secondary)) {
    return { ...view, layout };
  }
  const other = terminalIds.find((id) => id !== view.primaryTerminalId);
  return other === undefined ? view : { ...view, layout, secondaryTerminalId: other };
}

/** The saved view for `path`, matched the way `isSamePath` matches project paths. */
export function findStoredView(
  views: Record<string, StoredProjectView>,
  path: string
): StoredProjectView | undefined {
  if (views[path]) return views[path];
  const key = Object.keys(views).find((candidate) => isSamePath(candidate, path));
  return key === undefined ? undefined : views[key];
}

function parseStoredView(stored: Record<string, unknown>): ProjectView {
  const grid = Array.isArray(stored.grid_terminal_ids) ? stored.grid_terminal_ids : [];
  return {
    layout: asLayout(stored.layout) ?? "single",
    primaryTerminalId: asId(stored.primary_terminal_id),
    secondaryTerminalId: asId(stored.secondary_terminal_id),
    gridTerminalIds: [asId(grid[0]), asId(grid[1]), asId(grid[2]), asId(grid[3])],
    focusedPane: PANE_KEYS.find((key) => key === stored.focused_pane) ?? "primary",
    splitRatio: asSplitRatio(stored.split_ratio),
    zoomedFromLayout: asLayout(stored.zoomed_from_layout),
    activeTerminalId: asId(stored.active_terminal_id),
  };
}

function paneTerminal(view: ProjectView, pane: PaneKey): string | null {
  if (pane === "primary") return view.primaryTerminalId;
  if (pane === "secondary") return view.secondaryTerminalId;
  return view.gridTerminalIds[gridSlotIndex(pane) ?? 0];
}

function paneShowing(view: ProjectView, terminalId: string): PaneKey | null {
  if (view.layout === "grid") {
    const slot = view.gridTerminalIds.indexOf(terminalId);
    return slot === -1 ? null : (`grid-${slot}` as PaneKey);
  }
  if (view.primaryTerminalId === terminalId) return "primary";
  if (isSplit(view.layout) && view.secondaryTerminalId === terminalId) return "secondary";
  return null;
}

function gridSlotIndex(pane: PaneKey): number | null {
  return pane.startsWith("grid-") ? Number(pane.slice(5)) : null;
}

function isSplit(layout: StageLayout): boolean {
  return layout === "split-horizontal" || layout === "split-vertical";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asLayout(value: unknown): StageLayout | null {
  return STAGE_LAYOUTS.find((layout) => layout === value) ?? null;
}

function asSplitRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}
