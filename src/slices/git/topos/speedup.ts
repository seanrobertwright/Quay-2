// The speed-up banner's rule (#369, #385). The backend's `git_speedup_check` says which items
// apply; this decides whether the banner offers them.

import type { GitError } from "./gitVersion.ts";

/** `SpeedupItem` from `src-tauri/src/slices/git/speedup.rs`. */
export type SpeedupItem = "commitGraph" | "fsmonitor" | "untrackedCache";

/** What `git_speedup_check` returns. */
export interface SpeedupCheck {
  /** The items not yet in place, in the order the dialog lists them. */
  items: SpeedupItem[];
  /** Whether the operator chose "Don't suggest for this repo". */
  suppressed: boolean;
}

/** The command each item runs, as the dialog shows it (#369). */
export const SPEEDUP_COMMANDS: Record<SpeedupItem, string> = {
  commitGraph: "git commit-graph write --reachable --split",
  fsmonitor: "git config core.fsmonitor true",
  untrackedCache: "git config core.untrackedCache true",
};

/** First rows slower than this offer the speed-ups (#369). */
export const SLOW_FIRST_ROWS_MS = 1_000;
/** A repo with more commits than this and no commit-graph is offered them too (#369). */
export const LARGE_REPO_COMMITS = 50_000;

/** What the graph session has shown of the repo so far. */
export interface GraphLoad {
  /** Whether the first rows took longer than [`SLOW_FIRST_ROWS_MS`], or still haven't come. */
  slowFirstRows: boolean;
  rowsLoaded: number;
  /** Whether the walk has commits beyond the rows loaded. */
  moreRemain: boolean;
  /** Whether the operator closed the banner since the repo opened. */
  dismissed: boolean;
}

/**
 * Whether the banner shows: after slow first rows, or on a repo with more than
 * [`LARGE_REPO_COMMITS`] commits and no commit-graph, unless the check is still out, nothing is
 * left to offer, or the operator turned it away.
 */
export function offerSpeedup(check: SpeedupCheck | null, load: GraphLoad): boolean {
  if (check === null || check.suppressed || load.dismissed || check.items.length === 0) return false;
  if (load.slowFirstRows) return true;
  const large = load.rowsLoaded > LARGE_REPO_COMMITS || (load.rowsLoaded === LARGE_REPO_COMMITS && load.moreRemain);
  return large && check.items.includes("commitGraph");
}

/** `OpEvent` from `src-tauri/src/slices/git/op_runner.rs`. */
export type OpEvent =
  | { event: "progress"; phase: string; percent?: number }
  | { event: "output"; chunk: string }
  | { event: "stalled" }
  | { event: "done" }
  | { event: "failed"; error: GitError };

/**
 * The line the dialog shows for one event of the running apply, or null for an event that
 * doesn't change it: git's other output, and the last event.
 */
export function progressLine(event: OpEvent): string | null {
  switch (event.event) {
    case "progress":
      return event.percent === undefined ? `${event.phase}…` : `${event.phase}: ${event.percent}%`;
    case "stalled":
      return "git has printed nothing for 30 s; it is still running.";
    default:
      return null;
  }
}
