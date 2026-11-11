/// <reference types="node" />
// Test fixtures from graph_outputs.fixture.json: what the real `praxis --json` printed for each
// graph command against the SDK's simulated host, as the graph host model, form and run detail
// tests answer it.
import { readFileSync } from "node:fs";
import type { CallOutcome } from "../praxisHost.ts";

const recorded = JSON.parse(
  readFileSync(new URL("../../../../src-tauri/src/slices/praxis/host/graph_outputs.fixture.json", import.meta.url), "utf8"),
) as { cases: { name: string; stdout: Record<string, unknown> }[] };

/** A fresh copy of what praxis printed for the recorded case `name`. */
export const recordedStdout = (name: string) => structuredClone(recorded.cases.find((c) => c.name === name)!.stdout);

/** The digest the recorded bundle has, on every revision the recorded host holds. */
export const RECORDED_DIGEST = "sha256:f29d05656810f1a352c2fa594710e4f01333ea7e1f8833708bdb6a915870474f";

/** The recorded withdrawal result, for `name`'s revision `revision`. */
export const withdrawnRecord = (name: string, revision: number): CallOutcome => ({
  kind: "record",
  record: { ...recordedStdout("graphs withdraw: a pending candidate"), name, revision },
});

/** The recorded refusal of a withdrawal whose candidate is no longer pending. */
export function notPending(): CallOutcome {
  const record = recordedStdout("graphs withdraw: not pending");
  return { kind: "hostRefused", message: String(record.message), hostCode: String(record.hostCode), record };
}
