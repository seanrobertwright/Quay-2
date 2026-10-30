/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  columnLayout,
  displayLane,
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  resizeByKey,
} from "./graphColumn.ts";

// With W = 16 and P = 8, a column w px wide has room for floor((w - 16) / 16) lane slots.

test("the default 220 px column shows 12 lanes (#351)", () => {
  assert.deepEqual(columnLayout(DEFAULT_COLUMN_WIDTH, 12), { width: 220, stubLane: null });
});

test("a history that fits the column has no stub", () => {
  assert.deepEqual(columnLayout(80, 4), { width: 80, stubLane: null });
});

test("lanes past the column's edge collapse onto a stub in its last slot", () => {
  // 80 px has room for 4 slots: lanes 0 to 2 show, and slot 3 is the stub.
  const layout = columnLayout(80, 5);
  assert.equal(layout.stubLane, 3);
  assert.deepEqual([0, 1, 2, 3, 4, 9].map((l) => displayLane(l, layout)), [0, 1, 2, 3, 3, 3]);
});

test("without a stub every lane keeps its place", () => {
  const layout = columnLayout(220, 3);
  assert.deepEqual([0, 1, 2].map((l) => displayLane(l, layout)), [0, 1, 2]);
});

test("the width is clamped, and a non-number falls back to the default", () => {
  assert.equal(columnLayout(10, 40).width, MIN_COLUMN_WIDTH);
  assert.equal(columnLayout(10_000, 40).width, MAX_COLUMN_WIDTH);
  assert.equal(columnLayout(Number.NaN, 40).width, DEFAULT_COLUMN_WIDTH);
  // The narrowest column still shows lane 0 beside the stub.
  assert.equal(columnLayout(MIN_COLUMN_WIDTH, 40).stubLane, 1);
});

test("the resize handle's keys step one lane, four lanes, or to either end", () => {
  assert.equal(resizeByKey(220, "ArrowRight", false), 236);
  assert.equal(resizeByKey(220, "ArrowLeft", false), 204);
  assert.equal(resizeByKey(220, "ArrowRight", true), 284);
  assert.equal(resizeByKey(220, "PageDown", false), 156);
  assert.equal(resizeByKey(220, "Home", false), MIN_COLUMN_WIDTH);
  assert.equal(resizeByKey(220, "End", false), MAX_COLUMN_WIDTH);
  assert.equal(resizeByKey(MIN_COLUMN_WIDTH, "ArrowLeft", false), MIN_COLUMN_WIDTH);
  assert.equal(resizeByKey(220, "Enter", false), null);
});
