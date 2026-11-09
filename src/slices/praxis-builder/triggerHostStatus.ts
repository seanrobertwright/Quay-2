// What the Triggers list and the trigger form show of a graph trigger's state on the Praxis host
// (#469, #475): each graph trigger's badge after its git badge, the form's status line with Check
// again and Open in browser, the note when the host's enabled state differs from the saved file's,
// and the Revisions panel's rows. It renders the trigger host model (`triggerHost.ts`) and adds no
// state of its own. There is no admit, reject or enable: the owner decides in the browser.
import { formatDateTime, parseUtcTimestamp } from "../../lib/dates.ts";
import { hostConditionView } from "./hostCondition.ts";
import { HOST_STATE_LABELS, hostBadgeOf, minutesSince, withHostBadge, type HostBadge, type HostBadgeTone, type HostLook, type RowBadge } from "./hostList.ts";
import type { HostCondition } from "./praxisHost.ts";
import type { GraphTriggerHostView, TriggerHostState } from "./triggerHost.ts";
import type { ChangeStatus } from "./types.ts";

/** A graph trigger state as a badge or the status line shows it. */
type ShownTriggerState = Exclude<TriggerHostState["kind"], "unknown"> | "failed" | "unknown";

/** Each state's label; the states a template or graph workflow has too keep their words. */
const LABELS: Record<Exclude<ShownTriggerState, "candidate">, string> = {
  nameRefused: HOST_STATE_LABELS.nameRefused,
  notSubmitted: "Not submitted",
  retired: "Retired",
  differs: HOST_STATE_LABELS.differs,
  disabled: "Admitted, disabled",
  blocked: "Admitted, blocked",
  admitted: "Admitted, enabled",
  failed: HOST_STATE_LABELS.failed,
  unknown: HOST_STATE_LABELS.unknown,
};

/** Each state's colour, which never carries the state alone: the label does. Admitted is muted. */
const TONES: Record<ShownTriggerState, HostBadgeTone> = {
  nameRefused: "error",
  notSubmitted: "attention",
  retired: "attention",
  candidate: "attention",
  differs: "attention",
  disabled: "attention",
  blocked: "attention",
  admitted: "muted",
  failed: "neutral",
  unknown: "neutral",
};

/** What each `blockedBy` code the host gives an admitted, enabled trigger means (AI-WS-SDK `triggerBlockers`). */
const BLOCKERS = new Map([
  ["TRIGGER_NOT_YET_VALID", "its notBefore time hasn't come"],
  ["TRIGGER_EXPIRED", "its expiresAt time has passed"],
  ["CONTRACT_DEADLINE_PASSED", "its contract's deadline has passed"],
  ["WORKFLOW_RETIRED", "its target graph workflow is retired"],
  ["WORKFLOW_NO_ADMITTED_REVISION", "its target graph workflow has no admitted revision"],
  ["EVENT_SOURCE_NOT_ADMITTED", "its event source isn't admitted"],
  ["EVENT_SOURCE_DISABLED", "its event source is disabled"],
  ["EVENT_SOURCE_REVOKED", "its event source is revoked"],
  ["EVENT_TYPE_NOT_DECLARED", "its event source doesn't declare its event type"],
]);

/** A blocker in words with its code, or the code alone when Quay has no words for it. */
function blockerText(code: string): string {
  const words = BLOCKERS.get(code);
  return words === undefined ? code : `${words} (${code})`;
}

/** The state's text label, which carries it without colour. */
function labelOf(state: TriggerHostState): string {
  if (state.kind === "candidate") return `Candidate waiting for admission (revision ${state.revision})`;
  if (state.kind === "unknown") return LABELS[state.why === "failed" ? "failed" : "unknown"];
  return LABELS[state.kind];
}

