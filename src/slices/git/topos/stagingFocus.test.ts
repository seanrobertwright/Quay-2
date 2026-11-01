/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOW_UP_MS, focusAfterRemoval, focusMoveMessage, withFollowUp } from "./stagingFocus.ts";

test("when the middle row goes, focus moves to the row that was after it", () => {
  assert.equal(focusAfterRemoval(["a", "b", "c"], "b", ["a", "c"]), "c");
});

test("when the last row goes, focus moves to the row before it", () => {
  assert.equal(focusAfterRemoval(["a", "b", "c"], "c", ["a", "b"]), "b");
});

test("when the only row goes, focus moves to the list itself", () => {
  assert.equal(focusAfterRemoval(["a"], "a", []), null);
});

test("a row that stays keeps focus, even when rows around it go", () => {
  assert.equal(focusAfterRemoval(["a", "b", "c"], "b", ["b"]), "b");
});

test("rows removed together are skipped to the nearest survivor", () => {
  assert.equal(focusAfterRemoval(["a", "b", "c", "d"], "b", ["a", "d"]), "d");
  assert.equal(focusAfterRemoval(["a", "b", "c", "d"], "c", ["a"]), "a");
});

test("when none of the old rows is left, focus takes the row at the same place", () => {
  // A stage of the last file in a folder re-keys the tree, so no old key survives.
  assert.equal(focusAfterRemoval(["d:src", "c:src/a"], "c:src/a", ["c:b", "c:c"]), "c:c");
});

test("a focus move right after an action is said after it, in the same sentence", () => {
  const prev = { text: "Staged a.txt", seq: 4, at: 1000 };
  assert.deepEqual(withFollowUp(prev, "Focus on b.txt", 1000 + FOLLOW_UP_MS - 1), { text: "Staged a.txt. Focus on b.txt", seq: 5, at: 1000 + FOLLOW_UP_MS - 1 });
});

test("a focus move long after the last sentence is said on its own", () => {
  const prev = { text: "Staged a.txt", seq: 4, at: 1000 };
  assert.deepEqual(withFollowUp(prev, "Focus on b.txt", 1000 + FOLLOW_UP_MS), { text: "Focus on b.txt", seq: 5, at: 1000 + FOLLOW_UP_MS });
});

test("a sentence that already ends in a stop isn't given a second one", () => {
  const prev = { text: "Discarded a.txt. Undo within 10 seconds.", seq: 1, at: 0 };
  assert.equal(withFollowUp(prev, "Focus on b.txt", 1).text, "Discarded a.txt. Undo within 10 seconds. Focus on b.txt");
});

test("the move names the row it lands on, or the list when it is empty", () => {
  assert.equal(focusMoveMessage("Unstaged changes", "src/b.txt"), "Focus on src/b.txt");
  assert.equal(focusMoveMessage("Unstaged changes", null), "Unstaged changes is empty, focus on the list");
});
