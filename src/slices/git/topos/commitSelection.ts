// Moving the commit selection by key (#368, #397, #398): a selected commit moved by the arrows,
// PageUp/PageDown and Home/End, with Ctrl+C copying its SHA and Enter moving to the inspector, and
// a second commit to compare picked with Ctrl and those keys, then Ctrl+Space or Shift+Space.

import { ROW_HEIGHT } from "./graphWindow.ts";

export type SelectionStep = "up" | "down" | "pageUp" | "pageDown" | "home" | "end";

/**
 * `move` selects the row it lands on; `cursor` moves the active row without selecting, and `add`
 * adds the active row as the second commit to compare.
 */
export type SelectionKey =
  | { kind: "move"; step: SelectionStep }
  | { kind: "cursor"; step: SelectionStep }
  | { kind: "add" }
  | { kind: "copy" }
  | { kind: "inspect" };

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
 * take no modifier. Ctrl (Cmd on a Mac) with a move key moves the cursor without selecting, and
 * Ctrl+Space or Shift+Space adds the cursor's commit as the second one, as a Ctrl- or Shift-click
 * does. Ctrl+C copies. Nothing applies in a text field.
 */
export function selectionKey(e: KeyPress, inTextField: boolean): SelectionKey | null {
  if (inTextField || e.altKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !e.shiftKey && e.key.toLowerCase() === "c") return { kind: "copy" };
  if (e.key === " " && ctrl !== e.shiftKey) return { kind: "add" };
  if (ctrl && !e.shiftKey) {
    const step = STEPS[e.key];
    return step === undefined ? null : { kind: "cursor", step };
  }
  if (ctrl || e.shiftKey) return null;
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

/**
 * The commits selected in the graph (#368, #398): none, one, or two to compare. The type allows
 * no more than two. `swapped` says the operator reversed the pair the older/newer rule ordered.
 */
export type CommitSelection =
  | { kind: "none" }
  | { kind: "one"; oid: string }
  | { kind: "two"; first: string; second: string; swapped: boolean };

/**
 * What changes the selection: `pick` is a plain click or a move, `add` a Ctrl- or Shift-click or
 * its key, `swap` the Swap button, `clear` a new repo.
 */
export type SelectionAction = { kind: "pick"; oid: string } | { kind: "add"; oid: string } | { kind: "swap" } | { kind: "clear" };

/**
 * The selection after `action`. A pick selects that one commit. An add makes a second commit, and
 * a third replaces the second, so at most two are ever selected; adding a commit already selected
 * changes nothing. A new pair starts in the rule's order, and Swap flips it.
 */
export function selectCommits(state: CommitSelection, action: SelectionAction): CommitSelection {
  switch (action.kind) {
    case "clear":
      return { kind: "none" };
    case "pick":
      return { kind: "one", oid: action.oid };
    case "swap":
      return state.kind === "two" ? { ...state, swapped: !state.swapped } : state;
    case "add":
      switch (state.kind) {
        case "none":
          return { kind: "one", oid: action.oid };
        case "one":
          return state.oid === action.oid ? state : { kind: "two", first: state.oid, second: action.oid, swapped: false };
        case "two":
          if (action.oid === state.first || action.oid === state.second) return state;
          return { kind: "two", first: state.first, second: action.oid, swapped: false };
      }
  }
}

/** The selected commits' oids, the first one first. */
export function selectedOids(state: CommitSelection): string[] {
  switch (state.kind) {
    case "none":
      return [];
    case "one":
      return [state.oid];
    case "two":
      return [state.first, state.second];
  }
}

/** One commit of a compared pair, as `git_compare_order` returns it. */
export interface ComparedCommit {
  oid: string;
  subject: string;
}

/** A pair ordered by the rule (#368): the ancestor, or else the earlier committer date, first. */
export interface CompareOrder {
  older: ComparedCommit;
  newer: ComparedCommit;
}

/** The direction a pair is diffed in: older to newer, or newer to older once swapped. */
export function comparedPair(order: CompareOrder, swapped: boolean): { from: ComparedCommit; to: ComparedCommit } {
  return swapped ? { from: order.newer, to: order.older } : { from: order.older, to: order.newer };
}
