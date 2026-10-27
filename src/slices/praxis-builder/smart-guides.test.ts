/// <reference types="node" />
// Copied from the Archon builder (coleam00/Archon b9624b7,
// packages/web/src/experiments/console/builder/editor/smart-guides.test.ts), MIT; see ./NOTICE.
// Quay changes: ported to node:test.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeGuides, GUIDE_THRESHOLD, type Rect } from "./smart-guides.ts";

function r(id: string, x: number, y: number, width = 100, height = 50): Rect {
  return { id, x, y, width, height };
}

describe("computeGuides", () => {
  test("no candidates outside the threshold — position unchanged", () => {
    const dragged = r("d", 0, 0);
    const result = computeGuides(dragged, [r("s", 500, 500)], GUIDE_THRESHOLD);
    assert.deepEqual(result.vertical, []);
    assert.deepEqual(result.horizontal, []);
    assert.deepEqual(result.snap, { x: 0, y: 0 });
  });

  test("left edges within threshold snap exactly and emit a vertical guide", () => {
    const dragged = r("d", 104, 300);
    const result = computeGuides(dragged, [r("s", 100, 0)], 6);
    assert.ok(result.vertical.includes(100));
    assert.equal(result.snap.x, 100);
    // y has no candidate — untouched.
    assert.equal(result.snap.y, 300);
  });

  test("right edge aligning to a left edge snaps x to (edge - width)", () => {
    // dragged right = 204; stationary left = 200 → snap right edge onto it.
    const dragged = r("d", 104, 300);
    const result = computeGuides(dragged, [r("s", 200, 0)], 6);
    assert.ok(result.vertical.includes(200));
    assert.equal(result.snap.x, 100);
  });

  test("center-to-center alignment snaps both axes", () => {
    // stationary center = (150, 125); dragged center currently (153, 122).
    const dragged = r("d", 103, 97);
    const result = computeGuides(dragged, [r("s", 100, 100)], 6);
    assert.ok(result.vertical.includes(150));
    assert.ok(result.horizontal.includes(125));
    assert.deepEqual(result.snap, { x: 100, y: 100 });
  });

  test("top/bottom edge candidates emit horizontal guides", () => {
    // dragged top = 148; stationary bottom = 150 → within threshold.
    const dragged = r("d", 500, 148);
    const result = computeGuides(dragged, [r("s", 0, 100)], 6);
    assert.ok(result.horizontal.includes(150));
    assert.equal(result.snap.y, 150);
  });

  test("the closest candidate wins the snap", () => {
    // Two stationary rects: left edges at 95 (distance 5) and 102 (distance 2).
    const dragged = r("d", 100, 0);
    const result = computeGuides(dragged, [r("far", 95, 200), r("near", 102, 400)], 6);
    assert.equal(result.snap.x, 102);
    // Both guides still render.
    assert.ok(result.vertical.includes(95) && result.vertical.includes(102));
  });

  test("threshold is inclusive and respected", () => {
    const dragged = r("d", 100, 0);
    const at = computeGuides(dragged, [r("s", 106, 200)], 6);
    assert.equal(at.snap.x, 106);
    const beyond = computeGuides(dragged, [r("s", 107, 200)], 6);
    assert.equal(beyond.snap.x, 100);
    assert.deepEqual(beyond.vertical, []);
  });

  test("the dragged rect never matches against itself", () => {
    const dragged = r("d", 100, 100);
    const result = computeGuides(dragged, [dragged], 6);
    assert.deepEqual(result.vertical, []);
    assert.deepEqual(result.horizontal, []);
  });

  test("duplicate guide coordinates are deduped", () => {
    const dragged = r("d", 100, 0);
    // Two rects perfectly aligned with the dragged one: left/right/center
    // coordinates each match twice but emit one guide apiece.
    const result = computeGuides(dragged, [r("s1", 100, 200), r("s2", 100, 400)], 6);
    assert.equal(result.vertical.length, new Set(result.vertical).size);
    assert.deepEqual([...result.vertical].sort((a, b) => a - b), [100, 150, 200]);
  });
});
