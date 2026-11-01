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
