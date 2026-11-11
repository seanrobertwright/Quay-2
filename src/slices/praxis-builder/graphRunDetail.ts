// A graph run's detail (#444, #465, #568): run-level facts only, read from `praxis status <wo>
// --format aiws-graph-operator-view/1 --json` through the same follow as a template run's detail
// (runDetail.ts), so it has the same delays and stop rules. The view's `nodes[]` isn't read. It has
// no UI of its own; GraphRunDetail.tsx draws it.
//
// `aiws-graph-operator-view/1` is `STABLE` (GRAPH-WORKFLOWS.md, "Graph operator view", promoted in
// AI-WS-SDK #659): a field or a value of its closed enums changes only in a new format, which the
// follow refuses. Each open hold is one `aiws-graph-hold-card/1` in its `holds[]`. Only the fields
// drawn are read, and any field Quay doesn't draw is ignored. A drawn field that is missing or of
// another type, from a host that breaks the format, falls back to the run's row in the Runs list,
// or to nothing, so the run is still drawn. The view gives no creation or update time and its
// `revision` is the snapshot's, so those come from the row, whose `workflowRevision` is the
// admitted revision that runs.
import { hasOwn, isObject } from "./model.ts";
import { holdOf, str, strings, type FollowedRun, type FollowSource, type HoldExit, type HoldPanel, type Obj } from "./runDetail.ts";
import type { RunRow } from "./runsList.ts";

/** The view's record format. */
export const GRAPH_RUN_FORMAT = "aiws-graph-operator-view/1";

/** The `status` values of a run that ended: the SDK's terminal run states. */
const ENDED = new Set(["COMPLETED", "FAILED", "CANCELED"]);

/** One open hold of a graph run: its card's `holdId`, and its panel. */
export interface GraphHold extends HoldPanel {
  /** The card's `holdId`; null for a card without one, and for a reconciliation with no card. */
  holdId: string | null;
  /** Tells the run's panels apart: from the `holdId` when the card has one, else from the reason, else `reconciliation`. */
  key: string;
}

/** A graph run as its detail draws it. */
export interface GraphRunDetail extends FollowedRun {
  workOrderId: string;
  runId: string;
  /** The graph workflow's admitted revision that runs, from the run's row; null before the list gave it. */
  revision: number | null;
  status: string;
  /** `SUCCEEDED` or `NOT_SUCCEEDED` once the run ended; null before. */
  outcome: string | null;
  control: string;
  held: boolean;
  /** True while the run waits for its one approval. */
  awaitingApproval: boolean;
  /** When the run was created and last changed, as its row gives them; see `RunRow`. */
  createdAt: number | null;
  createdAtText: string | null;
  updatedAt: number | null;
  updatedAtText: string | null;
  /** The decisions the run waits for in the browser, in words, oldest first; empty when it waits for none. */
  decisions: string[];
  /** One hold panel per open hold; a reconciliation with no hold card gets one of its own. Empty unless held. */
  holds: GraphHold[];
  /** The run page's address, from the view or the row; null when neither gave one. */
  runPageAddress: string | null;
  /** praxis's certificate hint, when its last `status` gave one. */
  trustHint: string | null;
  /** True when the hint asks for `praxis trust`, which Quay opens in a visible terminal. */
  offersTrust: boolean;
  simulated: boolean;
}

/** Each way out of a graph node's hold, in words (GRAPH-WORKFLOWS.md, "Graph runs", "Hold exits"). */
const GRAPH_HOLD_EXITS: Readonly<Record<string, Omit<HoldExit, "id" | "available">>> = {
  RETRY: { label: "Retry", does: "Runs the same operation again, since it took no effect." },
  RECONCILE: { label: "Reconcile", does: "Records whether the attempt's action took effect." },
  RELEASE_AND_REATTEMPT: { label: "Release and re-attempt", does: "Runs the node again as a new operation, once the host proves its workspace is safe." },
  REVALIDATE: { label: "Revalidate", does: "Runs the loop's validation again, once the host proves that is safe." },
};

/**
 * The panel of one open hold, from its `aiws-graph-hold-card/1`: the held node and the host's
 * reason, with the cause of an EXECUTION_FAILED hold, the effect of the node's attempt, the
 * attempts the node used of those it has, and each exit the card offers, all taken in the
 * browser. Codes are shown as the host gave them; an exit Quay doesn't know is named by its code.
 */
