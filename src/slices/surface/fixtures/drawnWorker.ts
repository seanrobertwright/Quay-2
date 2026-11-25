/// <reference types="node" />
// Checks each of the worst calls, in a worker, and posts what it was told and how long that took.
import "../../../test-support/dom.ts";
import { parentPort } from "node:worker_threads";
import { WORST } from "./worstCalls.ts";

const { check } = await import("../a2ui/check.ts");

/** What is posted: the name of a call as its check starts, and what came of it. */
export type Told = { starts: string } | { name: string; ms: number; bytes: number; messages: string[] };

const post = (told: Told): void => parentPort?.postMessage(told);

for (const [name, message] of Object.entries(WORST)) {
  post({ starts: name });
  const started = performance.now();
  const verdict = check({ call: 1, tool: "quay_surface", surface_id: "plan", arguments: { messages: [message], place: "tab", title: "Worst" } });
  const ms = performance.now() - started;
  post({ name, ms, bytes: JSON.stringify(message).length, messages: "errors" in verdict ? verdict.errors.map((error) => error.message) : [] });
}
