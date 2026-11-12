/// <reference types="node" />
// Test fixtures from agent_outputs.fixture.json: what the real `praxis agents --json` printed
// against the SDK's simulated host, with an agent catalog and without one (#482).
import { readFileSync } from "node:fs";
import type { CallOutcome } from "../praxisHost.ts";

const recorded = JSON.parse(
  readFileSync(new URL("../../../../src-tauri/src/slices/praxis/host/agent_outputs.fixture.json", import.meta.url), "utf8"),
) as { cases: { name: string; stdout: Record<string, unknown> }[] };

/** The recorded case `name` as the runner answers it, with `fields` over the record's top level. */
function recordedPicker(name: string, fields: Record<string, unknown>): CallOutcome {
  return { kind: "record", record: { ...structuredClone(recorded.cases.find((c) => c.name === name)!.stdout), ...fields } };
}

/**
 * The picker of a host whose catalog offers, in this order, `ready-coder`, `changed-coder`, which
 * can't be bound, and `unadapted-coder`.
 */
export const catalogPicker = (fields: Record<string, unknown> = {}) => recordedPicker("agents: a catalog", fields);

/** The picker of a host with no agent catalog. */
export const noCatalogPicker = () => recordedPicker("agents: no catalog", {});

/** The host's reason `changed-coder` can't be bound, as recorded. */
export const CHANGED_REASON =
  "The host observes agent changed-coder with capability digest 4a5c57b7543c, not the 397912f62e5a the catalog pins.";