/** What the host, or the read, says about a state; null when there is nothing to add. */
function reasonOf(state: TriggerHostState): string | null {
  switch (state.kind) {
    case "nameRefused":
      return state.rule;
    case "retired":
      return "It was retired on the host. It fires again only once the owner admits a new revision.";
    case "candidate":
      return "The owner admits or rejects it in the browser.";
    case "differs":
      return `The saved files aren't admitted revision ${state.revision}'s.`;
    case "disabled":
      return "It doesn't fire until the owner enables it in the browser.";
    case "blocked":
      return `It can't fire: ${state.blockers.map(blockerText).join("; ")}.`;
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

const shownOf = (state: TriggerHostState): ShownTriggerState =>
  state.kind === "unknown" ? (state.why === "failed" ? "failed" : "unknown") : state.kind;

const enabledWord = (enabled: boolean) => (enabled ? "enabled" : "disabled");

/** The trigger form's status line. */
export interface TriggerStatusLine {
  /** The state's icon. */
  look: HostLook;
  /** Its colour, which never carries the state alone: `label` does. */
  tone: HostBadgeTone;
  label: string;
  /** The host's reason, or what the failed read said; null when there is none. */
  reason: string | null;
  /**
   * "Revision N, submitted T" when Quay couldn't compare the saved files' digest with the current
   * revision's, so Differs can't be told; null otherwise.
   */
  revision: string | null;
  /** "checked N min ago", from the reading's stamp; null when nothing was read. */
  checked: string | null;
  /** True when Check again is offered. */
  checkAgain: boolean;
  /** True while a read that will update this trigger is in flight. */
  checking: boolean;
  /** True once the reading is old enough that the state may be out of date. */
  muted: boolean;
  /** The pending candidate's admission page, for Open in browser; null when there is none to open. */
  admissionPage: string | null;
  /** Says the host's enabled state differs from the saved file's, and why that stays so; null when they agree or either is unknown. */
  enabledNote: string | null;
}

/** Graph trigger `view`'s status line, under the project's host `condition`, at `now`. */
export function triggerStatusLine(view: GraphTriggerHostView, condition: HostCondition, now: number): TriggerStatusLine {
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
      enabledNote: null,
    };
  }
  const shown = shownOf(state);
  const restsOnDigest = state.kind === "admitted" || state.kind === "disabled" || state.kind === "blocked";
  const fallback = restsOnDigest && !view.compared && view.current !== null;
  const { hostEnabled, savedEnabled } = view;
  return {
    look: shown,
    tone: TONES[shown],
    label: labelOf(state),
    reason: reasonOf(state),
    revision:
      fallback && view.current
        ? `Revision ${view.current.revision}, ${view.current.submittedAt === null ? "submit time not given" : `submitted ${timeText(view.current.submittedAt)}`}`
        : null,
    checked: view.checkedAt === null ? null : `checked ${minutesSince(view.checkedAt, now)} min ago${view.muted ? ", may be out of date" : ""}`,
    // The model never sends praxis a name the host refuses, so there is nothing to check again.
    checkAgain: state.kind !== "nameRefused",
    checking: view.checking,
    muted: view.muted,
    admissionPage: state.kind === "candidate" ? view.admissionPageAddress : null,
    enabledNote:
      hostEnabled !== null && savedEnabled !== null && hostEnabled !== savedEnabled
        ? `On the host it is ${enabledWord(hostEnabled)}, and the saved file says ${enabledWord(savedEnabled)}. Disabling a trigger on the host doesn't change its file, and the file reaches the host only as a revision the owner admits.`
        : null,
  };
}

/** Graph trigger `id`'s host badge, or null while its state is unknown and not shown. */
function triggerBadge(id: string, view: GraphTriggerHostView, now: number): HostBadge | null {
  const shown = shownOf(view.state);
  if (shown === "unknown") return null;
  return hostBadgeOf(id, { state: shown, label: labelOf(view.state), reason: reasonOf(view.state), tone: TONES[shown] }, view, now);
}

/** The badges of graph trigger `id`'s row: its change since the last commit, then its host state. */
export function triggerRowBadges(id: string, changed: ChangeStatus | undefined, view: GraphTriggerHostView, now: number): RowBadge[] {
  return withHostBadge(changed, triggerBadge(id, view, now));
}

const STATUS_LABELS = new Map([
  ["CANDIDATE", "Candidate, waiting for admission"],
  ["ADMITTED", "Admitted"],
  ["REJECTED", "Rejected"],
  ["WITHDRAWN", "Withdrawn"],
]);

/** One row of a graph trigger's Revisions panel. */
export interface TriggerRevisionRow {
  revision: number;
  status: string;
  /** The revision it was submitted over, or "None". */
  base: string;
  submitted: string;
  /** True for the host's current revision. */
  current: boolean;
}

/** The Revisions panel's rows, newest first, as the latest `triggers show` listed them. */
export function triggerRevisionRows(view: GraphTriggerHostView): TriggerRevisionRow[] {
  return view.revisions.map((r) => ({
    revision: r.revision,
    // The host's status enum is closed, but a newer host's word is shown as it gave it.
    status: STATUS_LABELS.get(r.status) ?? r.status,
    base: r.baseRevision === null ? "None" : `Revision ${r.baseRevision}`,
    submitted: r.submittedAt === null ? "Not given by the host" : timeText(r.submittedAt),
    current: r.current,
  }));
}
