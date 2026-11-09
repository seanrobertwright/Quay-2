// Check on host and Submit for a graph trigger (#469, #476): what stops a submission, and what
// the host's answers mean. This module has no UI: the trigger form's Submit bar and its confirm
// draw it. It shares the graph workflow's gate sentences and outcome readers (`hostSubmit.ts`).
//
// A submission sends the saved trigger file and names the graph workflow its saved target file
// names, so a trigger with no target, unsaved edits or local faults stops it.
import {
  checkOutcome,
  hostBlocker,
  nameBlocker,
  submissionOutcome,
  unsavedBlocker,
  type FindingsReader,
  type HostCheck,
  type LocalChecks,
  type Submission,
} from "./hostSubmit.ts";
import { isObject } from "./hostReadSession.ts";
import { hostNameProblem } from "./lifecycle.ts";
import type { BundleChangesRead } from "./graphRunStart.ts";
import { outcomeMessage, type CallOutcome, type HostCondition } from "./praxisHost.ts";

/** One fault the host found in the saved trigger. */
export interface TriggerFinding {
  /** An RFC 6901 pointer inside the trigger; empty for the whole record. */
  path: string;
  /** The host's code, an open enum: shown as given. */
  code: string;
}

/** `praxis triggers check` and `submit`'s findings: exit 9 is `triggerInvalid`. One Quay can't read is left out. */
const TRIGGER_FINDINGS: FindingsReader<TriggerFinding> = {
  invalid: "triggerInvalid",
  read: (record) =>
    Array.isArray(record.findings)
      ? record.findings.flatMap((f) => (isObject(f) && typeof f.code === "string" ? [{ code: f.code, path: typeof f.path === "string" ? f.path : "" }] : []))
      : [],
};

/** What one `praxis triggers check` came to: a passed one gives nothing besides. */
export type TriggerCheck = HostCheck<TriggerFinding>;

/** The answer of `praxis_host_trigger_check`; null for a cancelled check. */
export const triggerCheckOf = (outcome: CallOutcome): TriggerCheck | null => checkOutcome(outcome, TRIGGER_FINDINGS, () => ({}));

/** What a `praxis_host_trigger_submit` outcome means for the person who confirmed it. */
export const triggerSubmissionOf = (outcome: CallOutcome): Submission<TriggerFinding> => submissionOutcome(outcome, TRIGGER_FINDINGS);

/** A finding as the list shows it: `EVENT_SOURCE_NOT_ADMITTED at /source`. */
export const triggerFindingText = (finding: TriggerFinding): string => `${finding.code}${finding.path ? ` at ${finding.path}` : ""}`;

/** The target graph workflow on the host, as `praxis graphs show` gave it. */
export type TargetOnHost =
  /** The host has it; `admitted` when it has an admitted revision, without which the host refuses the trigger's fires. */
  | { state: "found"; admitted: boolean }
  | { state: "missing" }
  /** The read didn't answer, in words for the bar. */
  | { state: "failed"; message: string };

/** What a `praxis_host_graph_show` of the target came to; null for a cancelled read. */
export function targetOnHostOf(outcome: CallOutcome): TargetOnHost | null {
  switch (outcome.kind) {
    case "record":
      return { state: "found", admitted: Number.isSafeInteger(outcome.record.currentRevision) };
    case "hostRefused":
      return outcome.hostCode === "NOT_FOUND" ? { state: "missing" } : { state: "failed", message: outcome.message };
    case "cancelled":
      return null;
    default:
      return { state: "failed", message: outcomeMessage(outcome) };
  }
}

/** Why Submit stops when the target isn't on the host. */
export const targetMissing = (target: string): string =>
  `Graph workflow ${target}, which the trigger starts, isn't on the host. Submit it from its form first.`;

/** What the trigger's Submit gates read. */
export interface TriggerGateInput {
  name: string;
  /** True when the draft, the trigger or its target, has edits its saved files lack, or was never saved. */
  unsaved: boolean;
  /** The graph workflow the trigger starts; null for none. */
  target: string | null;
  /** Where the trigger's local checks stand: the SDK's and the graph trigger rules. */
  local: LocalChecks;
  condition: HostCondition;
  /** The target on the host, as last read; null before a read answers. */
  targetOnHost: TargetOnHost | null;
}

/** Why the trigger's Submit is disabled, one sentence per gate that holds; empty when nothing stops it. */
export function triggerSubmitBlockers(input: TriggerGateInput): string[] {
  const reasons: string[] = [];
  if (input.target === null) reasons.push("The trigger has no Starts target, so it stays a local record. Pick the graph workflow it starts first.");
  if (input.unsaved) reasons.push(unsavedBlocker([{ kind: "triggers", id: input.name }]));
  // The host knows a trigger by its name only once it has a target, so only then does the rule apply.
  const rule = hostNameProblem("triggers", input.name, input.target);
  if (rule !== null) reasons.push(nameBlocker(rule));
  if (input.local === "checking") reasons.push("Checking the trigger…");
  else if (input.local === "fails") reasons.push("The trigger fails its local checks. Fix them first: only a trigger that passes them is submitted.");
  const host = hostBlocker(input.condition);
  if (host !== null) reasons.push(host);
  if (input.target !== null && input.targetOnHost?.state === "missing") reasons.push(targetMissing(input.target));
  return reasons;
}

/** The warning when the target has no admitted revision: the host refuses the trigger's fires until it has one. */
export const targetNotAdmitted = (target: string): string =>
  `Graph workflow ${target} has no admitted revision on the host, so the host refuses the trigger's fires until the owner admits one.`;

/** What the trigger's warnings read. */
export interface TriggerWarningInput {
  target: string | null;
  targetOnHost: TargetOnHost | null;
  /** The trigger's files with changes since the last commit, as last read; null before a read answers. */
  changes: BundleChangesRead | null;
}

/**
 * The warnings a saved graph trigger gives, which never disable Submit: its files with changes
 * that aren't committed, or a git status Quay couldn't read, and a target with no admitted revision.
 */
export function triggerWarnings(input: TriggerWarningInput): string[] {
  const warnings: string[] = [];
  const { changes } = input;
  if (changes !== null && "error" in changes) {
    warnings.push(`Quay couldn't read git status, so it can't tell whether the trigger has changes that aren't committed: ${changes.error}`);
  } else if (changes !== null && changes.files.length > 0) {
    warnings.push(`Changes not committed: ${changes.files.map((f) => f.path).join(", ")}. They are submitted as saved.`);
  }
  if (input.target !== null && input.targetOnHost?.state === "found" && !input.targetOnHost.admitted) warnings.push(targetNotAdmitted(input.target));
  return warnings;
}

/** What the confirm says the trigger does once admitted, from its saved `enabled`. */
export const startsEnabled = (enabled: boolean): string =>
  enabled
    ? "Once admitted it starts enabled, so it fires from then on."
    : "Once admitted it starts disabled: it doesn't fire until the owner enables it in the browser.";
