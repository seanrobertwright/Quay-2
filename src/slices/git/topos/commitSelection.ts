// Moving the commit selection by key (#368, #397): one selected commit, moved by the arrows,
// PageUp/PageDown and Home/End, with Ctrl+C copying its SHA and Enter moving to the inspector.

import { ROW_HEIGHT } from "./graphWindow.ts";

export type SelectionStep = "up" | "down" | "pageUp" | "pageDown" | "home" | "end";

export type SelectionKey = { kind: "move"; step: SelectionStep } | { kind: "copy" } | { kind: "inspect" };

interface KeyPress {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const STEPS: Record<string, SelectionStep> = {
  ArrowUp: "up",
  ArrowDown: "down",
  PageUp: "pageUp",
  PageDown: "pageDown",
  Home: "home",
  End: "end",
};

/**
 * What a key on the commit list does to the selection, or null for a key it leaves alone. Moves
 * take no modifier, since Shift and Ctrl with a click or a move are kept for selecting two commits.
 * Ctrl+C (Cmd+C on a Mac) copies. Nothing applies in a text field.
 */
export function selectionKey(e: KeyPress, inTextField: boolean): SelectionKey | null {
  if (inTextField || e.altKey) return null;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "c") return { kind: "copy" };
  if (e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key === "Enter") return { kind: "inspect" };
  const step = STEPS[e.key];
  return step === undefined ? null : { kind: "move", step };
}

export interface SelectionRows {
  /** Rows loaded. */
  rowCount: number;
  /** Rows a page step moves: the viewport's whole rows. */
  pageRows: number;
  /** The first row in view, where a step from no selection lands. */
  firstVisible: number;
}

/** The row `step` moves the selection to from `current` (null for none), or null for no rows. */
export function movedRow(current: number | null, step: SelectionStep, rows: SelectionRows): number | null {
  const last = rows.rowCount - 1;
  if (last < 0) return null;
  const clamp = (row: number) => Math.min(last, Math.max(0, row));
  if (step === "home") return 0;
  if (step === "end") return last;
  if (current === null) return clamp(rows.firstVisible);
  const page = Math.max(1, rows.pageRows);
  switch (step) {
    case "up":
      return clamp(current - 1);
    case "down":
      return clamp(current + 1);
    case "pageUp":
      return clamp(current - page);
    case "pageDown":
      return clamp(current + page);
  }
}

/**
 * The content offset that shows `row` whole in a viewport `viewport` px tall, from `offset`: the
 * same offset when it is already in view, otherwise the nearest one that brings it to the top or
 * the bottom. In content px, so scaled scrolling (#377) maps it onto the scrollbar as for a jump.
 */
export function offsetShowing(offset: number, row: number, viewport: number): number {
  const top = row * ROW_HEIGHT;
  const bottom = top + ROW_HEIGHT;
  if (top < offset) return top;
  if (bottom > offset + viewport) return bottom - viewport;
  return offset;
}
