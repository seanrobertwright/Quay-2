// The Workflows panel's run rows (#645): every Archon run, Machina Factory work order and Praxis
// run as one row shape, with the section it lands in, its action chip and its segment bar.
import type { ArchonRun } from "../archon/types.ts";
import { STATUS_LABEL } from "../machina/format.ts";
import type { MachinaWorkOrder, StageStatus } from "../machina/types.ts";
import type { RunRow } from "../praxis-builder/runsList.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import { formatDateStamp } from "../../lib/dates.ts";
import { isSamePath } from "../../utils/paths.ts";

/** The three engines the Workflows panel lists. */
export type Engine = "archon" | "factory" | "praxis";

/** One segment of a run row's bar: an Archon node or a Factory stage. */
export type SegmentState = "done" | "running" | "waiting" | "failed" | "pending";

/** The panel section a row lands in; null for a finished run older than the Recent window. */
export type RunSection = "needs-you" | "running" | "recent";

/** The action chip on a Needs you row. */
export type ActionChip = "Approve" | "Resume" | "Hold" | "Merge" | "Browser";

/** The decision the Run view offers for a run. */
export type RunDecision =
  /** Archon approval gate: Approve or Reject. */
  | { kind: "archon-approval" }
  /** Failed Archon run: Resume or Abandon. */
  | { kind: "archon-failed" }
  /** Factory hold: the hold's own options. */
  | { kind: "factory-hold" }
  /** Factory work order whose gate passed: Accept: squash-merge. */
  | { kind: "factory-accept" }
  /** Interrupted or failed work order: Resume. */
  | { kind: "factory-resume" }
  /** Praxis decisions are made on the host's page in the browser. */
  | { kind: "praxis-browser" };

/** One run or work order, as the panel and the Run view show it. */
export interface WorkflowRunRow {
  /** Unique across engines: `engine:id`. */
  key: string;
  engine: Engine;
  id: string;
  name: string;
  /** The status in words, such as "Awaiting approval". */
  status: string;
  /** Spend in USD, or null when the engine doesn't say. */
  spendUsd: number | null;
  segments: SegmentState[];
  section: RunSection | null;
  chip: ActionChip | null;
  /** What the Run view offers, or null when nothing waits on the operator. */
  decision: RunDecision | null;
  /** When the row last changed or started, in ms since the epoch; rows sort newest first by it. */
  sortMs: number;
}

/** Finished runs older than this leave the Recent list. */
export const RECENT_WINDOW_MS = 24 * 3_600_000;

/** "owner/lril-sdlc:implement" -> "lril-sdlc:implement" */
const shortWorkflow = (name: string) => name.split("/").pop() || name;

