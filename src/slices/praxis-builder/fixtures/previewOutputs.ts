/// <reference types="node" />
// Test fixtures from preview_outputs.fixture.json: what the real `praxis preview --template --json`
// printed against the SDK's simulated host for four workflow template drafts (#596).
import { readFileSync } from "node:fs";
import type { CallOutcome } from "../praxisHost.ts";

const recorded = JSON.parse(
  readFileSync(new URL("../../../../src-tauri/src/slices/praxis/host/preview_outputs.fixture.json", import.meta.url), "utf8"),
) as { cases: { name: string; stdout: Record<string, unknown> }[] };

/** The recorded case `name` as the runner answers it, with `fields` over the record's top level. */
function recordedPreview(name: string, fields: Record<string, unknown>): CallOutcome {
  return { kind: "record", record: { ...structuredClone(recorded.cases.find((c) => c.name === name)!.stdout), ...fields } };
}

/** A draft a run can be created from. The host warns about `reapproveCorrections`. */
export const creatablePreview = (fields: Record<string, unknown> = {}) => recordedPreview("preview: a template a run can be created from", fields);

/** A draft with an authoring error: the host refuses `maxAttempts`. */
export const invalidPreview = () => recordedPreview("preview: a template with an authoring error", {});

/** A draft the host reads and can't create a run from: its `agent` isn't one the host offers. */
export const unreadyPreview = () => recordedPreview("preview: a valid template no run can be created from", {});

/** A draft that carries `workOrderId` and `runId`, fields the template form has no input for. */
export const identifiedPreview = () => recordedPreview("preview: a template that carries identities", {});

/** The host's words for the `maxAttempts` error, as recorded. */
export const MAX_ATTEMPTS_MESSAGE = "Enter an exact integer between 2 and 9007199254740991. Attempts include implementation and validation.";

/** The host's words for the `reapproveCorrections` warning, as recorded. */
export const CORRECTIONS_MESSAGE = "The initial human approval permits correction cycles without a separate correction approval.";
