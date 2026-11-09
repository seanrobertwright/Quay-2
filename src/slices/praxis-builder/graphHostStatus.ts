// What the Graph workflows list and the graph workflow form show of a graph workflow's state on
// the Praxis host (#444, #461): each row's badge after its git badge, the form's status line
// with Check again, Open in browser and Withdraw (#463), and the Revisions panel's rows. It
// renders the graph host model (`graphHost.ts`) and adds no state of its own. There is no admit,
// reject or retire: the owner decides in the browser.
import { formatDateTime, parseUtcTimestamp } from "../../lib/dates.ts";
import type { GraphHostState, GraphWorkflowHostView } from "./graphHost.ts";
import { hostConditionView } from "./hostCondition.ts";
import { HOST_STATE_LABELS, hostBadgeOf, minutesSince, withHostBadge, type HostBadge, type HostBadgeTone, type HostLook, type RowBadge } from "./hostList.ts";
import type { HostCondition } from "./praxisHost.ts";
import type { ChangeStatus } from "./types.ts";

/** A graph workflow state as a badge or the status line shows it. */
type ShownGraphState = Exclude<GraphHostState["kind"], "unknown"> | "failed" | "unknown";

/** Each state's label; the states a template has too keep a template's words. */
const LABELS: Record<Exclude<ShownGraphState, "candidate">, string> = {
  nameRefused: HOST_STATE_LABELS.nameRefused,
  notSubmitted: "Not submitted",
  retired: "Retired",
  differs: HOST_STATE_LABELS.differs,
  notReady: "Admitted, not ready",
  admitted: "Admitted",
  failed: HOST_STATE_LABELS.failed,
  unknown: HOST_STATE_LABELS.unknown,
};

/** Each state's colour, which never carries the state alone: the label does. Admitted is muted. */
const TONES: Record<ShownGraphState, HostBadgeTone> = {
  nameRefused: "error",
  notSubmitted: "attention",
  retired: "attention",
  candidate: "attention",
  differs: "attention",
  notReady: "attention",
  admitted: "muted",
  failed: "neutral",
  unknown: "neutral",
};

/** The state's text label, which carries it without colour. */
function labelOf(state: GraphHostState): string {
  if (state.kind === "candidate") return `Candidate waiting for admission (revision ${state.revision})`;
  if (state.kind === "unknown") return LABELS[state.why === "failed" ? "failed" : "unknown"];
  return LABELS[state.kind];
}

/** What the host, or the read, says about a state; null when there is nothing to add. */
function reasonOf(state: GraphHostState): string | null {
  switch (state.kind) {
    case "nameRefused":
      return state.rule;
    case "retired":
      return "The owner retired it. A new revision the owner admits makes it active again.";
    case "candidate":
      return "The owner admits or rejects it in the browser.";
    case "differs":
      return `The saved files aren't admitted revision ${state.revision}'s.`;
    case "notReady":
      return state.reason;
    case "unknown":
      return state.message ?? null;
    default:
      return null;
  }
}

/** A host timestamp in local time, or its own text when it isn't a UTC timestamp. */
function timeText(text: string): string {
  const ms = parseUtcTimestamp(text);
  return ms === null ? text : formatDateTime(ms);
}

const shownOf = (state: GraphHostState): ShownGraphState =>
  state.kind === "unknown" ? (state.why === "failed" ? "failed" : "unknown") : state.kind;

/** The graph workflow form's status line. */
export interface GraphStatusLine {
  /** The state's icon. */
  look: HostLook;
  /** Its colour, which never carries the state alone: `label` does. */
  tone: HostBadgeTone;
  label: string;
  /** The host's reason, or what the failed read said; null when there is none. */
  reason: string | null;
  /**
   * "Revision N, submitted T" when Quay couldn't compare the saved files' bundle digest with the
   * current revision's, so Differs can't be told; null otherwise.
   */
  revision: string | null;
  /** "checked N min ago", from the reading's stamp; null when nothing was read. */
  checked: string | null;
  /** True when Check again is offered. */
  checkAgain: boolean;
  /** True while a read that will update this graph workflow is in flight. */
  checking: boolean;
  /** True once the reading is old enough that the state may be out of date. */
  muted: boolean;
  /** The pending candidate's admission page, for Open in browser; null when there is none to open. */
  admissionPage: string | null;
  /** The pending candidate's revision, for Withdraw; null when nothing is pending. */
  withdraw: number | null;
}

