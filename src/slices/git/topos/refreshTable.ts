// What Topos refetches when its repository changes (#354, #379). The backend's watcher sends
// `git-repo-changed` with dirty bits; this module is the one place that says what each bit
// refreshes, runs one refresh at a time, and drops answers a newer request has overtaken.

import type { GitRefs } from "./graphRefs.ts";

/** The dirty bits of `git-repo-changed`, from `src-tauri/src/slices/git/graph/watch.rs`. */
export interface Dirty {
  /** A branch, remote or tag ref, or another worktree's HEAD. */
  refs: boolean;
  /** The selected worktree's HEAD. */
  head: boolean;
  /** The selected worktree's index. */
  index: boolean;
  /** A file in the selected worktree. */
  worktree: boolean;
  /** A merge, rebase, cherry-pick or revert started, stepped or ended. */
  operation: boolean;
}

/** The payload of the global `git-repo-changed` event. */
export interface RepoChanged {
  repoRoot: string;
  worktreePath: string;
  dirty: Dirty;
  /** Whether a rebase or sequencer directory exists, during which the graph waits. */
  inOperation: boolean;
}

export const ALL_DIRTY: Dirty = { refs: true, head: true, index: true, worktree: true, operation: true };

/**
 * What a commit from Topos changed (#388): HEAD, its branch's ref, the index, and a merge it
 * concluded. The composer requests it with the new HEAD's oid, so the graph needn't wait for the
 * watcher.
 */
export const COMMIT_DIRTY: Dirty = { refs: true, head: true, index: true, worktree: false, operation: true };

/**
 * When the graph re-runs its `git log`: never, always, if the selected worktree's new HEAD isn't a
 * loaded row, if the set of tip oids changed, or if either.
 */
export type GraphRule = "no" | "yes" | "ifHeadNotLoaded" | "ifTipsChanged" | "ifHeadNotLoadedOrTipsChanged";

/** What one refresh refetches. */
export interface RefreshPlan {
  /** The selected worktree's status. */
  status: boolean;
  /** The open file diff. */
  diff: boolean;
  /** `git_refs`: badges, worktree HEADs and the HEAD marker. */
  refs: boolean;
  /** The in-progress operation banner. */
  banner: boolean;
  graph: GraphRule;
  /** The graph would re-run, but an operation is under way: hold it until the operation ends. */
  holdGraph: boolean;
}

export interface RefreshState {
  /** Whether a rebase or sequencer directory exists now. */
  inOperation: boolean;
  /** Whether a graph refresh was held during an operation. */
  graphHeld: boolean;
}

/**
 * The refresh table:
 *
 * | Dirty bit | Refetch | Graph |
 * | --- | --- | --- |
 * | `worktree` | status, the open diff | no |
 * | `index` | status, the open diff | no |
 * | `head` | refs, HEAD marker, status | only if the new HEAD oid is not a loaded row |
 * | `refs` | refs | only if the set of tip oids changed |
 * | `operation` | status, the banner | the held graph refresh runs when the operation ends |
 *
 * While a rebase or sequencer runs, only HEAD and status refresh and the graph is held. Every bit
 * dirty at once means the watcher rescanned or overflowed, and everything refreshes.
 */
export function planRefresh(dirty: Dirty, state: RefreshState): RefreshPlan {
  const everything = dirty.refs && dirty.head && dirty.index && dirty.worktree && dirty.operation;
  let graph: GraphRule = everything
    ? "yes"
    : dirty.head && dirty.refs
      ? "ifHeadNotLoadedOrTipsChanged"
      : dirty.head
        ? "ifHeadNotLoaded"
        : dirty.refs
          ? "ifTipsChanged"
          : "no";
  let holdGraph = false;
  if (state.inOperation) {
    holdGraph = graph !== "no";
    graph = "no";
  } else if (state.graphHeld) {
    graph = "yes";
  }
  return {
    status: dirty.worktree || dirty.index || dirty.head || dirty.operation,
    diff: dirty.worktree || dirty.index,
    refs: dirty.refs || dirty.head || graph === "yes",
    banner: dirty.operation,
    graph,
    holdGraph,
  };
}

/** The commits the graph's walk starts from: every branch and remote tip and worktree HEAD. */
export function tipOids(refs: GitRefs): Set<string> {
  const tips = new Set<string>();
  for (const r of refs.refs) if (r.kind !== "tag") tips.add(r.oid);
  for (const w of refs.worktrees) tips.add(w.oid);
  return tips;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export interface GraphFacts {
  /** The tips before the refresh, or null when none were known. */
  tipsBefore: Set<string> | null;
  tipsAfter: Set<string>;
  /** The selected worktree's HEAD after the refresh, or null when it has none. */
  headOid: string | null;
  /** The HEAD a Topos commit just made, which the graph must show, or null. */
  newHeadOid?: string | null;
  isLoaded: (oid: string) => boolean;
}

/** Whether `rule` re-runs the graph, given what the refs refetch found. */
export function graphNeeded(rule: GraphRule, facts: GraphFacts): boolean {
  const tipsChanged = () => facts.tipsBefore === null || !sameSet(facts.tipsBefore, facts.tipsAfter);
  const notLoaded = (oid: string | null | undefined) => oid !== null && oid !== undefined && !facts.isLoaded(oid);
  const headNotLoaded = () => notLoaded(facts.headOid) || notLoaded(facts.newHeadOid);
  switch (rule) {
    case "no":
      return false;
    case "yes":
      return true;
    case "ifHeadNotLoaded":
      return headNotLoaded();
    case "ifTipsChanged":
      return tipsChanged();
    case "ifHeadNotLoadedOrTipsChanged":
      return headNotLoaded() || tipsChanged();
  }
}

function merged(a: Dirty, b: Dirty): Dirty {
  return {
    refs: a.refs || b.refs,
    head: a.head || b.head,
    index: a.index || b.index,
    worktree: a.worktree || b.worktree,
    operation: a.operation || b.operation,
  };
}

/**
 * Runs refreshes one at a time. Changes that arrive during a refresh mark their bits dirty and
 * queue exactly one follow-up, which runs with every bit dirtied meanwhile. A request from a
 * Topos commit carries the new HEAD's oid; a follow-up carries the newest one requested.
 */
export class RefreshQueue {
  private running = false;
  private pending: Dirty | null = null;
  private pendingHead: string | null = null;
  private readonly run: (dirty: Dirty, newHeadOid: string | null) => Promise<void>;
  private readonly onError: (error: unknown) => void;

  constructor(run: (dirty: Dirty, newHeadOid: string | null) => Promise<void>, onError: (error: unknown) => void = console.error) {
    this.run = run;
    this.onError = onError;
  }

  request(dirty: Dirty, newHeadOid: string | null = null): void {
    this.pending = this.pending === null ? dirty : merged(this.pending, dirty);
    if (newHeadOid !== null) this.pendingHead = newHeadOid;
    if (!this.running) this.next();
  }

  private next(): void {
    const dirty = this.pending;
    if (dirty === null) return;
    const newHeadOid = this.pendingHead;
    this.pending = null;
    this.pendingHead = null;
    this.running = true;
    this.run(dirty, newHeadOid)
      .catch(this.onError)
      .finally(() => {
        this.running = false;
        this.next();
      });
  }
}

/**
 * Request ids for refetches whose answers can arrive out of order, such as status, diffs and
 * refs: an answer counts only if no newer request has started since.
 */
export class RequestIds {
  private latest = 0;

  next(): number {
    return ++this.latest;
  }

  isLatest(id: number): boolean {
    return id === this.latest;
  }
}
