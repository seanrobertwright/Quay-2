/// <reference types="node" />
// Copied from the Archon builder (coleam00/Archon b9624b7,
// packages/web/src/experiments/console/builder/editor/history.test.ts), MIT; see ./NOTICE.
// Quay changes: ported to node:test, and rewritten for merging by gesture key, the
// 100-step cap and step labels.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRedo,
  canUndo,
  createHistory,
  endMerge,
  MAX_STEPS,
  NUDGE_WINDOW_MS,
  record,
  redo,
  undo,
  type History,
} from "./history.ts";

const step = (label: string) => ({ label });
const typing = (key: string) => ({ label: "Edit field", merge: { key } });
const nudge = (key: string) => ({ label: "Nudge", merge: { key, windowMs: NUDGE_WINDOW_MS } });

test("a new history has nothing to undo or redo", () => {
  const h = createHistory<string>();
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
  assert.equal(undo(h, "live"), null);
  assert.equal(redo(h, "live"), null);
});

test("undo restores the state before the step, and redo the state after it", () => {
  const h = record(createHistory<string>(), step("Add task-1"), "v1", 0);
  const undone = undo(h, "v2");
  assert.deepEqual(undone && { snapshot: undone.snapshot, label: undone.label }, { snapshot: "v1", label: "Add task-1" });
  const redone = redo(undone!.history, "v1");
  assert.deepEqual(redone && { snapshot: redone.snapshot, label: redone.label }, { snapshot: "v2", label: "Add task-1" });
  assert.equal(canRedo(redone!.history), false);
});

test("each step without a merge key is its own entry, however close together", () => {
  let h = createHistory<string>();
  h = record(h, step("Connect"), "v1", 0);
  h = record(h, step("Connect"), "v2", 1);
  assert.equal(h.past.length, 2);
});

test("typing in one field merges into one step, however long it takes", () => {
  let h = createHistory<string>();
  h = record(h, typing("loop-1|config.maxIterations"), "v1", 0);
  h = record(h, typing("loop-1|config.maxIterations"), "v2", 60_000);
  h = record(h, typing("loop-1|config.maxIterations"), "v3", 120_000);
  assert.equal(h.past.length, 1);
  assert.equal(undo(h, "v4")?.snapshot, "v1");
});

test("ending the merge, as blur or Enter does, starts a new step for the next keystroke", () => {
  let h = createHistory<string>();
  h = record(h, typing("d|config.field"), "v1", 0);
  h = endMerge(h);
  h = record(h, typing("d|config.field"), "v2", 1);
  assert.equal(h.past.length, 2);
});

test("another edit between keystrokes breaks the merge", () => {
  let h = createHistory<string>();
  h = record(h, typing("d|config.field"), "v1", 0);
  h = record(h, step("Connect"), "v2", 1);
  h = record(h, typing("d|config.field"), "v3", 2);
  assert.equal(h.past.length, 3);
});

test("typing in another field is another step", () => {
  let h = createHistory<string>();
  h = record(h, typing("d|config.field"), "v1", 0);
  h = record(h, typing("e|config.field"), "v2", 1);
  assert.equal(h.past.length, 2);
});

test("nudges of the same selection merge while they come within the sliding window", () => {
  let h = createHistory<string>();
  for (let i = 0; i <= 10; i++) h = record(h, nudge("a,b"), `v${i}`, i * (NUDGE_WINDOW_MS - 1));
  assert.equal(h.past.length, 1);
  assert.equal(undo(h, "live")?.snapshot, "v0");
});

test("a pause longer than the window starts a new nudge step", () => {
  let h = createHistory<string>();
  h = record(h, nudge("a"), "v1", 0);
  h = record(h, nudge("a"), "v2", NUDGE_WINDOW_MS);
  assert.equal(h.past.length, 2);
});

test("a new step clears redo", () => {
  let h = record(createHistory<string>(), step("a"), "v1", 0);
  const undone = undo(h, "v2")!;
  assert.equal(canRedo(undone.history), true);
  h = record(undone.history, step("b"), "v1", 1);
  assert.equal(canRedo(h), false);
});

test("a merged keystroke after an undo is a new step, not part of the undone one", () => {
  let h = record(createHistory<string>(), typing("d|config.field"), "v1", 0);
  h = undo(h, "v2")!.history;
  h = record(h, typing("d|config.field"), "v1", 1);
  assert.equal(h.past.length, 1);
  assert.equal(canRedo(h), false);
});

test("undo and redo walk several steps in order", () => {
  let h: History<string> = createHistory();
  h = record(h, step("a"), "v1", 0);
  h = record(h, step("b"), "v2", 0);
  h = record(h, step("c"), "v3", 0);
  const u1 = undo(h, "v4")!;
  assert.deepEqual([u1.snapshot, u1.label], ["v3", "c"]);
  const u2 = undo(u1.history, u1.snapshot)!;
  assert.deepEqual([u2.snapshot, u2.label], ["v2", "b"]);
  const r1 = redo(u2.history, u2.snapshot)!;
  assert.deepEqual([r1.snapshot, r1.label], ["v3", "b"]);
  const r2 = redo(r1.history, r1.snapshot)!;
  assert.deepEqual([r2.snapshot, r2.label], ["v4", "c"]);
  assert.equal(canRedo(r2.history), false);
});

test(`a history keeps at most ${MAX_STEPS} steps and drops the oldest first`, () => {
  let h = createHistory<number>();
  for (let i = 0; i < MAX_STEPS + 5; i++) h = record(h, step(`s${i}`), i, i);
  assert.equal(h.past.length, MAX_STEPS);
  assert.equal(h.past[0].snapshot, 5);
  assert.equal(h.past[0].label, "s5");
});

test("redo past the cap still keeps at most the cap", () => {
  let h = createHistory<number>();
  for (let i = 0; i < MAX_STEPS; i++) h = record(h, step(`s${i}`), i, i);
  const undone = undo(h, MAX_STEPS)!;
  const redone = redo(undone.history, undone.snapshot)!;
  assert.equal(redone.history.past.length, MAX_STEPS);
});