function graphHoldOf(card: Obj): HoldPanel {
  const reason = str(card.reason) ?? "praxis gave no reason";
  const node = str(card.nodeId);
  const cause = str(card.cause);
  const notes: string[] = [];
  const effect = str(card.effect);
  if (effect !== null) notes.push(`Effect: ${effect}`);
  if (typeof card.attempts === "number") {
    const bound = typeof card.maxAttempts === "number" ? ` of ${card.maxAttempts}` : card.maxAttempts === null ? ", with no bound" : "";
    notes.push(`Attempts: ${card.attempts}${bound}`);
  }
  const exits = strings(card.exits).map((exit) => {
    const words = hasOwn(GRAPH_HOLD_EXITS, exit) ? GRAPH_HOLD_EXITS[exit] : { label: exit, does: "" };
    return { id: exit, ...words, available: true };
  });
  if (exits.length === 0) notes.push("No way out of the hold is offered: a person may cancel the run in the browser.");
  return {
    reason: node === null ? reason : `${reason} on node ${node}`,
    cause: cause === null ? null : `Cause: ${cause}`,
    phase: null,
    evidence: null,
    notes,
    exits,
  };
}

/** One `pending[]` entry in words: what a person decides for it in the browser. */
function decisionOf(p: Obj): string | null {
  const node = str(p.nodeId);
  switch (p.kind) {
    case "RUN_APPROVAL":
      return "the run's approval";
    case "NODE_APPROVAL":
      return node ? `approval of node ${node}` : "a node's approval";
    case "NODE_ACCEPTANCE":
      return node ? `acceptance of node ${node}` : "a node's acceptance";
    case "HOLD_DECISION":
      return node ? `a decision on the hold on node ${node}` : "a decision on a hold";
    case "RECONCILIATION":
      return "reconciliation";
    case "HUMAN_TASK":
      return node ? `a human task of node ${node}` : "a human task";
    case "RESUME_CONTROL":
      return "resuming: the run is paused";
    default:
      return null;
  }
}

/** The run as its detail draws it, from the view where it has a field and the row where it doesn't. */
export function graphRunDetailOf(view: Obj | null, row: RunRow | null, trustHint: string | null, workOrderId: string): GraphRunDetail | null {
  if (view === null && row === null) return null;
  const v = view ?? {};
  const pending = (Array.isArray(v.pending) ? v.pending : []).filter(isObject);
  const kinds = new Set(pending.map((p) => p.kind));
  const cards = (Array.isArray(v.holds) ? v.holds : []).filter(isObject);
  const status = str(v.status) ?? row?.status ?? "";
  const control = (isObject(v.control) ? str(v.control.status) : null) ?? row?.control ?? "";
  // Held as the run list tells it: an open hold names a node, or an UNKNOWN attempt awaits reconciliation.
  const held = view === null ? (row?.held ?? false) : cards.length > 0 || kinds.has("RECONCILIATION");
  const awaitingApproval = view === null ? (row?.awaitingApproval ?? false) : kinds.has("RUN_APPROVAL");
  const decisions = [...new Set(pending.map(decisionOf).filter((d): d is string => d !== null))];
  // A card without its `holdId` can't be told from another, so only the first of its reason is kept.
  const holds: GraphHold[] = [];
  for (const card of cards) {
    const panel = graphHoldOf(card);
    const holdId = str(card.holdId);
    const key = holdId !== null ? `hold:${holdId}` : `unnamed:${panel.reason}`;
    if (!holds.some((h) => h.key === key)) holds.push({ holdId, key, ...panel });
  }
  if (held && holds.length === 0) {
    holds.push({ holdId: null, key: "reconciliation", ...holdOf(null, "An attempt's outcome is unknown, so it needs reconciliation.") });
  }
  const outcome = str(v.outcome);
  return {
    workOrderId,
    runId: str(v.runId) ?? row?.runId ?? workOrderId,
    revision: row?.revision ?? null,
    status,
    outcome,
    control,
    held,
    awaitingApproval,
    createdAt: row?.createdAt ?? null,
    createdAtText: row?.createdAtText ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedAtText: row?.updatedAtText ?? null,
    decisions,
    holds,
    waiting: view === null ? (row?.needsYou ?? false) : held || decisions.length > 0,
    runPageAddress: str(v.runPageAddress) ?? row?.runPageAddress ?? null,
    trustHint,
    offersTrust: trustHint !== null && trustHint.includes("praxis trust"),
    ended: ENDED.has(status) || control === "CANCELED" || outcome !== null,
    simulated: v.simulatedIdentity === true,
  };
}

/** The view's `changeToken`, which a client compares and never parses; without one, the fields the token covers that Quay reads. */
function fingerprint(view: Obj): string {
  if (hasOwn(view, "changeToken") && typeof view.changeToken === "string") return view.changeToken;
  return JSON.stringify([view.status, view.outcome, view.control, view.pending, view.holds]);
}

/** A graph run: `praxis status --format aiws-graph-operator-view/1`, run-level facts only. */
export const GRAPH_RUN: FollowSource<GraphRunDetail> = {
  statusCommand: "praxis_host_graph_status",
  format: GRAPH_RUN_FORMAT,
  detailOf: graphRunDetailOf,
  fingerprint,
};
