// A template run's detail (#362, #453): one run followed by polled `praxis status <wo> --json`
// through the Praxis CLI runner (#446), never `praxis follow`, whose `--json` gives only a final
// view. It has no UI of its own; the Runs view draws it on the template's stage strip.
//
// `coding-operator-view/1` isn't a contracted read model (#361), so only the fields drawn are
// read, each leniently: a field that is missing or of another type falls back to the run's row
// in the Runs list, or to nothing.
import { invoke } from "@tauri-apps/api/core";
import { HOST_RECHECK_MS } from "./hostRecheck.ts";
import { hasOwn, isObject } from "./model.ts";
import { createNewestRequest } from "./newestRequest.ts";
import { createPoller } from "./poller.ts";
import { isHostLevelFailure, outcomeMessage, praxisCall, type CallOutcome, type Invoker } from "./praxisHost.ts";
import type { RunRow } from "./runsList.ts";
import type { StageKey } from "./template.ts";

/** The wait after a read that found the run changed. */
export const FOLLOW_FIRST_MS = 3_000;

/** The longest wait while the run doesn't change; each unchanged read doubles the wait up to it. */
export const FOLLOW_MAX_MS = 15_000;

/** The wait while the run waits for a person, held or awaiting a decision: it changes only when they decide. */
export const FOLLOW_WAITING_MS = FOLLOW_MAX_MS;

/** The wait after a failed read: the host recheck's interval, as every failing state polls. */
export const FOLLOW_FAILING_MS = HOST_RECHECK_MS;

/** The `pending` items a person decides in the host's browser page (`browserDecisions` in praxis-follow.ts at the SDK pin). */
const BROWSER_DECISIONS: Readonly<Record<string, string>> = {
  HUMAN_APPROVAL: "approval",
  HUMAN_ACCEPTANCE: "acceptance of the deliverable",
  EVIDENCE_REVIEW: "a review of the validation evidence",
  HOLD_DECISION: "a decision on the hold",
  RECONCILIATION: "reconciliation",
  RESTART_REVIEW: "a restart review",
  RESUME_CONTROL: "resuming: the run is paused",
};

/** One way out of a hold, as its card offers it. Quay never takes one; the browser does. */
export interface HoldExit {
  /** The exit's name in the card, or its label when the card gives none. */
  id: string;
  label: string;
  does: string;
  available: boolean;
}

/** What the hold panel draws, from the operator view's `holdCard` (`aiws-hold-card/1`, not contracted). */
export interface HoldPanel {
  /** The card's reason in words, or the run's reason when it has no card, as for pending reconciliation. */
  reason: string;
  cause: string | null;
  phase: string | null;
  evidence: string | null;
  notes: string[];
  exits: HoldExit[];
}

/** A run as its detail draws it. */
export interface RunDetail {
  workOrderId: string;
  runId: string;
  revision: number | null;
  status: string;
  stage: string;
  control: string;
  held: boolean;
  /** The stage the run is at on the strip: where it waits or works, or where it stopped when held; null once it ended or when Quay can't place it. */
  current: StageKey | null;
  /** The stages the run has finished, as the strip checks them. */
  finished: StageKey[];
  /** The correction rounds the run has started; null when its attempts don't say. */
  corrections: number | null;
  /** The decisions the run waits for in the browser, in words; empty when it waits for none. */
  decisions: string[];
  /** True when the run waits for a person in the browser. */
  waiting: boolean;
  /** The hold panel, for a held run; null for any other. */
  hold: HoldPanel | null;
  /** The run page's address, as praxis gave it; null before `status` gave one. */
  runPageAddress: string | null;
  /** praxis's certificate hint, when its last `status` gave one. */
  trustHint: string | null;
  /** True when the hint asks for `praxis trust`, which Quay opens in a visible terminal. */
  offersTrust: boolean;
  /** True when the run ended: succeeded or cancelled. It is no longer read. */
  ended: boolean;
  simulated: boolean;
}

/** What the run detail draws. */
export interface RunFollowView {
  /** The run as last read, else as its row lists it; null before either. */
  run: RunDetail | null;
  /** When the run was last read, in ms since the epoch; null before the first. */
  readAt: number | null;
  /** True while the shown run may be out of date because the host can't be used. */
  dimmed: boolean;
  /** Why the last read failed, in praxis's or Quay's words; null when it didn't. */
  problem: string | null;
}

export const INITIAL_FOLLOW_VIEW: RunFollowView = { run: null, readAt: null, dimmed: false, problem: null };

