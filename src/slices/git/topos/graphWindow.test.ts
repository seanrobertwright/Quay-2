/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROW_HEIGHT, rowWindow, WINDOW_STEP } from "./graphWindow.ts";

test("the window covers the viewport with overscan and starts on a step", () => {
  // Rows 100 to 121 are visible.
  const w = rowWindow(100 * ROW_HEIGHT, 21 * ROW_HEIGHT, 10_000);
  assert.equal(w.start % WINDOW_STEP, 0);
  assert.ok(w.start <= 100 && w.end >= 121);
  assert.ok(100 - w.start <= 2 * WINDOW_STEP && w.end - 121 <= 2 * WINDOW_STEP, "at most two steps of overscan each side");
});

test("the window start moves only in whole steps", () => {
  const starts = new Set<number>();
  for (let px = 0; px < 64 * ROW_HEIGHT; px += 3) starts.add(rowWindow(px, 600, 10_000).start);
  for (const s of starts) assert.equal(s % WINDOW_STEP, 0);
  // Scrolling 64 rows passes 8 steps, so at most 8 distinct starts.
  assert.ok(starts.size <= 64 / WINDOW_STEP);
  // A few pixels inside one step never move the window.
  assert.deepEqual(rowWindow(17 * ROW_HEIGHT, 600, 10_000), rowWindow(17 * ROW_HEIGHT + 20, 600, 10_000));
});

test("the window stays inside the rows there are", () => {
  assert.deepEqual(rowWindow(0, 600, 0), { start: 0, end: 0 });
  assert.deepEqual(rowWindow(0, 600, 5), { start: 0, end: 5 });
  const nearEnd = rowWindow(9_990 * ROW_HEIGHT, 600, 10_000);
  assert.equal(nearEnd.end, 10_000);
  // Scrolled past the end, as while rows are replaced, the window still shows the last rows.
  const past = rowWindow(50_000 * ROW_HEIGHT, 600, 10_000);
  assert.ok(past.start < 10_000 && past.end === 10_000);
  assert.deepEqual(rowWindow(Number.NaN, Number.NaN, 100), rowWindow(0, 0, 100));
});
