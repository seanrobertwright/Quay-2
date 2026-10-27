// Copied from the Archon builder (coleam00/Archon b9624b7,
// packages/web/src/experiments/console/builder/editor/history.ts), MIT; see ./NOTICE.
// Quay changes: `Snapshot` is a type parameter, so one history type serves a graph
// workspace and each form draft (#248). Steps merge by gesture key rather than by the
// clock, with an optional sliding window for the arrow-key nudges #264 adds; each step
// carries a label; and a history keeps 100 steps.
/**
 * Pure undo/redo history. The caller threads `History` values through, and time is an
 * explicit parameter so the nudge window is deterministic under test.
 *
 * Snapshots are recorded *before* an edit is applied (they capture the pre-edit state);
 * undo restores the last snapshot and parks the caller's current state on the redo stack.
 * A step with the same merge key as the step before it joins that step instead of adding
 * one, until `endMerge` is called or a step with another key (or none) comes between. A
 * merge key with a window also stops merging after that long without a step; the window
 * slides on every step.
 */

export interface Step {
  /** What the step did, such as "Add task-1", for announcements and menus. */
  label: string;
  /** Present for a step that joins the step before it when that one has the same key. */
  merge?: {
    key: string;
    /** Stop merging once this many milliseconds pass between steps. */
    windowMs?: number;
  };
}

export interface HistoryEntry<S> {
  label: string;
  snapshot: S;
}

/** Immutable history value. Create with `createHistory()`. */
export interface History<S> {
  readonly past: readonly HistoryEntry<S>[];
  readonly future: readonly HistoryEntry<S>[];
  /** The merge of the most recent step, while later steps can still join it. */
  readonly merging: { key: string; windowMs?: number; at: number } | null;
}

/** How long arrow-key nudges of one selection keep merging into one step (#248), once #264 adds them. */
export const NUDGE_WINDOW_MS = 400;
/** The most steps a history keeps; the oldest goes first. */
export const MAX_STEPS = 100;

export function createHistory<S>(): History<S> {
  return { past: [], future: [], merging: null };
}

function joins<S>(h: History<S>, step: Step, now: number): boolean {
  const m = h.merging;
  if (!m || !step.merge || m.key !== step.merge.key || h.past.length === 0) return false;
  return m.windowMs === undefined || now - m.at < m.windowMs;
}

const capped = <S>(entries: readonly HistoryEntry<S>[]) =>
  entries.length > MAX_STEPS ? entries.slice(entries.length - MAX_STEPS) : entries;

/**
 * Records `before`, the state just before `step` changed it, as an undo point. A step that
 * joins the one before it keeps that step's undo point. Any step clears the redo stack.
 */
export function record<S>(h: History<S>, step: Step, before: S, now: number): History<S> {
  const merging = step.merge ? { key: step.merge.key, windowMs: step.merge.windowMs, at: now } : null;
  if (joins(h, step, now)) return { past: h.past, future: [], merging };
  return { past: capped([...h.past, { label: step.label, snapshot: before }]), future: [], merging };
}

/** Ends any merge, so the next step is a step of its own, as a field's blur or Enter does. */
export function endMerge<S>(h: History<S>): History<S> {
  return h.merging ? { ...h, merging: null } : h;
}

export function canUndo<S>(h: History<S>): boolean {
  return h.past.length > 0;
}

export function canRedo<S>(h: History<S>): boolean {
  return h.future.length > 0;
}

/**
 * Steps back. Returns the snapshot to restore, the label of the step undone and the next
 * history value, or `null` when there is nothing to undo. `current` (the caller's live
 * state) moves onto the redo stack. The next step never merges into an undone one.
 */
export function undo<S>(h: History<S>, current: S): { history: History<S>; snapshot: S; label: string } | null {
  const head = h.past[h.past.length - 1];
  if (head === undefined) return null;
  return {
    history: {
      past: h.past.slice(0, -1),
      future: [{ label: head.label, snapshot: current }, ...h.future],
      merging: null,
    },
    snapshot: head.snapshot,
    label: head.label,
  };
}

/**
 * Steps forward. Returns the snapshot to restore, the label of the step redone and the
 * next history value, or `null` when there is nothing to redo. `current` moves onto the
 * undo stack.
 */
export function redo<S>(h: History<S>, current: S): { history: History<S>; snapshot: S; label: string } | null {
  const head = h.future[0];
  if (head === undefined) return null;
  return {
    history: {
      past: capped([...h.past, { label: head.label, snapshot: current }]),
      future: h.future.slice(1),
      merging: null,
    },
    snapshot: head.snapshot,
    label: head.label,
  };
}
