// A workflow template's Runs list (#362, #452): `praxis runs <name> --json` through the Praxis CLI
// runner (#446), polled while the Runs view is on screen. It has no UI of its own.
import { invoke } from "@tauri-apps/api/core";
import { parseUtcTimestamp } from "../../lib/dates.ts";
import { HOST_RECHECK_MS } from "./hostRecheck.ts";
import { createNewestRequest } from "./newestRequest.ts";
import { createPoller } from "./poller.ts";
import { isHostLevelFailure, outcomeMessage, praxisCall, type CallOutcome, type Invoker } from "./praxisHost.ts";

/** How often the list is read while the host answers. */
export const RUNS_POLL_MS = 15_000;

/** How often it is read after any failed read, host-level or not: the host recheck's interval, as every failing state polls. */
export const RUNS_FAILING_POLL_MS = HOST_RECHECK_MS;

/** How many runs the list asks for first: `praxis runs`'s own default. */
export const RUNS_FIRST_LIMIT = 20;

/**
 * The most runs `praxis runs --limit` lists, and the backend's `MAX_RUNS_LIMIT`. `runs` has no
 * cursor, so older runs can't be listed at all.
 */
export const RUNS_MAX_LIMIT = 100;

/**
 * The run status that waits for a person's approval. The host's status vocabulary is
 * provisional and not enumerated by `aiws-workflow-runs/1`, so this is the one status Quay names.
 */
export const AWAITING_APPROVAL = "AWAITING_APPROVAL";

/** One run, as the list shows it. */
export interface RunRow {
  workOrderId: string;
  runId: string;
  revision: number;
  /** When the run was created, in ms since the epoch; null when the host's time can't be read. */
  createdAt: number | null;
  /** The host's creation time as it wrote it. */
  createdAtText: string;
  status: string;
  stage: string;
  control: string;
  held: boolean;
  /** True when the run waits for a person: awaiting approval, or held. Both are decided in the browser. */
  needsYou: boolean;
}

/** What the Runs view draws. */
export interface RunsListView {
  /** The runs of the last list read, newest first; null before the first. */
  runs: RunRow[] | null;
  /** When the shown list was read, in ms since the epoch; null before the first. */
  readAt: number | null;
  /** True while the shown list may be out of date because the host can't be used. */
  dimmed: boolean;
  /** Why the last read failed, in praxis's or Quay's words; null when it didn't. */
  problem: string | null;
  /** How many runs the list asks for. */
  limit: number;
  /** True when Show more is offered: the list is full at the first limit. */
  canShowMore: boolean;
  /** True when the list holds `RUNS_MAX_LIMIT` runs, so older ones can't be shown. */
  atCap: boolean;
  /** True when the host that answered is simulated, so its approvals aren't a person's. */
  simulated: boolean;
}

/** Where a run's page on the host is, or why Quay couldn't find out. */
export type RunPageLookup = { address: string } | { problem: string };

export interface RunsList {
  /** The Runs view is on screen, or has left it. Leaving stops the poller and kills its call. */
  set(onScreen: boolean): void;
  view(): RunsListView;
  /** Raises the limit to `RUNS_MAX_LIMIT` and reads at once. */
  showMore(): void;
  /** The address of run `workOrderId`'s page, from `praxis status`. */
  runPage(workOrderId: string): Promise<RunPageLookup>;
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Stops for good, killing every call in flight. */
  dispose(): void;
}

