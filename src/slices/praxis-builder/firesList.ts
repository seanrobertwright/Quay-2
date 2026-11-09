// A graph trigger's Fires list (#469, #478): `praxis triggers fires <name> --json` through the
// Praxis CLI runner (#474), read in `aiws-graph-trigger-fires/1`, newest first. It has no UI of its
// own. It is polled while the Fires panel is on screen through the Runs list's poller and
// newest-request guard (#452), with the same delays and stop rules: 15 s while the host answers, 60 s
// after any failure, nothing while the panel is off screen, and only the newest read's answer kept.
import { invoke } from "@tauri-apps/api/core";
import { parseUtcTimestamp } from "../../lib/dates.ts";
import { createNewestRequest } from "./newestRequest.ts";
import { createPoller } from "./poller.ts";
import { isHostLevelFailure, outcomeMessage, praxisCall, type CallOutcome, type Invoker } from "./praxisHost.ts";
import { RUNS_FAILING_POLL_MS, RUNS_FIRST_LIMIT, RUNS_POLL_MS } from "./runsList.ts";

/** How many fires the list asks for first: the newest 20, as for runs. */
export const FIRES_FIRST_LIMIT = RUNS_FIRST_LIMIT;

/**
 * The most fires one `praxis triggers fires` page gives, and the backend's `MAX_PAGE_LIMIT`, which
 * `praxis_host_trigger_fires` checks `limit` against. Older fires than one page holds aren't shown.
 */
export const FIRES_MAX_LIMIT = 100;

/** The disposition of a fire that created a graph run. */
export const ADMITTED = "ADMITTED";

/** One fire, as the list shows it. */
export interface FireRow {
  fireId: number;
  /** When the host received the occurrence, in ms since the epoch; null when its time can't be read. */
  receivedAt: number | null;
  /** The host's receipt time as it wrote it. */
  receivedAtText: string;
  /** `ADMITTED`, `FILTERED`, `REFUSED` or `SKIPPED`, as the host gives it. */
  disposition: string;
  /** The host's reason code, such as `RUN_HELD`; null for none. */
  reason: string | null;
  /** The graph run an admitted fire created; null for every other fire. */
  workOrderId: string | null;
  /** How many slots a `SKIPPED` fire stands for; null when it isn't one or the host doesn't say. */
  skippedCount: number | null;
}

/** What the Fires panel draws. */
export interface FiresListView {
  /** The fires of the last read, newest first; null before the first. */
  fires: FireRow[] | null;
  /** When the shown list was read, in ms since the epoch; null before the first. */
  readAt: number | null;
  /** True while the shown list may be out of date because the host can't be used. */
  dimmed: boolean;
  /** Why the last read failed, in praxis's or Quay's words; null when it didn't. */
  problem: string | null;
  /** How many fires the list asks for. */
  limit: number;
  /** True when Show more is offered: the host holds older fires than the first limit shows. */
  canShowMore: boolean;
  /** True when the list is at `FIRES_MAX_LIMIT` and the host holds older fires it can't show. */
  atCap: boolean;
}

export interface FiresList {
  /** The Fires panel is on screen, or has left it. Leaving stops the poller and kills its call. */
  set(onScreen: boolean): void;
  view(): FiresListView;
  /** Raises the limit to `FIRES_MAX_LIMIT` and reads at once. */
  showMore(): void;
  /** Reads at once. */
  refresh(): void;
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Stops for good, killing the call in flight. */
  dispose(): void;
}

