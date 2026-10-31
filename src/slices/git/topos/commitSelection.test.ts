/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparedPair, movedRow, offsetShowing, selectCommits, selectedOids, selectionKey, type CommitSelection } from "./commitSelection.ts";
import { ROW_HEIGHT } from "./graphWindow.ts";

const press = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

test("the arrows, PageUp/PageDown and Home/End move the selection", () => {
  assert.deepEqual(selectionKey(press("ArrowUp"), false), { kind: "move", step: "up" });
  assert.deepEqual(selectionKey(press("ArrowDown"), false), { kind: "move", step: "down" });
  assert.deepEqual(selectionKey(press("PageUp"), false), { kind: "move", step: "pageUp" });
  assert.deepEqual(selectionKey(press("PageDown"), false), { kind: "move", step: "pageDown" });
  assert.deepEqual(selectionKey(press("Home"), false), { kind: "move", step: "home" });
  assert.deepEqual(selectionKey(press("End"), false), { kind: "move", step: "end" });
});

test("Ctrl+C copies the SHA and Enter moves to the inspector", () => {
  assert.deepEqual(selectionKey(press("c", { ctrlKey: true }), false), { kind: "copy" });
  assert.deepEqual(selectionKey(press("C", { ctrlKey: true }), false), { kind: "copy" });
  assert.deepEqual(selectionKey(press("c", { metaKey: true }), false), { kind: "copy" }, "Cmd+C on a Mac");
  assert.deepEqual(selectionKey(press("Enter"), false), { kind: "inspect" });
});

test("Ctrl with a move key moves the cursor only, and Ctrl+Space or Shift+Space adds its commit", () => {
  assert.deepEqual(selectionKey(press("ArrowDown", { ctrlKey: true }), false), { kind: "cursor", step: "down" });
  assert.deepEqual(selectionKey(press("ArrowUp", { ctrlKey: true }), false), { kind: "cursor", step: "up" });
  assert.deepEqual(selectionKey(press("PageDown", { ctrlKey: true }), false), { kind: "cursor", step: "pageDown" });
  assert.deepEqual(selectionKey(press("Home", { metaKey: true }), false), { kind: "cursor", step: "home" });
  assert.deepEqual(selectionKey(press(" ", { ctrlKey: true }), false), { kind: "add" });
  assert.deepEqual(selectionKey(press(" ", { shiftKey: true }), false), { kind: "add" });
  assert.equal(selectionKey(press("ArrowDown", { ctrlKey: true, shiftKey: true }), false), null);
  assert.equal(selectionKey(press(" ", { ctrlKey: true }), true), null, "not in a text field");
});

test("other keys, modified moves and keys typed in a text field do nothing", () => {
  assert.equal(selectionKey(press("c"), false), null, "a bare c");
  assert.equal(selectionKey(press("c", { ctrlKey: true, shiftKey: true }), false), null);
  assert.equal(selectionKey(press("ArrowDown", { shiftKey: true }), false), null, "Shift extends a selection, which is not this");
  assert.equal(selectionKey(press("Home", { altKey: true }), false), null);
  assert.equal(selectionKey(press("Enter", { ctrlKey: true }), false), null);
  assert.equal(selectionKey(press(" "), false), null, "Space still scrolls");
  assert.equal(selectionKey(press("ArrowDown"), true), null);
  assert.equal(selectionKey(press("c", { ctrlKey: true }), true), null);
});

const rows = { rowCount: 100, pageRows: 10, firstVisible: 40 };

test("a step moves one row, a page moves a viewport's rows, and both stop at the ends", () => {
  assert.equal(movedRow(50, "down", rows), 51);
  assert.equal(movedRow(50, "up", rows), 49);
  assert.equal(movedRow(50, "pageDown", rows), 60);
  assert.equal(movedRow(50, "pageUp", rows), 40);
  assert.equal(movedRow(0, "up", rows), 0);
  assert.equal(movedRow(99, "down", rows), 99);
  assert.equal(movedRow(95, "pageDown", rows), 99);
  assert.equal(movedRow(5, "pageUp", rows), 0);
  assert.equal(movedRow(50, "home", rows), 0);
  assert.equal(movedRow(50, "end", rows), 99);
});

