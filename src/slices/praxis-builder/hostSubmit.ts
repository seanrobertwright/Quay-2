// Check on host and Submit, for any record kind the host takes a submission of: a graph workflow
// (`graphSubmit.ts`, #462) or a graph trigger (`triggerSubmit.ts`, #476). The gate sentences
// both share, and what a check or submit verb's answer means, with each kind's findings read by
// its own `FindingsReader`. This module has no UI: `SubmitControls.tsx` and `SubmitConfirm.tsx`
// draw it.
import { hostConditionView } from "./hostCondition.ts";
import { outcomeMessage, type CallOutcome, type HostCondition } from "./praxisHost.ts";
import type { DefinitionRef, PraxisKind } from "./types.ts";

const NOUNS: Partial<Record<PraxisKind, string>> = {
  "graph-workflows": "graph workflow",
  graphs: "graph",
  "graph-bindings": "graph binding",
  contracts: "contract",
  grants: "grant",
  triggers: "trigger",
};

/** A record's noun and id, as reasons name it: `grant grant-one`. */
export const recordLabel = (ref: DefinitionRef): string => `${NOUNS[ref.kind] ?? ref.kind} ${ref.id}`;

/** Where a record's local checks stand. */
export type LocalChecks = "checking" | "passes" | "fails";

/** The unsaved-edits gate's reason, naming each record: only saved files are submitted. */
export const unsavedBlocker = (unsaved: readonly DefinitionRef[]): string =>
  `Unsaved edits: ${unsaved.map(recordLabel).join(", ")}. Only saved files are submitted, so save them first.`;

/** The name gate's reason: the host's rule, which the name breaks. */
export const nameBlocker = (rule: string): string => `${rule} Rename it from the list.`;

/** The host gate's reason, when the host condition is neither "signed in" nor "simulated host"; else null. */
export function hostBlocker(condition: HostCondition): string | null {
  const host = hostConditionView(condition);
  // `usable` is exactly "signed in" or "simulated host".
  return host.usable ? null : `Submit needs a host that is signed in or simulated, and this one is: ${host.label}.`;
}

/**
 * What one host check came to, with `F` its findings and `Passed` what the record kind's check
 * gives besides when it finds no faults.
 */
export type HostCheck<F, Passed extends object = Record<never, never>> =
  /** The host found no faults. */
  | ({ kind: "passed" } & Passed)
  | { kind: "faults"; findings: F[] }
  /** The check didn't run to an answer, in words for the bar. */
  | { kind: "failed"; message: string };

/**
 * How a check or submit verb's findings are read: the outcome its exit 9 gives, and the findings
 * its record lists.
 */
export interface FindingsReader<F> {
  invalid: "bundleInvalid" | "triggerInvalid";
  read: (record: Record<string, unknown>) => F[];
}

/**
 * The answer of a check verb whose findings `reader` reads, with `passed` reading what a check
 * that found no faults gives besides; null for a cancelled check.
 */
export function checkOutcome<F, Passed extends object>(
  outcome: CallOutcome,
  reader: FindingsReader<F>,
  passed: (record: Record<string, unknown>) => Passed,
): HostCheck<F, Passed> | null {
  if (outcome.kind === reader.invalid && "record" in outcome) return { kind: "faults", findings: reader.read(outcome.record) };
  switch (outcome.kind) {
    case "record": {
      const { valid } = outcome.record;
      if (valid === true) return { ...passed(outcome.record), kind: "passed" };
      if (valid === false) return { kind: "faults", findings: reader.read(outcome.record) };
      return { kind: "failed", message: outcomeMessage({ kind: "needsUpdate", detail: "its check result says neither valid nor not." }) };
    }
    case "cancelled":
      return null;
    default:
      return { kind: "failed", message: outcomeMessage(outcome) };
  }
}

/** What one submission came to, in the words the confirm shows, with `F` its findings. */
export type Submission<F> =
  /** A new candidate: `admissionPageAddress` is where the owner admits it, when praxis gave one. */
  | { kind: "submitted"; revision: number; admissionPageAddress: string | null }
  /** The host found faults after all: nothing was stored. */
  | { kind: "faults"; findings: F[] }
  /** Quay can't tell whether the candidate was stored; `requestId` resends the same submission. */
  | { kind: "unknown"; message: string; requestId: string | null }
  /** Nothing was stored, in praxis's words or Quay's. */
  | { kind: "refused"; message: string };

/** The words of every outcome that can't say whether the candidate was stored. */
const RESEND_ADVICE = "Submit again resends the same submission, so it can't store a second candidate.";

/** What the outcome of a submit verb whose findings `reader` reads means for the person who confirmed it. */
export function submissionOutcome<F>(outcome: CallOutcome, reader: FindingsReader<F>): Submission<F> {
  if (outcome.kind === reader.invalid && "record" in outcome) return { kind: "faults", findings: reader.read(outcome.record) };
  switch (outcome.kind) {
    case "record": {
      const { revision, admissionPageAddress } = outcome.record;
      if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
        // It was stored, so this must not offer a resend as if it might not have been.
        return { kind: "refused", message: outcomeMessage({ kind: "needsUpdate", detail: "praxis stored a candidate, but its result names no revision." }) };
      }
      return { kind: "submitted", revision: revision as number, admissionPageAddress: typeof admissionPageAddress === "string" ? admissionPageAddress : null };
    }
    case "unknown":
      return { kind: "unknown", message: `Quay can't tell whether the host stored the candidate: ${outcome.detail}${outcome.requestId ? ` ${RESEND_ADVICE}` : ""}`, requestId: outcome.requestId ?? null };
    case "timedOut":
      return { kind: "unknown", message: "praxis didn't finish the submission in time, so Quay stopped it, and can't tell whether the host stored the candidate.", requestId: null };
    case "cancelled":
      return { kind: "unknown", message: "praxis was stopped before it said whether the host stored the candidate.", requestId: null };
    default:
      return { kind: "refused", message: outcomeMessage(outcome) };
  }
}