export interface FiresListOptions {
  projectPath: string;
  /** The graph trigger whose fires are listed. */
  name: string;
  call?: Invoker;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One entry of `aiws-graph-trigger-fires/1`, or null when it lacks a field the list shows. */
function parseFire(v: unknown): FireRow | null {
  if (!isObject(v)) return null;
  const { fireId, receivedAt, disposition, reason = null, workOrderId = null, skipped = null } = v;
  if (typeof fireId !== "number" || typeof receivedAt !== "string" || typeof disposition !== "string") return null;
  if ((reason !== null && typeof reason !== "string") || (workOrderId !== null && typeof workOrderId !== "string")) return null;
  const skippedCount = isObject(skipped) && typeof skipped.count === "number" ? skipped.count : null;
  return { fireId, receivedAt: parseUtcTimestamp(receivedAt), receivedAtText: receivedAt, disposition, reason, workOrderId, skippedCount };
}

type Shown = Pick<FiresListView, "fires" | "readAt" | "dimmed" | "problem"> & {
  /** Whether the host said it holds older fires than the shown page; null when it didn't say. */
  older: boolean | null;
};

function viewOf({ older, ...shown }: Shown, limit: number): FiresListView {
  // The page's `nextBefore` says whether older fires exist; without it, a full page may have more.
  const more = older ?? (shown.fires?.length ?? 0) >= limit;
  return { ...shown, limit, canShowMore: limit < FIRES_MAX_LIMIT && more, atCap: limit >= FIRES_MAX_LIMIT && more };
}

const NOTHING_SHOWN: Shown = { fires: null, readAt: null, dimmed: false, problem: null, older: null };

/** A list's view before its first read. */
export const INITIAL_FIRES_VIEW: FiresListView = viewOf(NOTHING_SHOWN, FIRES_FIRST_LIMIT);

export function createFiresList({ projectPath, name, call = invoke }: FiresListOptions): FiresList {
  let limit = FIRES_FIRST_LIMIT;
  let shown = NOTHING_SHOWN;
  let view = INITIAL_FIRES_VIEW;
  const listeners = new Set<() => void>();
  const requests = createNewestRequest();
  let disposed = false;

  const changed = () => {
    if (disposed) return;
    view = viewOf(shown, limit);
    for (const listener of listeners) listener();
  };

  const poller = createPoller(async (signal) => {
    const id = requests.begin();
    const outcome = await praxisCall("praxis_host_trigger_fires", { projectPath, name, limit }, signal, call);
    if (!requests.isNewest(id) || disposed) return null;
    return recordAndNextDelay(outcome);
  });

  /**
   * Keeps the newest read's outcome and returns the wait before the next read: 15 s after a list,
   * 60 s after any failure. The last list stays; only a host-level failure dims it.
   */
  function recordAndNextDelay(outcome: CallOutcome): number {
    if (outcome.kind === "cancelled") return RUNS_POLL_MS;
    if (outcome.kind === "record" && Array.isArray(outcome.record.fires)) {
      const fires = outcome.record.fires.map(parseFire).filter((f): f is FireRow => f !== null);
      const { nextBefore } = outcome.record;
      const older = nextBefore === null ? false : typeof nextBefore === "number" ? true : null;
      shown = { fires, readAt: Date.now(), dimmed: false, problem: null, older };
      changed();
      return RUNS_POLL_MS;
    }
    shown = { ...shown, dimmed: isHostLevelFailure(outcome), problem: problemOf(outcome) };
    changed();
    return RUNS_FAILING_POLL_MS;
  }

  function problemOf(outcome: CallOutcome): string {
    if (outcome.kind === "record") return "praxis gave a fires list Quay can't read.";
    if (outcome.kind === "hostRefused" && outcome.hostCode === "NOT_FOUND") return `The host has no trigger ${name}, so it has no fires.`;
    return outcomeMessage(outcome);
  }

  return {
    set(onScreen) {
      if (disposed) return;
      if (!onScreen) requests.drop();
      poller.set(onScreen);
    },
    view: () => view,
    showMore() {
      if (disposed || limit === FIRES_MAX_LIMIT) return;
      limit = FIRES_MAX_LIMIT;
      changed();
      poller.now();
    },
    refresh() {
      if (!disposed) poller.now();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      requests.drop();
      poller.stop();
      listeners.clear();
    },
  };
}
