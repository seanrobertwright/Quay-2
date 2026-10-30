/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { hitNode, rowAt } from "./graphHit.ts";

// With H = 28, W = 16 and P = 8, lane l's node sits at x = 16 + 16·l, and row r of a window
// starting at row s at y = 14 + 28·(r - s). The hit radius is half a lane pitch, 8 px.
const win = { start: 40, end: 80 };
const lanes = (row: number) => (row === 42 ? 3 : 0);

test("a pointer on a node hits that node's row", () => {
  // Row 42 is the third row of the window, in lane 3: (64, 70).
  assert.equal(hitNode(64, 70, win, lanes), 42);
  assert.equal(hitNode(16, 14, win, lanes), 40);
});

test("a pointer within half a lane pitch of the node's center still hits it", () => {
  assert.equal(hitNode(64 + 5, 70 - 5, win, lanes), 42);
  assert.equal(hitNode(64 + 8, 70, win, lanes), 42);
  assert.equal(hitNode(64 + 6, 70 + 6, win, lanes), null);
});

test("a pointer on the row but in another lane hits nothing", () => {
  assert.equal(hitNode(16, 70, win, lanes), null);
  assert.equal(hitNode(48, 70, win, lanes), null);
});

test("a pointer outside the window's rows hits nothing", () => {
  assert.equal(hitNode(16, -2, win, lanes), null);
  assert.equal(hitNode(16, 40 * 28 + 14, win, lanes), null);
  assert.equal(hitNode(16, 14, { start: 0, end: 0 }, lanes), null);
});

test("a pointer's row comes from the row pitch, or null outside the window's rows", () => {
  assert.equal(rowAt(0, win), 40);
  assert.equal(rowAt(27.9, win), 40);
  assert.equal(rowAt(28, win), 41);
  assert.equal(rowAt(-1, win), null);
  assert.equal(rowAt(40 * 28, win), null);
  assert.equal(rowAt(0, { start: 0, end: 0 }), null);
});
