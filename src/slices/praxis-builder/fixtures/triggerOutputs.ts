/// <reference types="node" />
// Test fixtures from trigger_outputs.fixture.json: what the real `praxis --json` printed for each
// graph trigger command against the SDK's simulated host, as the trigger host model's tests answer it.
import { readFileSync } from "node:fs";
import type { CallOutcome } from "../praxisHost.ts";

const recorded = JSON.parse(
  readFileSync(new URL("../../../../src-tauri/src/slices/praxis/host/trigger_outputs.fixture.json", import.meta.url), "utf8"),
) as { cases: { name: string; stdout: Record<string, unknown> }[] };

/** A fresh copy of what praxis printed for the recorded case `name`. */
export const recordedTrigger = (name: string) => structuredClone(recorded.cases.find((c) => c.name === name)!.stdout);

/** The recorded `triggers show` case `name`, as `name` of trigger `trigger`, with `fields` over its top level. */
export function triggerShow(name: string, trigger: string, fields: Record<string, unknown> = {}): CallOutcome {
  return { kind: "record", record: { ...recordedTrigger(name), name: trigger, ...fields } };
}

/** The digest the recorded host gives revision 1 of `on-push`, admitted and enabled. */
export const ON_PUSH_DIGEST = "sha256:a638cc42a510ae48eb3a3a8d3d7c9b294900d4dd22e94f0d853d48782130c43e";

/** The recorded refusal of a show of a trigger the host doesn't have. */
export function triggerNotFound(): CallOutcome {
  const record = recordedTrigger("triggers show: not submitted");
  return { kind: "hostRefused", message: String(record.message), hostCode: String(record.hostCode), record };
}