export interface RunsListOptions {
  projectPath: string;
  name: string;
  call?: Invoker;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One `aiws-workflow-runs/1` entry, or null when it lacks a field the list shows. */
function parseRun(v: unknown): RunRow | null {
  if (!isObject(v)) return null;
  const { workOrderId, runId, revision, createdAt, status, stage, control, held } = v;
  if (typeof workOrderId !== "string" || typeof runId !== "string" || typeof revision !== "number") return null;
  if (typeof createdAt !== "string" || typeof status !== "string" || typeof stage !== "string") return null;
  if (typeof control !== "string" || typeof held !== "boolean") return null;
  return {
    workOrderId,
    runId,
    revision,
    createdAt: parseUtcTimestamp(createdAt),
    createdAtText: createdAt,
    status,
    stage,
    control,
    held,
    needsYou: held || status === AWAITING_APPROVAL,
  };
}

type Shown = Pick<RunsListView, "runs" | "readAt" | "dimmed" | "problem" | "simulated">;

function viewOf(shown: Shown, limit: number): RunsListView {
  const count = shown.runs?.length ?? 0;
  return { ...shown, limit, canShowMore: limit < RUNS_MAX_LIMIT && count >= limit, atCap: count >= RUNS_MAX_LIMIT };
}

const NOTHING_SHOWN: Shown = { runs: null, readAt: null, dimmed: false, problem: null, simulated: false };

/** A list's view before its first read. */
export const INITIAL_RUNS_VIEW: RunsListView = viewOf(NOTHING_SHOWN, RUNS_FIRST_LIMIT);

export function createRunsList({ projectPath, name, call = invoke }: RunsListOptions): RunsList {
  let limit = RUNS_FIRST_LIMIT;
  let shown = NOTHING_SHOWN;
  let view = INITIAL_RUNS_VIEW;
  const listeners = new Set<() => void>();
  const requests = createNewestRequest();
  // The run page lookups in flight, aborted by `dispose`.
  const lookups = new Set<AbortController>();
  let disposed = false;

  const changed = () => {
    if (disposed) return;
    view = viewOf(shown, limit);
    for (const listener of listeners) listener();
  };

  const poller = createPoller(async (signal) => {
    const id = requests.begin();
    const outcome = await praxisCall("praxis_host_runs", { projectPath, name, limit }, signal, call);
    if (!requests.isNewest(id) || disposed) return null;
    return recordAndNextDelay(outcome);
  });

  /**
   * Keeps the newest read's outcome and returns the wait before the next read: 15 s after a list,
   * 60 s after any failure. The last list stays; only a host-level failure dims it.
   */
  function recordAndNextDelay(outcome: CallOutcome): number {
    if (outcome.kind === "cancelled") return RUNS_POLL_MS;
    if (outcome.kind === "record" && Array.isArray(outcome.record.runs)) {
      const rows = outcome.record.runs.map(parseRun).filter((r): r is RunRow => r !== null);
      shown = { runs: rows, readAt: Date.now(), dimmed: false, problem: null, simulated: outcome.record.simulatedIdentity === true };
      changed();
      return RUNS_POLL_MS;
    }
    const problem = outcome.kind === "record" ? "praxis gave a runs list Quay can't read." : outcomeMessage(outcome);
    shown = { ...shown, dimmed: isHostLevelFailure(outcome), problem };
    changed();
    return RUNS_FAILING_POLL_MS;
  }

  return {
    set(onScreen) {
      if (disposed) return;
      if (!onScreen) requests.drop();
      poller.set(onScreen);
    },
    view: () => view,
    showMore() {
      if (disposed || limit === RUNS_MAX_LIMIT) return;
      limit = RUNS_MAX_LIMIT;
      changed();
      poller.now();
    },
    async runPage(workOrderId) {
      const controller = new AbortController();
      lookups.add(controller);
      try {
        const outcome = await praxisCall("praxis_host_status", { projectPath, workOrderId }, controller.signal, call);
        if (outcome.kind !== "record") return { problem: outcomeMessage(outcome) };
        const address = outcome.record.runPageAddress;
        return typeof address === "string" ? { address } : { problem: "praxis gave no address for this run's page." };
      } finally {
        lookups.delete(controller);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      requests.drop();
      poller.stop();
      for (const lookup of lookups) lookup.abort();
      lookups.clear();
      listeners.clear();
    },
  };
}
