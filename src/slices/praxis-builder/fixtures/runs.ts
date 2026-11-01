// Test fixtures for the `aiws-workflow-runs/1` record that `praxis runs <name> --json` prints, as
// the Runs list model and the Runs view tests answer it.
import type { CallOutcome } from "../praxisHost.ts";

/** Run `n` as an `aiws-workflow-runs/1` entry, with `extra` fields replacing its defaults. */
export function runEntry(n: number, extra: Record<string, unknown> = {}) {
  return {
    workOrderId: `wo-${n}`,
    runId: `run-${n}`,
    revision: 3,
    createdAt: "2026-10-25T14:00:00.000Z",
    status: "RUNNING",
    stage: "IMPLEMENTATION",
    control: "RUNNING",
    held: false,
    ...extra,
  };
}

/** A `record` outcome listing `entries` for `template`, with `extra` record fields. */
export const runsRecord = (template: string, entries: unknown[], extra: Record<string, unknown> = {}): CallOutcome => ({
  kind: "record",
  record: { format: "aiws-workflow-runs/1", template, runs: entries, ...extra },
});

/** The host's browser origin as praxis builds it at the SDK pin: ten base32 characters in the label. */
export const BROWSER_ORIGIN = "https://praxis-abcdefghij.localhost:7443";

/**
 * Run `n`'s `coding-operator-view/1`, as `praxis status wo-<n> --json` prints it with its
 * `runPageAddress`, holding only the fields the run detail draws, with `extra` replacing them.
 */
export function operatorView(n: number, extra: Record<string, unknown> = {}) {
  return {
    format: "coding-operator-view/1",
    workOrderId: `wo-${n}`,
    runId: `run-${n}`,
    revision: 3,
    status: "READY",
    stage: "IMPLEMENTATION",
    reason: null,
    control: { status: "RUNNING" },
    pending: [],
    holdCard: null,
    attempts: [],
    historyTruncated: false,
    runPageAddress: `${BROWSER_ORIGIN}/#work-order=wo-${n}`,
    ...extra,
  };
}

/** An attempt as the operator view lists it: task `task`, authorized at minute `minute`. */
export const attempt = (id: string, task: string, minute: number, delivery: string | null = "SUCCEEDED") => ({
  attempt_id: id,
  task_id: task,
  status: delivery === null ? "DISPATCH_AUTHORIZED" : "COMPLETED",
  delivery_status: delivery,
  authorized_at: `2026-10-25T14:${String(minute).padStart(2, "0")}:00.000Z`,
});

/** A `record` outcome of `praxis status`, with the certificate hint praxis wrote on stderr. */
export const statusRecord = (view: Record<string, unknown>, trustHint?: string): CallOutcome =>
  trustHint === undefined ? { kind: "record", record: view } : { kind: "record", record: view, trustHint };