/** Graph workflow `view`'s status line, under the project's host `condition`, at `now`. */
export function graphStatusLine(view: GraphWorkflowHostView, condition: HostCondition, now: number): GraphStatusLine {
  const { state } = view;
  // While the host condition holds, the header's Check host is what rereads.
  if (state.kind === "unknown" && state.why === "host") {
    return {
      look: "unknown",
      tone: "neutral",
      label: `Host state unknown: ${hostConditionView(condition).label}`,
      reason: null,
      revision: null,
      checked: null,
      checkAgain: false,
      checking: false,
      muted: false,
      admissionPage: null,
      withdraw: null,
    };
  }
  const shown = shownOf(state);
  const fallback = (state.kind === "admitted" || state.kind === "notReady") && !view.compared && view.current !== null;
  return {
    look: shown,
    tone: TONES[shown],
    label: labelOf(state),
    reason: reasonOf(state),
    revision: fallback && view.current
      ? `Revision ${view.current.revision}, ${view.current.submittedAt === null ? "submit time not given" : `submitted ${timeText(view.current.submittedAt)}`}`
      : null,
    checked:
      view.checkedAt === null ? null : `checked ${minutesSince(view.checkedAt, now)} min ago${view.muted ? ", may be out of date" : ""}`,
    // The model never sends praxis a name the host refuses, so there is nothing to check again.
    checkAgain: state.kind !== "nameRefused",
    checking: view.checking,
    muted: view.muted,
    admissionPage: state.kind === "candidate" ? view.admissionPageAddress : null,
    withdraw: state.kind === "candidate" ? state.revision : null,
  };
}

/** Graph workflow `id`'s host badge, or null while its state is unknown and not shown. */
function graphBadge(id: string, view: GraphWorkflowHostView, now: number): HostBadge | null {
  const shown = shownOf(view.state);
  if (shown === "unknown") return null;
  return hostBadgeOf(id, { state: shown, label: labelOf(view.state), reason: reasonOf(view.state), tone: TONES[shown] }, view, now);
}

/** The badges of graph workflow `id`'s row: its change since the last commit, then its host state. */
export function graphRowBadges(id: string, changed: ChangeStatus | undefined, view: GraphWorkflowHostView, now: number): RowBadge[] {
  return withHostBadge(changed, graphBadge(id, view, now));
}

const STATUS_LABELS = new Map([
  ["CANDIDATE", "Candidate, waiting for admission"],
  ["ADMITTED", "Admitted"],
  ["REJECTED", "Rejected"],
  ["WITHDRAWN", "Withdrawn"],
  ["CURRENT", "Current"],
  ["RETIRED", "Retired"],
]);

/** One row of the Revisions panel. */
export interface RevisionRow {
  revision: number;
  status: string;
  submitted: string;
  decided: string;
  /** True for the host's current revision. */
  current: boolean;
  /** True for a pending candidate, which may be withdrawn. */
  withdrawable: boolean;
}

/** The Revisions panel's rows, newest first, as the latest `graphs show` listed them. */
export function revisionRows(view: GraphWorkflowHostView): RevisionRow[] {
  return view.revisions.map((r) => ({
    revision: r.revision,
    // The host's status enum is closed, but a newer host's word is shown as it gave it.
    status: STATUS_LABELS.get(r.status) ?? r.status,
    submitted: r.submittedAt === null ? "Not given by the host" : timeText(r.submittedAt),
    decided: r.decidedAt === null ? "Not given by the host" : timeText(r.decidedAt),
    current: r.current,
    withdrawable: r.status === "CANDIDATE",
  }));
}