const ARCHON_STATUS: Record<string, string> = {
  running: "Running",
  pending: "Pending",
  paused: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * An Archon run's segments from the run list's summary: completed nodes done, the active nodes
 * running (waiting while paused, failed once failed), the rest pending.
 */
function archonSegments(run: ArchonRun): SegmentState[] {
  const total = Math.max(0, run.nodes_total ?? 0);
  if (total === 0) return [];
  const done = Math.min(total, Math.max(0, run.nodes_completed ?? 0));
  const activeState: SegmentState =
    run.status === "paused" ? "waiting" : run.status === "failed" ? "failed" : run.status === "completed" ? "done" : "running";
  const active = run.status === "completed" ? total - done : Math.min(total - done, Math.max(1, run.active_nodes?.length ?? 0));
  const shownActive = run.status === "pending" || run.status === "cancelled" ? 0 : active;
  return Array.from({ length: total }, (_, i) => (i < done ? "done" : i < done + shownActive ? activeState : "pending"));
}

/** An Archon run as a panel row. */
export function archonRunRow(run: ArchonRun, now: number): WorkflowRunRow {
  const sortMs = run.completed_ms ?? run.started_ms ?? 0;
  const finished = run.status === "completed" || run.status === "cancelled" || run.status === "failed";
  const fresh = now - sortMs <= RECENT_WINDOW_MS;
  let section: RunSection | null;
  let chip: ActionChip | null = null;
  let decision: RunDecision | null = null;
  if (run.status === "paused") {
    section = "needs-you";
    chip = "Approve";
    decision = { kind: "archon-approval" };
  } else if (run.status === "failed") {
    section = fresh ? "needs-you" : null;
    chip = "Resume";
    decision = { kind: "archon-failed" };
  } else if (finished) {
    section = fresh ? "recent" : null;
  } else {
    section = "running";
  }
  return {
    key: `archon:${run.id}`,
    engine: "archon",
    id: run.id,
    name: shortWorkflow(run.workflow_name),
    status: ARCHON_STATUS[run.status] ?? run.status,
    spendUsd: run.total_cost_usd ?? null,
    segments: archonSegments(run),
    section,
    chip,
    decision,
    sortMs,
  };
}

const STAGE_SEGMENT: Record<StageStatus, SegmentState> = {
  PASSED: "done",
  RUNNING: "running",
  ON_HOLD: "waiting",
  FAILED: "failed",
  PENDING: "pending",
};

/** A Machina Factory work order as a panel row. */
export function workOrderRow(wo: MachinaWorkOrder, now: number): WorkflowRunRow {
  const fresh = now - wo.updatedAtMs <= RECENT_WINDOW_MS;
  let section: RunSection | null = "running";
  let chip: ActionChip | null = null;
  let decision: RunDecision | null = null;
  switch (wo.status) {
    case "ON_HOLD":
      section = "needs-you";
      chip = "Hold";
      decision = { kind: "factory-hold" };
      break;
    case "AWAITING_ACCEPTANCE":
      section = "needs-you";
      chip = "Merge";
      decision = { kind: "factory-accept" };
      break;
    case "INTERRUPTED":
    case "FAILED":
      section = "needs-you";
      chip = "Resume";
      decision = { kind: "factory-resume" };
      break;
    case "COMPLETED":
    case "ABORTED":
      section = fresh ? "recent" : null;
      break;
    default:
      section = "running";
  }
  return {
    key: `factory:${wo.id}`,
    engine: "factory",
    id: wo.id,
    name: `${wo.id} ${wo.title}`,
    status: STATUS_LABEL[wo.status],
    spendUsd: wo.spend.usd,
    segments: wo.stages.map((st) => STAGE_SEGMENT[st.status]),
    section,
    chip,
    decision,
    sortMs: wo.updatedAtMs,
  };
}

/**
 * Praxis statuses that end a run. The host's status vocabulary is provisional, so any other
 * status counts as still going.
 */
const PRAXIS_FAILED = new Set(["FAILED", "CANCELLED", "CANCELED", "ABORTED"]);
const PRAXIS_DONE = new Set(["COMPLETED", "SUCCEEDED"]);

/** A Praxis graph workflow's run as a panel row: one segment, since a graph run names no stages. */
export function praxisRunRow(workflow: string, run: RunRow, now: number): WorkflowRunRow {
  const sortMs = run.updatedAt ?? run.createdAt ?? 0;
  const failed = PRAXIS_FAILED.has(run.status);
  const finished = failed || PRAXIS_DONE.has(run.status);
  const fresh = now - sortMs <= RECENT_WINDOW_MS;
  const section: RunSection | null = run.needsYou ? "needs-you" : finished ? (fresh ? "recent" : null) : "running";
  const segment: SegmentState = run.needsYou ? "waiting" : failed ? "failed" : finished ? "done" : "running";
  return {
    key: `praxis:${workflow}/${run.workOrderId}`,
    engine: "praxis",
    id: run.workOrderId,
    name: workflow,
    status: run.status,
    spendUsd: null,
    segments: [segment],
    section,
    chip: run.needsYou ? "Browser" : null,
    decision: run.needsYou ? { kind: "praxis-browser" } : null,
    sortMs,
  };
}

/** The panel's Needs you, Running and Recent lists, each newest first. */
export interface PanelSections {
  needsYou: WorkflowRunRow[];
  running: WorkflowRunRow[];
  recent: WorkflowRunRow[];
}

/** Sorts `rows` into the panel's sections, newest first; a row in no section is left out. */
export function panelSections(rows: readonly WorkflowRunRow[]): PanelSections {
  const sorted = [...rows].sort((a, b) => b.sortMs - a.sortMs);
  return {
    needsYou: sorted.filter((r) => r.section === "needs-you"),
    running: sorted.filter((r) => r.section === "running"),
    recent: sorted.filter((r) => r.section === "recent"),
  };
}

/** A run or work order as its engine reports it. */
export type RunSource =
  | { engine: "archon"; run: ArchonRun }
  | { engine: "factory"; workOrder: MachinaWorkOrder }
  | { engine: "praxis"; workflow: string; run: RunRow };

/** `source` as a panel row. */
export function rowOf(source: RunSource, now: number): WorkflowRunRow {
  switch (source.engine) {
    case "archon":
      return archonRunRow(source.run, now);
    case "factory":
      return workOrderRow(source.workOrder, now);
    case "praxis":
      return praxisRunRow(source.workflow, source.run, now);
  }
}

/**
 * The terminal a run has of its own, which picking the run selects: a work order's author
 * terminal, or the Archon terminal working in an Archon run's folder. Null when it has none open.
 */
export function runTerminalId(source: RunSource, terminals: readonly TerminalInfo[]): string | null {
  switch (source.engine) {
    case "factory": {
      const id = source.workOrder.authorTerminalId;
      return id !== null && terminals.some((t) => t.id === id) ? id : null;
    }
    case "archon": {
      const path = source.run.working_path;
      if (!path) return null;
      return terminals.find((t) => t.run_kind === "archon" && isSamePath(t.project_path, path))?.id ?? null;
    }
    case "praxis":
      return null;
  }
}

/**
 * Today's Factory spend: the measured spend of the work orders that changed today on this
 * machine's calendar. A work order's spend is its running total, so one that started yesterday
 * and changed today counts in full.
 */
export function factorySpendToday(workOrders: readonly MachinaWorkOrder[], now: number): number {
  const today = formatDateStamp(now);
  return workOrders.filter((wo) => formatDateStamp(wo.updatedAtMs) === today).reduce((sum, wo) => sum + wo.spend.usd, 0);
}