export interface RunFollow {
  /** The run detail is on screen, or has left it. Leaving stops the poller and kills its call. */
  set(onScreen: boolean): void;
  /** The run's row from the Runs list's last read, the fallback for every field the view lacks. */
  setRow(row: RunRow | null): void;
  view(): RunFollowView;
  subscribe(listener: () => void): () => void;
  /** Stops for good, killing the call in flight. */
  dispose(): void;
}

export interface RunFollowOptions {
  projectPath: string;
  workOrderId: string;
  call?: Invoker;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

const STAGE_OF: Readonly<Record<string, StageKey>> = {
  IMPLEMENTATION: "implementation",
  VALIDATION: "validation",
  CORRECTION: "correction",
  ACCEPTANCE: "acceptance",
};

/** The strip's stages in the order a run passes them, a correction looping back to validation. */
const ORDER: readonly StageKey[] = ["approve", "implementation", "validation", "correction", "acceptance"];

/** Where a run of `status` at `stage` stands on the strip; null once it succeeded or when Quay can't place it. */
function placeOf(status: string, stage: string): StageKey | null {
  if (status === "SUCCEEDED") return null;
  if (status === "AWAITING_ACCEPTANCE") return "acceptance";
  if (status === "AWAITING_APPROVAL") return stage === "CORRECTION" ? "correction" : "approve";
  return STAGE_OF[stage] ?? null;
}

/**
 * The correction rounds `attempts` started. A coding run's stages run in one order, each stage
 * one task: implementation, then validation and correction in turn, so the n-th task among the
 * attempts names its stage (`attemptProgress` in praxis-follow.ts at the SDK pin), and every
 * task after the first at an even place is a correction. Null when the attempts don't say: none
 * listed, or a history cut short, whose first task isn't the implementation.
 */
function correctionsOf(view: Obj): number | null {
  if (!Array.isArray(view.attempts) || view.historyTruncated === true) return null;
  const attempts = view.attempts.filter(isObject);
  const sorted = [...attempts].sort(
    (a, b) => String(a.authorized_at).localeCompare(String(b.authorized_at)) || String(a.attempt_id).localeCompare(String(b.attempt_id)),
  );
  const tasks = [...new Set(sorted.map((a) => String(a.task_id)))];
  return tasks.filter((_, n) => n >= 2 && n % 2 === 0).length;
}

/** The stages a run at `current` has finished. Correction counts only once a round has started. */
function finishedOf(status: string, current: StageKey | null, corrections: number | null): StageKey[] {
  const corrected = (corrections ?? 0) > 0;
  if (status === "SUCCEEDED") return ORDER.filter((s) => s !== "correction" || corrected);
  if (current === null) return [];
  const before: StageKey[] = ORDER.slice(0, ORDER.indexOf(current)).filter((s) => s !== "correction");
  if (corrected && current !== "correction" && current !== "approve" && current !== "implementation") before.push("correction");
  return ORDER.filter((s) => before.includes(s));
}

/** The hold panel of a held run: its card, or the run's reason for a hold without one. */
function holdOf(card: unknown, reason: string | null): HoldPanel {
  if (!isObject(card)) return { reason: reason ?? "praxis gave no reason.", cause: null, phase: null, evidence: null, notes: [], exits: [] };
  const exits = (Array.isArray(card.exits) ? card.exits : []).filter(isObject).flatMap((e) => {
    const label = str(e.label);
    return label === null ? [] : [{ id: str(e.exit) ?? label, label, does: str(e.does) ?? "", available: e.available !== false }];
  });
  return {
    reason: str(card.reasonText) ?? reason ?? "praxis gave no reason.",
    cause: str(card.cause),
    phase: str(card.phaseText),
    evidence: str(card.evidence),
    notes: strings(card.notes),
    exits,
  };
}

/**
 * The run as its detail draws it, from `praxis status`'s operator view where it has a field and
 * the run's row where it doesn't. Null when neither names the run.
 */
export function runDetailOf(view: Obj | null, row: RunRow | null, trustHint: string | null, workOrderId: string): RunDetail | null {
  if (view === null && row === null) return null;
  const v = view ?? {};
  const control = isObject(v.control) ? str(v.control.status) : null;
  const status = str(v.status) ?? row?.status ?? "";
  const stage = str(v.stage) ?? row?.stage ?? "";
  const pending = strings(v.pending);
  // Held as praxis's own follow tells it (`isHeld`): its status, an open hold card, or pending reconciliation.
  const held = view === null ? (row?.held ?? false) : status === "HELD" || isObject(v.holdCard) || pending.includes("RECONCILIATION");
  const decisions = pending.filter((p) => hasOwn(BROWSER_DECISIONS, p)).map((p) => (p === "HUMAN_APPROVAL" && stage === "CORRECTION" ? "approval of the correction" : BROWSER_DECISIONS[p]));
  const corrections = view === null ? null : correctionsOf(v);
  const holdStage = isObject(v.holdCard) ? (STAGE_OF[str(v.holdCard.stage) ?? ""] ?? null) : null;
  // A held run stands where its hold card says it stopped, else where its stage places it.
  const current = (held ? holdStage : null) ?? placeOf(status, stage);
  const shownControl = control ?? row?.control ?? "";
  return {
    workOrderId,
    runId: str(v.runId) ?? row?.runId ?? workOrderId,
    revision: typeof v.revision === "number" ? v.revision : (row?.revision ?? null),
    status,
    stage,
    control: shownControl,
    held,
    current,
    finished: finishedOf(status, current, corrections),
    corrections,
    decisions,
    waiting: held || decisions.length > 0 || status.startsWith("AWAITING_"),
    hold: held ? holdOf(v.holdCard, str(v.reason)) : null,
    runPageAddress: str(v.runPageAddress),
    trustHint,
    offersTrust: trustHint !== null && trustHint.includes("praxis trust"),
    ended: status === "SUCCEEDED" || shownControl === "CANCELED",
    simulated: v.simulatedIdentity === true,
  };
}

/** What a read compares to tell whether the run changed: what praxis's own follow compares, and its decisions. */
function fingerprint(view: Obj): string {
  const attempts = Array.isArray(view.attempts) ? view.attempts.filter(isObject).map((a) => [a.attempt_id, a.delivery_status, a.status]) : null;
  const control = isObject(view.control) ? view.control.status : null;
  return JSON.stringify([view.revision, view.status, view.stage, control, view.pending, view.holdCard ? true : false, attempts]);
}

export function createRunFollow({ projectPath, workOrderId, call = invoke }: RunFollowOptions): RunFollow {
  let row: RunRow | null = null;
  let record: Obj | null = null;
  let trustHint: string | null = null;
  let shown: Omit<RunFollowView, "run"> = { readAt: null, dimmed: false, problem: null };
  let view = INITIAL_FOLLOW_VIEW;
  // The wait the next unchanged read doubles, and what the last read saw.
  let interval = FOLLOW_FIRST_MS;
  let last: string | null = null;
  const listeners = new Set<() => void>();
  const requests = createNewestRequest();
  let disposed = false;

  const changed = () => {
    if (disposed) return;
    view = { ...shown, run: runDetailOf(record, row, trustHint, workOrderId) };
    for (const listener of listeners) listener();
  };

  const poller = createPoller(async (signal) => {
    const id = requests.begin();
    const outcome = await praxisCall("praxis_host_status", { projectPath, workOrderId }, signal, call);
    if (!requests.isNewest(id) || disposed) return null;
    return recordAndNextDelay(outcome);
  });

  /**
   * Keeps the newest read's outcome and returns the wait before the next read: none once the run
   * ended, 15 s while it waits for a person, 3 s after a change, doubling to 15 s while nothing
   * changes, and 60 s after any failure. The last run read stays; only a host-level failure dims it.
   */
  function recordAndNextDelay(outcome: CallOutcome): number | null {
    if (outcome.kind === "cancelled") return interval;
    if (outcome.kind === "record") {
      record = outcome.record;
      trustHint = outcome.trustHint ?? null;
      shown = { readAt: Date.now(), dimmed: false, problem: null };
      changed();
      const seen = fingerprint(outcome.record);
      interval = seen === last ? Math.min(interval * 2, FOLLOW_MAX_MS) : FOLLOW_FIRST_MS;
      last = seen;
      const run = view.run;
      if (run?.ended) return null;
      if (run?.waiting) return FOLLOW_WAITING_MS;
      return interval;
    }
    shown = { ...shown, dimmed: isHostLevelFailure(outcome), problem: outcomeMessage(outcome) };
    changed();
    return FOLLOW_FAILING_MS;
  }

  return {
    set(onScreen) {
      if (disposed) return;
      if (!onScreen) requests.drop();
      poller.set(onScreen);
    },
    setRow(next) {
      if (disposed || next === row) return;
      row = next;
      changed();
    },
    view: () => view,
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
