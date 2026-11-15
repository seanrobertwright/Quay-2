import type { TerminalInfo } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import { isSamePath, isSubpathOf } from "../../utils/paths.ts";

/** The four dots of the module bar's terminal status list. */
export type DotStatus = "working" | "waiting" | "idle" | "exited";

/** Each dot's status as a screen reader and the tooltip say it. */
export const DOT_STATUS_LABELS: Record<DotStatus, string> = {
  working: "working",
  waiting: "waiting on you",
  idle: "idle",
  exited: "exited",
};

/** The most rows the list shows, the +N row included, however tall the window. */
export const STATUS_ROW_CAP = 12;
/** A status row's height, in CSS px. */
export const STATUS_ROW_HEIGHT = 24;
/** The gap between one project's rows and the next's, in CSS px. */
export const PROJECT_GAP = 6;
/** The list's padding above and below its rows, together, in CSS px. */
export const STATUS_LIST_PADDING = 8;

/** The group name for terminals in no registered project, as the Projects panel heads them. */
export const OTHER_TERMINALS = "Other Terminals";

/** A starting terminal is busy, so it shows as working; a terminal with no status shows idle. */
export function dotStatus(terminal: Pick<TerminalInfo, "claude_status">): DotStatus {
  switch (terminal.claude_status) {
    case "working":
    case "starting":
      return "working";
    case "waiting":
      return "waiting";
    case "exited":
      return "exited";
    default:
      return "idle";
  }
}

/** One terminal's row: the terminal, its dot and the project group it sits in. */
export interface StatusRow {
  terminal: TerminalInfo;
  status: DotStatus;
  projectName: string;
  /** Rows of one project share a group; the list puts its gap between groups. */
  group: string;
}

/**
 * One row per terminal, in the Projects panel's order: for each project its own terminals, then
 * each worktree's terminals; then every terminal in no project, under "Other Terminals".
 *
 * A terminal in a folder inside a project that is neither a registered project nor a known
 * worktree (such as a worktree created a moment ago) is listed at the end of the deepest
 * project that holds it. The Projects panel does not list such a terminal yet; the bar still
 * gives every terminal a row.
 */
export function statusRows(
  terminals: readonly TerminalInfo[],
  projects: readonly Project[],
  projectWorktrees: Readonly<Record<string, readonly GitWorktree[]>>,
): StatusRow[] {
  // Each terminal's project: an exact project or worktree folder first, so a project nested
  // inside another keeps its own terminals, then the deepest project folder that holds it.
  const owner = new Map<string, { project: Project; nested: boolean }>();
  for (const t of terminals) {
    const exact = projects.find(
      (p) =>
        isSamePath(t.project_path, p.path) ||
        (projectWorktrees[p.path] ?? []).some((wt) => !wt.is_main && isSamePath(t.project_path, wt.path)),
    );
    if (exact) {
      owner.set(t.id, { project: exact, nested: false });
      continue;
    }
    const holders = projects.filter((p) => isSubpathOf(t.project_path, p.path));
    const deepest = holders.sort((a, b) => b.path.length - a.path.length)[0];
    if (deepest) owner.set(t.id, { project: deepest, nested: true });
  }

  const rows: StatusRow[] = [];
  const row = (terminal: TerminalInfo, projectName: string, group: string): StatusRow => ({
    terminal,
    status: dotStatus(terminal),
    projectName,
    group,
  });
  for (const project of projects) {
    const mine = terminals.filter((t) => owner.get(t.id)?.project === project);
    const inFolder = (path: string) => mine.filter((t) => !owner.get(t.id)?.nested && isSamePath(t.project_path, path));
    for (const t of inFolder(project.path)) rows.push(row(t, project.name, project.path));
    for (const wt of projectWorktrees[project.path] ?? []) {
      if (wt.is_main) continue;
      for (const t of inFolder(wt.path)) rows.push(row(t, project.name, project.path));
    }
    for (const t of mine) if (owner.get(t.id)?.nested) rows.push(row(t, project.name, project.path));
  }
  for (const t of terminals) if (!owner.has(t.id)) rows.push(row(t, OTHER_TERMINALS, ""));
  return rows;
}

const urgent = (row: StatusRow) => row.status === "waiting" || row.status === "exited";

/**
 * The rows that show when `cap` rows fit. At or below the cap every row shows in order, so rows
 * never reorder. Past it one row goes to +N: waiting and exited terminals take the rest first
 * (the first ones, if there are more than fit), the others fill what is left in order, and the
 * shown rows keep their order. `hidden` is the N.
 */
export function capStatusRows(rows: readonly StatusRow[], cap = STATUS_ROW_CAP): { rows: StatusRow[]; hidden: number } {
  if (rows.length <= cap) return { rows: [...rows], hidden: 0 };
  const slots = Math.max(cap - 1, 0);
  const urgentRows = rows.filter(urgent).slice(0, slots);
  const fill = rows.filter((r) => !urgent(r)).slice(0, slots - urgentRows.length);
  const shown = new Set([...urgentRows, ...fill]);
  const kept = rows.filter((r) => shown.has(r));
  return { rows: kept, hidden: rows.length - kept.length };
}

/** How tall the list is with `rows` shown and `hidden` behind a +N row, in CSS px. */
export function statusListHeight(rows: readonly StatusRow[], hidden: number): number {
  const gaps = rows.filter((r, i) => i > 0 && rows[i - 1].group !== r.group).length;
  return STATUS_LIST_PADDING + (rows.length + (hidden > 0 ? 1 : 0)) * STATUS_ROW_HEIGHT + gaps * PROJECT_GAP;
}

/**
 * The capped rows that fit in `maxHeight` px: up to {@link STATUS_ROW_CAP} rows, fewer on a
 * short window, with the same priority as {@link capStatusRows}. When not even one row fits, the
 * list is the +N row alone. A null `maxHeight` (not measured yet) applies the cap only.
 */
export function fitStatusRows(rows: readonly StatusRow[], maxHeight: number | null): { rows: StatusRow[]; hidden: number } {
  for (let cap = STATUS_ROW_CAP; cap > 1; cap--) {
    const capped = capStatusRows(rows, cap);
    if (maxHeight === null || statusListHeight(capped.rows, capped.hidden) <= maxHeight) return capped;
  }
  return capStatusRows(rows, 1);
}
