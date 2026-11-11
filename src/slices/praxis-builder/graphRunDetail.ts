// A graph run's detail (#444, #465, #568, #569, #572): its run-level facts and its nodes, read from
// `praxis status <wo> --format aiws-graph-operator-view/1 --json` through the same follow as a
// template run's detail (runDetail.ts), with the same delays and stop rules but a narrower
// person-wait (#570): a run waiting for a person is read every 15 s only while none of its nodes
// is active, since an active node changes with no one deciding. It has no UI of its own;
// GraphRunDetail.tsx draws it, and its nodes are drawn by the run canvas (RunCanvas.tsx), the node
// table (NodeTable.tsx) and the node panel (NodePanel.tsx).
//
// `aiws-graph-operator-view/1` is `STABLE` (GRAPH-WORKFLOWS.md, "Graph operator view", promoted in
// AI-WS-SDK #659): a field or a value of its closed enums changes only in a new format, which the
// follow refuses. Each open hold is one `aiws-graph-hold-card/1` in its `holds[]`. Only the fields
// drawn are read, and any field Quay doesn't draw is ignored. A drawn field that is missing or of
// another type, from a host that breaks the format, falls back to the run's row in the Runs list,
// or to nothing, so the run is still drawn; a node entry without its `nodeId` or `phase` gets a
// problem line in place of its row. The view gives no creation or update time and its
// `revision` is the snapshot's, so those come from the row, whose `workflowRevision` is the
// admitted revision that runs.
import { formatDateTime } from "../../lib/dates.ts";
import { hasOwn, isObject } from "./model.ts";
import { isActiveNodePhase } from "./nodePhase.ts";
import { holdOf, NO_HOLD_REASON, str, strings, type FollowedRun, type FollowSource, type HoldExit, type HoldPanel, type Obj } from "./runDetail.ts";
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

/** One fact of a node in its node panel: what it is, and its value in words. */
export interface NodeFact {
  term: string;
  value: string;
}

/**
 * One node of a graph run as its node table row, its run canvas card and its node panel draw it,
 * from an entry of the view's `nodes[]`.
 */
export interface GraphRunNode {
  nodeId: string;
  /** The node's kind as the host gave it; empty when it gave none. */
  kind: string;
  /** The node phase, verbatim: the entry's `phase`, never its SDK `status`. */
  phase: string;
  /** The node's counter line: its loop's iterations, or its scope's attempts; null when it has neither. */
  counter: string | null;
  /** The `holdId` of the open hold the node is held by, or blocked by; null when none is. */
  holdId: string | null;
  /**
   * The facts its node panel shows, only those the entry gives, in this order: its newest
   * attempt's status and outcome; the attempts its scope used of those it allows, and its spend;
   * its loop's iterations of their most, and when the next is due; its wait's kind and status;
   * and an open human task. The host's codes are shown verbatim, and the due time in local words.
   */
  facts: NodeFact[];
}

/**
 * What the view says of the run's nodes: nothing, from a host that doesn't report node phases, or
 * a row for each entry of its `nodes[]`, in the view's order, and a problem line in place of the
 * row of each entry without its `nodeId` or its `phase`.
 */
export type GraphRunNodes = { reported: false } | { reported: true; rows: GraphRunNode[]; problems: string[] };

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
  /** The run's nodes, from the view's `nodes[]`; null before the first read. */
  nodes: GraphRunNodes | null;
  /** True when the run waits for a person in the browser: held, or awaiting a decision. */
  waiting: boolean;
  /**
   * True when the run waits for a person and none of its nodes is active (RUNNING, PARKED or
   * WAITING), since an active node changes with no one deciding.
   */
  waitsOnlyForPerson: boolean;
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

/** The attempts a node used of those it has, in words: `allowed` is null for no bound, and isn't drawn when of another type. */
function attemptsOf(used: number, allowed: unknown): string {
  const bound = typeof allowed === "number" ? ` of ${allowed}` : allowed === null ? ", with no bound" : "";
  return `${used}${bound}`;
}

/** The attempts a node used of those it has, as its node panel's fact, and as a line (`factLine`) its counter line and a hold panel's note give. */
const attemptsFact = (used: number, allowed: unknown): NodeFact => ({ term: "Attempts", value: attemptsOf(used, allowed) });

/** Fact `fact` as a line of words, "`<term>`: `<value>`", as a node's counter line and a hold panel's note give it. */
const factLine = (fact: NodeFact) => `${fact.term}: ${fact.value}`;

/**
 * The panel of one open hold, from its `aiws-graph-hold-card/1`: the held node and the host's
 * reason, with the cause of an EXECUTION_FAILED hold, the effect of the node's attempt, the
 * attempts the node used of those it has, and each exit the card offers, all taken in the
 * browser. A card that offers none says so and points to the run's page in the browser, which
 * says what can be done: an EXPOSURE_EXCEEDED hold is left by a change of the limit, and a run
 * that ended can't be cancelled. Codes are shown as the host gave them; an exit Quay doesn't know
 * is named by its code.
 */
