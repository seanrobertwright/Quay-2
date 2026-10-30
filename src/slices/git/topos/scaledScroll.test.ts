/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyOffset, MAX_SPACER_HEIGHT, offsetAfterScroll, scrollScale, scrollTopFor, wheelOffset, windowTop } from "./scaledScroll.ts";

test("below 8M px the spacer is as tall as the content and the scroll offset is the content offset", () => {
  // 100k rows at 28 px: 2.8M px of content.
  const scale = scrollScale(2_800_000, 700);
  assert.equal(scale.scaled, false);
  assert.equal(scale.spacerHeight, 2_800_000);
  assert.equal(offsetAfterScroll(scale, 0, 123_456), 123_456);
  assert.equal(scrollTopFor(scale, 123_456), 123_456);
  // Exactly 8M px still scrolls natively.
  assert.equal(scrollScale(MAX_SPACER_HEIGHT, 700).scaled, false);
});

test("above 8M px the spacer is capped and the scrollbar maps proportionally onto the content", () => {
  // 2M rows at 28 px: 56M px of content in a 1,000 px viewport.
  const scale = scrollScale(56_000_000, 1_000);
  assert.equal(scale.scaled, true);
  assert.equal(scale.spacerHeight, 8_000_000);
  // The bottom of the scrollbar is the bottom of the content: the last row is reachable.
  assert.equal(offsetAfterScroll(scale, 0, 8_000_000 - 1_000), 56_000_000 - 1_000);
  assert.equal(scrollTopFor(scale, 56_000_000 - 1_000), 8_000_000 - 1_000);
  // Halfway down the scrollbar is halfway down the content.
  assert.equal(offsetAfterScroll(scale, 0, (8_000_000 - 1_000) / 2), (56_000_000 - 1_000) / 2);
  // A drag past the end, or a NaN, stays inside the content.
  assert.equal(offsetAfterScroll(scale, 0, 9_000_000), 56_000_000 - 1_000);
  assert.equal(offsetAfterScroll(scale, 0, Number.NaN), 0);
});

test("a scroll the list set itself leaves the scaled offset where the list put it", () => {
  const scale = scrollScale(56_000_000, 1_000);
  // One wheel notch of 100 px moves the content by 100 px, though the scrollbar moves only ~14 px.
  const offset = 30_000_100;
  const top = scrollTopFor(scale, offset);
  assert.ok(Math.abs(top - (30_000_100 * 7_999_000) / 55_999_000) < 1e-6);
  assert.equal(offsetAfterScroll(scale, offset, top), offset);
  // The browser rounds scrollTop to a device pixel; that still isn't the operator scrolling.
  assert.equal(offsetAfterScroll(scale, offset, Math.round(top)), offset);
  // Two pixels away is the scrollbar moving.
  assert.notEqual(offsetAfterScroll(scale, offset, top + 2), offset);
});

test("a wheel event moves the scaled content by exactly its deltaY", () => {
  const scale = scrollScale(56_000_000, 1_000);
  assert.equal(wheelOffset(scale, 30_000_000, 100, 0, 1_000), 30_000_100);
  assert.equal(wheelOffset(scale, 30_000_000, -300, 0, 1_000), 29_999_700);
  // Line and page deltas count rows and viewports.
  assert.equal(wheelOffset(scale, 30_000_000, 3, 1, 1_000), 30_000_000 + 3 * 28);
  assert.equal(wheelOffset(scale, 30_000_000, 1, 2, 1_000), 30_001_000);
  // Never past either end.
  assert.equal(wheelOffset(scale, 50, -100, 0, 1_000), 0);
  assert.equal(wheelOffset(scale, 55_998_950, 100, 0, 1_000), 55_999_000);
});

test("scroll keys set the scaled offset directly", () => {
  const scale = scrollScale(56_000_000, 1_000);
  const at = 30_000_000;
  assert.equal(keyOffset(scale, at, "ArrowDown", false, 1_000), at + 40);
  assert.equal(keyOffset(scale, at, "ArrowUp", false, 1_000), at - 40);
  // A page keeps one row of the last view in sight.
  assert.equal(keyOffset(scale, at, "PageDown", false, 1_000), at + 972);
  assert.equal(keyOffset(scale, at, "PageUp", false, 1_000), at - 972);
  assert.equal(keyOffset(scale, at, " ", false, 1_000), at + 972);
  assert.equal(keyOffset(scale, at, " ", true, 1_000), at - 972);
  assert.equal(keyOffset(scale, at, "Home", false, 1_000), 0);
  assert.equal(keyOffset(scale, at, "End", false, 1_000), 55_999_000);
  // Other keys aren't scroll keys.
  assert.equal(keyOffset(scale, at, "Enter", false, 1_000), null);
  assert.equal(keyOffset(scale, at, "a", false, 1_000), null);
});

test("the row window sits so the row at the content offset is at the top of the viewport", () => {
  // Natively the window sits at its own content y.
  assert.equal(windowTop(5_600, 5_600, 192), 192 * 28);
  // Scaled: scrollbar at 1,000 px standing for content offset 7,000 px. Row 250 starts at 7,000
  // px of content, so it must sit at 1,000 px in the spacer; the window from row 248 starts 56 px
  // above it.
  assert.equal(windowTop(1_000, 7_000, 248), 944);
});
