/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { entryTimer, responseLabel } from "./trailEntry.ts";

const entry = (fields: Partial<Parameters<typeof entryTimer>[0]> = {}) => ({
  status: "dispatched" as const,
  delivered_at: null,
  completed_at: null,
  ...fields,
});

test("a peer's response to a waited message is a Reply", () => {
  assert.equal(responseLabel({ waited: true }), "Reply");
});

test("a peer's response nobody waited on is an Answer", () => {
  assert.equal(responseLabel({ waited: false }), "Answer");
  assert.equal(responseLabel({}), "Answer");
});

test("a Dispatched entry counts up from delivery", () => {
  assert.deepEqual(entryTimer(entry({ delivered_at: 1_000 }), 13_500, true), { running: true, ms: 12_500 });
});

test("a Queued entry shows no timer", () => {
  assert.equal(entryTimer(entry({ status: "queued" }), 5_000, true), null);
});

test("a Completed entry shows how long its turn took", () => {
  assert.deepEqual(
    entryTimer(entry({ status: "completed", delivered_at: 1_000, completed_at: 64_000 }), 99_000, false),
    { running: false, ms: 63_000 },
  );
});

test("an entry with no recorded delivery shows no timer", () => {
  assert.equal(entryTimer(entry({ status: "dispatched" }), 5_000, true), null);
  assert.equal(entryTimer(entry({ status: "completed", completed_at: 5_000 }), 5_000, true), null);
});

test("a Failed entry shows no timer", () => {
  assert.equal(entryTimer(entry({ status: "failed", delivered_at: 1_000 }), 5_000, true), null);
});

test("a clock behind the delivery time counts from zero", () => {
  assert.deepEqual(entryTimer(entry({ delivered_at: 5_000 }), 4_000, true), { running: true, ms: 0 });
});

test("a Dispatched entry to a peer whose turn end Quay can't see shows no timer", () => {
  assert.equal(entryTimer(entry({ delivered_at: 1_000 }), 13_500, false), null);
});
