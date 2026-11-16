// The Merge undo window: a Merge waits, with Cancel, before it runs. Any Merge button can start it
// (the pie's Merge stroke first, the lane's Merge later), so the job is whatever its caller hands
// in and gets back when the window ends. With the window set to Off nothing counts down and the
// caller is told to open the pull request view's confirm step instead.

/** Idle, or counting down to running `job` at `endsAt`. Times are in ms on one clock. */
export type MergeUndoState<J> = { phase: "idle" } | { phase: "counting"; job: J; startedAt: number; endsAt: number };

/** A Merge asking to start the window of `seconds` (0 is Off), a clock tick, or Cancel. */
export type MergeUndoEvent<J> = { type: "start"; job: J; seconds: number; at: number } | { type: "tick"; at: number } | { type: "cancel" };

/** What the caller does after a step: run the merge, open the confirm step, or nothing. */
export type MergeUndoEffect<J> = { run: "merge"; job: J } | { run: "confirm"; job: J } | null;

export const IDLE: MergeUndoState<never> = { phase: "idle" };

/**
 * The window after `event`, and what to do. A start while one is counting is ignored, so the
 * merge already shown in the toast is the one that runs; Cancel it first to merge another.
 */
export function stepMergeUndo<J>(state: MergeUndoState<J>, event: MergeUndoEvent<J>): { state: MergeUndoState<J>; effect: MergeUndoEffect<J> } {
  switch (event.type) {
    case "start":
      if (state.phase === "counting") return { state, effect: null };
      if (event.seconds <= 0) return { state: IDLE, effect: { run: "confirm", job: event.job } };
      return { state: { phase: "counting", job: event.job, startedAt: event.at, endsAt: event.at + event.seconds * 1000 }, effect: null };
    case "tick":
      if (state.phase !== "counting" || event.at < state.endsAt) return { state, effect: null };
      return { state: IDLE, effect: { run: "merge", job: state.job } };
    case "cancel":
      return { state: IDLE, effect: null };
  }
}

/** Whole seconds left on the window at `at`, as the toast counts them: 5 right after a 5 s start, 1 in its last second. */
export function mergeUndoSecondsLeft(state: MergeUndoState<unknown>, at: number): number {
  return state.phase === "counting" ? Math.max(0, Math.ceil((state.endsAt - at) / 1000)) : 0;
}