function graphHoldOf(card: Obj): HoldPanel {
  const reason = str(card.reason) ?? NO_HOLD_REASON;
  const node = str(card.nodeId);
  const cause = str(card.cause);
  const notes: string[] = [];
  const effect = str(card.effect);
  if (effect !== null) notes.push(`Effect: ${effect}`);
  if (typeof card.attempts === "number") notes.push(factLine(attemptsFact(card.attempts, card.maxAttempts)));
  const exits = strings(card.exits).map((exit) => {
    const words = hasOwn(GRAPH_HOLD_EXITS, exit) ? GRAPH_HOLD_EXITS[exit] : { label: exit, does: "" };
    return { id: exit, ...words, available: true };
  });
  if (exits.length === 0) notes.push("No way out of the hold is offered here: the run's page in the browser says what can be done.");
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

/** Fact `term` of value `value`, or null for a value the entry doesn't give: none, or empty. */
const factOf = (term: string, value: string | null): NodeFact | null => (value ? { term, value } : null);

/** The object of an entry's field `value`, or an empty one when it is null or of another type, so it gives no fact. */
const objectOf = (value: unknown): Obj => (isObject(value) ? value : {});

/**
 * Node entry `entry`, of node `nodeId` in `phase`, as its row, card and panel draw it. The
 * counter line is the iterations its `loop` completed of the most it may run, or else the
 * attempts it used of those its `scope` allows, with no bound when the scope gives no
 * `maxAttempts`; none for a node with neither. A LOOP has a scope too, but its attempts count each
 * iteration's work and validations, so its iterations are the count a person follows.
 */
function runNodeOf(entry: Obj, nodeId: string, phase: string): GraphRunNode {
  const attempt = objectOf(entry.attempt);
  const scope = objectOf(entry.scope);
  const loop = objectOf(entry.loop);
  const wait = objectOf(entry.wait);
  const attempts = typeof scope.attempts === "number" ? attemptsFact(scope.attempts, scope.maxAttempts ?? null) : null;
  const iterations =
    typeof loop.iteration === "number" && typeof loop.maxIterations === "number" ? factOf("Iterations", `${loop.iteration} of ${loop.maxIterations}`) : null;
  const counter = iterations ?? attempts;
  const spent = str(scope.spent);
  const facts = [
    factOf("Attempt status", str(attempt.status)),
    factOf("Attempt outcome", str(attempt.outcome)),
    attempts,
    factOf("Spent", spent && [spent, str(scope.costUnit)].filter(Boolean).join(" ")),
    iterations,
    factOf("Next due", typeof loop.nextDueMs === "number" ? formatDateTime(loop.nextDueMs) : null),
    factOf("Wait kind", str(wait.kind)),
    factOf("Wait status", str(wait.status)),
    factOf("Human task", isObject(entry.humanTask) ? "Open" : null),
  ].filter((fact): fact is NodeFact => fact !== null);
  return { nodeId, kind: str(entry.kind) ?? "", phase, counter: counter && factLine(counter), holdId: str(entry.holdId) || null, facts };
}

/** The problem line of node entry `n`, counted from 1, which lacks its `nodeId` or its `phase`. */
function nodeProblem(n: number, nodeId: string | null, phase: string | null): string {
  if (nodeId === null) return `Node entry ${n} has no nodeId${phase === null ? " or phase" : ""}, so it isn't in the table.`;
  return `Node ${nodeId} has no phase, so it isn't in the table.`;
}

/** The run's nodes, from the view's `nodes[]`; an empty `nodeId` or `phase` is none. */
function nodesOf(view: Obj): GraphRunNodes {
  if (!Array.isArray(view.nodes)) return { reported: false };
  const rows: GraphRunNode[] = [];
  const problems: string[] = [];
  view.nodes.forEach((value: unknown, n) => {
    const entry = isObject(value) ? value : {};
    const nodeId = str(entry.nodeId) || null;
    const phase = str(entry.phase) || null;
    if (nodeId === null || phase === null) problems.push(nodeProblem(n + 1, nodeId, phase));
    else rows.push(runNodeOf(entry, nodeId, phase));
  });
  return { reported: true, rows, problems };
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
  const nodes = view === null ? null : nodesOf(view);
  const waiting = view === null ? (row?.needsYou ?? false) : held || decisions.length > 0;
  const active = nodes?.reported === true && nodes.rows.some((n) => isActiveNodePhase(n.phase));
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
    nodes,
    waiting,
    waitsOnlyForPerson: waiting && !active,
    runPageAddress: str(v.runPageAddress) ?? row?.runPageAddress ?? null,
    trustHint,
    offersTrust: trustHint !== null && trustHint.includes("praxis trust"),
    ended: ENDED.has(status) || control === "CANCELED" || outcome !== null,
    simulated: v.simulatedIdentity === true,
  };
}

/**
 * The fields of node entry `n` that the change token covers and Quay reads: its phase, hold,
 * attempt status, attempts, iteration and wait status. Null for an entry that isn't an object.
 */
function nodeFingerprint(n: unknown): unknown[] | null {
  if (!isObject(n)) return null;
  const field = (value: unknown, name: string) => (isObject(value) ? value[name] : null);
  return [n.phase, n.holdId, field(n.attempt, "status"), field(n.scope, "attempts"), field(n.loop, "iteration"), field(n.wait, "status")];
}

/**
 * The view's `changeToken`, which a client compares and never parses. Without one, the fields the
 * token covers that Quay reads: the run's status, outcome, control and pending decisions, and each
 * node's (`nodeFingerprint`); and the run's hold cards besides, which Quay reads too.
 */
function fingerprint(view: Obj): string {
  if (hasOwn(view, "changeToken") && typeof view.changeToken === "string") return view.changeToken;
  const nodes = Array.isArray(view.nodes) ? view.nodes.map(nodeFingerprint) : null;
  return JSON.stringify([view.status, view.outcome, view.control, view.pending, view.holds, nodes]);
}

/** A graph run: `praxis status --format aiws-graph-operator-view/1`, its run-level facts and its nodes. */
export const GRAPH_RUN: FollowSource<GraphRunDetail> = {
  statusCommand: "praxis_host_graph_status",
  format: GRAPH_RUN_FORMAT,
  detailOf: graphRunDetailOf,
  fingerprint,
};