test("with nothing selected, a step lands on the first visible row", () => {
  assert.equal(movedRow(null, "down", rows), 40);
  assert.equal(movedRow(null, "up", rows), 40);
  assert.equal(movedRow(null, "pageDown", rows), 40);
  assert.equal(movedRow(null, "end", rows), 99);
  assert.equal(movedRow(null, "home", rows), 0);
  assert.equal(movedRow(null, "down", { ...rows, rowCount: 0 }), null, "an empty list has no row");
  assert.equal(movedRow(null, "down", { ...rows, firstVisible: 500 }), 99, "a first visible row past the end is clamped");
});

test("the offset keeps the selected row in view, moving as little as it can", () => {
  const viewport = 10 * ROW_HEIGHT;
  const offset = 40 * ROW_HEIGHT;
  assert.equal(offsetShowing(offset, 45, viewport), offset, "a row in view doesn't scroll");
  assert.equal(offsetShowing(offset, 39, viewport), 39 * ROW_HEIGHT, "a row above scrolls to the top");
  assert.equal(offsetShowing(offset, 50, viewport), 51 * ROW_HEIGHT - viewport, "a row below scrolls to the bottom");
  assert.equal(offsetShowing(offset + 5, 40, viewport), 40 * ROW_HEIGHT, "a row cut off at the top shows whole");
  assert.equal(offsetShowing(0, 1_999_999, viewport), 2_000_000 * ROW_HEIGHT - viewport, "far rows past 8M px work in content px");
});

const NONE: CommitSelection = { kind: "none" };

test("a click selects one commit, and a plain click on another returns to one", () => {
  const one = selectCommits(NONE, { kind: "pick", oid: "a" });
  assert.deepEqual(one, { kind: "one", oid: "a" });
  const two = selectCommits(one, { kind: "add", oid: "b" });
  assert.deepEqual(selectCommits(two, { kind: "pick", oid: "c" }), { kind: "one", oid: "c" });
  assert.deepEqual(selectCommits(two, { kind: "pick", oid: "a" }), { kind: "one", oid: "a" });
  assert.deepEqual(selectCommits(two, { kind: "clear" }), NONE);
});

test("Ctrl- or Shift-click adds a second commit, and a third replaces the second", () => {
  const one: CommitSelection = { kind: "one", oid: "a" };
  const two = selectCommits(one, { kind: "add", oid: "b" });
  assert.deepEqual(two, { kind: "two", first: "a", second: "b", swapped: false });
  assert.deepEqual(selectCommits(two, { kind: "add", oid: "c" }), { kind: "two", first: "a", second: "c", swapped: false });
  assert.deepEqual(selectedOids(selectCommits(two, { kind: "add", oid: "c" })), ["a", "c"], "never three");
  assert.deepEqual(selectCommits(NONE, { kind: "add", oid: "a" }), { kind: "one", oid: "a" }, "with none, an add selects one");
});

test("adding a commit already selected unselects it, back to the other one", () => {
  const one: CommitSelection = { kind: "one", oid: "a" };
  assert.deepEqual(selectCommits(one, { kind: "add", oid: "a" }), one, "the only selected commit stays");
  const two: CommitSelection = { kind: "two", first: "a", second: "b", swapped: true };
  assert.deepEqual(selectCommits(two, { kind: "add", oid: "b" }), { kind: "one", oid: "a" });
  assert.deepEqual(selectCommits(two, { kind: "add", oid: "a" }), { kind: "one", oid: "b" });
});

test("Swap flips a compared pair and does nothing to one commit", () => {
  const two: CommitSelection = { kind: "two", first: "a", second: "b", swapped: false };
  const swapped = selectCommits(two, { kind: "swap" });
  assert.deepEqual(swapped, { kind: "two", first: "a", second: "b", swapped: true });
  assert.deepEqual(selectCommits(swapped, { kind: "swap" }), two, "a second Swap restores the order");
  assert.deepEqual(selectCommits(swapped, { kind: "add", oid: "c" }), { kind: "two", first: "a", second: "c", swapped: false }, "a new pair starts unswapped");
  const one: CommitSelection = { kind: "one", oid: "a" };
  assert.equal(selectCommits(one, { kind: "swap" }), one);
  assert.deepEqual(selectedOids(NONE), []);
  assert.deepEqual(selectedOids(one), ["a"]);
});

test("the pair is diffed older to newer, and Swap reverses it", () => {
  const order = { older: { oid: "o", subject: "Older" }, newer: { oid: "n", subject: "Newer" } };
  assert.deepEqual(comparedPair(order, false), { from: order.older, to: order.newer });
  assert.deepEqual(comparedPair(order, true), { from: order.newer, to: order.older });
});
