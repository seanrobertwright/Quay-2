// The Merge undo window (#650), from the spec's Pie menu section: a Merge starts a countdown that
// Cancel stops; when it ends the merge runs; with the window set to Off the pull request view's
// confirm step opens instead. Any Merge button may start it, so the job is whatever its caller asks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE, mergeUndoSecondsLeft, stepMergeUndo, type MergeUndoState } from "./mergeUndo.ts";

const job = { number: 12, method: "squash" };

test("a Merge with a 5 s window counts down 5, 4, ... 1 and runs nothing until it ends", () => {
  const started = stepMergeUndo(IDLE, { type: "start", job, seconds: 5, at: 1_000 });
  assert.equal(started.effect, null);
  assert.equal(started.state.phase, "counting");
  const left = [1_000, 1_999, 2_000, 5_500, 5_999].map((at) => mergeUndoSecondsLeft(started.state, at));
  assert.deepEqual(left, [5, 5, 4, 1, 1]);
  const early = stepMergeUndo(started.state, { type: "tick", at: 5_999 });
  assert.equal(early.effect, null);
  assert.equal(early.state, started.state);
});

test("when the window ends the merge runs once with the job, and the window closes", () => {
  const started = stepMergeUndo(IDLE, { type: "start", job, seconds: 3, at: 0 }).state;
  const ended = stepMergeUndo(started, { type: "tick", at: 3_000 });
  assert.deepEqual(ended.effect, { run: "merge", job });
  assert.deepEqual(ended.state, IDLE);
  assert.equal(stepMergeUndo(ended.state, { type: "tick", at: 4_000 }).effect, null);
});

test("Cancel stops the window, so nothing runs when it would have ended", () => {
  const started = stepMergeUndo(IDLE, { type: "start", job, seconds: 5, at: 0 }).state;
  const cancelled = stepMergeUndo(started, { type: "cancel" });
  assert.deepEqual(cancelled, { state: IDLE, effect: null });
  assert.equal(stepMergeUndo(cancelled.state, { type: "tick", at: 10_000 }).effect, null);
});

test("with the window set to Off, a Merge opens the confirm step instead and starts no countdown", () => {
  const off = stepMergeUndo(IDLE, { type: "start", job, seconds: 0, at: 0 });
  assert.deepEqual(off, { state: IDLE, effect: { run: "confirm", job } });
});

test("a second Merge while one is counting leaves the first counting, and runs nothing", () => {
  const first: MergeUndoState<typeof job> = stepMergeUndo(IDLE, { type: "start", job, seconds: 5, at: 0 }).state;
  const second = stepMergeUndo(first, { type: "start", job: { number: 13, method: "rebase" }, seconds: 5, at: 1_000 });
  assert.deepEqual(second, { state: first, effect: null });
});

test("with nothing counting there are no seconds left", () => {
  assert.equal(mergeUndoSecondsLeft(IDLE, 0), 0);
});
