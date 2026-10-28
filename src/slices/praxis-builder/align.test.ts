/// <reference types="node" />
// Copied from the Archon builder (coleam00/Archon b9624b7,
// packages/web/src/experiments/console/builder/editor/align.test.ts), MIT; see ./NOTICE.
// Quay changes: ported to node:test, and cases added for `arrangeEdges`.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  align,
  alignBottom,
  alignCenterH,
  alignCenterV,
  alignLeft,
  alignRight,
  alignTop,
  arrangeEdges,
  autoArrange,
  distributeH,
  distributeV,
  type NodeRect,
} from "./align.ts";
import type { PraxisGraph, PraxisNode } from "./model.ts";

function rect(id: string, x: number, y: number, width = 100, height = 50): NodeRect {
  return { id, position: { x, y }, width, height };
}

const TRIO: NodeRect[] = [rect("a", 0, 0), rect("b", 250, 40), rect("c", 600, 90)];

describe("align kernels", () => {
  test("alignLeft moves everything to the minimum x, preserving y", () => {
    const out = alignLeft(TRIO);
    assert.deepEqual(out.get("a"), { x: 0, y: 0 });
    assert.deepEqual(out.get("b"), { x: 0, y: 40 });
    assert.deepEqual(out.get("c"), { x: 0, y: 90 });
  });

  test("alignRight aligns right edges to the maximum right", () => {
    const out = alignRight(TRIO);
    // max right = 600 + 100 = 700; every rect's x = 700 - width.
    assert.equal(out.get("a")?.x, 600);
    assert.equal(out.get("b")?.x, 600);
    assert.equal(out.get("c")?.x, 600);
  });

  test("alignTop / alignBottom mirror left/right on the y axis", () => {
    const top = alignTop(TRIO);
    assert.deepEqual([top.get("a")?.y, top.get("b")?.y, top.get("c")?.y], [0, 0, 0]);
    const bottom = alignBottom(TRIO);
    // max bottom = 90 + 50 = 140; y = 140 - height.
    assert.deepEqual([bottom.get("a")?.y, bottom.get("b")?.y, bottom.get("c")?.y], [90, 90, 90]);
  });

  test("alignCenterH centers on the shared horizontal centerline (same y)", () => {
    const out = alignCenterH([rect("a", 0, 0), rect("b", 200, 100)]);
    // span 0..150, centerY = 75, each y = 75 - 25 = 50.
    assert.equal(out.get("a")?.y, 50);
    assert.equal(out.get("b")?.y, 50);
    assert.equal(out.get("a")?.x, 0);
  });

  test("alignCenterV centers on the shared vertical centerline (same x)", () => {
    const out = alignCenterV([rect("a", 0, 0), rect("b", 200, 100)]);
    // span 0..300, centerX = 150, each x = 150 - 50 = 100.
    assert.equal(out.get("a")?.x, 100);
    assert.equal(out.get("b")?.x, 100);
    assert.equal(out.get("b")?.y, 100);
  });

  test("align() dispatches every mode", () => {
    for (const mode of ["left", "right", "top", "bottom", "centerH", "centerV"] as const) {
      assert.equal(align(mode, TRIO).size, 3);
    }
  });
});

describe("distribute kernels", () => {
  test("distributeH spaces gaps evenly, anchoring first and last", () => {
    const out = distributeH(TRIO);
    // span = (600+100) - 0 = 700; widths total 300; gap = (700-300)/2 = 200.
    assert.equal(out.get("a")?.x, 0);
    assert.equal(out.get("b")?.x, 300);
    assert.equal(out.get("c")?.x, 600);
    // y untouched.
    assert.equal(out.get("b")?.y, 40);
  });

  test("distributeV spaces gaps evenly on the y axis", () => {
    const out = distributeV([rect("a", 0, 0), rect("b", 10, 30), rect("c", 20, 400)]);
    // span = 450 - 0 = 450; heights total 150; gap = (450-150)/2 = 150.
    assert.equal(out.get("a")?.y, 0);
    assert.equal(out.get("b")?.y, 200);
    assert.equal(out.get("c")?.y, 400);
  });

  test("fewer than three rects is the identity", () => {
    const out = distributeH([rect("a", 5, 6), rect("b", 70, 80)]);
    assert.deepEqual(out.get("a"), { x: 5, y: 6 });
    assert.deepEqual(out.get("b"), { x: 70, y: 80 });
  });
});

describe("autoArrange", () => {
  test("delegates to dagre and returns a position per node", () => {
    const out = autoArrange(["a", "b"], [{ source: "a", target: "b" }]);
    assert.equal(out.size, 2);
    const a = out.get("a");
    const b = out.get("b");
    assert.ok(a && b && b.y > a.y);
  });

  test("a DECISION's then target lands left of its else target", () => {
    // Listed else-first, so only the branch edge order puts `yes` on the left.
    const g = graph([
      node("check", "DECISION", [], { then: "yes", else: "no" }),
      node("no", "TASK", ["check"]),
      node("yes", "TASK", ["check"]),
    ]);
    const out = autoArrange(g.nodes.map((n) => n.id), arrangeEdges(g));
    assert.ok(out.get("yes")!.x < out.get("no")!.x);
  });
});

const node = (id: string, kind: string, dependsOn: string[] = [], config: PraxisNode["config"] = {}): PraxisNode => ({
  id,
  kind,
  dependsOn,
  config,
});
const graph = (nodes: PraxisNode[]): PraxisGraph => ({ id: "g", revision: "1", nodes });

describe("arrangeEdges", () => {
  test("a DECISION's else edge comes first, then its then edge, then its other dependents", () => {
    const g = graph([
      node("check", "DECISION", [], { then: "yes", else: "no" }),
      node("log", "TASK", ["check"]),
      node("no", "TASK", ["check"]),
      node("yes", "TASK", ["check"]),
    ]);
    assert.deepEqual(arrangeEdges(g), [
      { source: "check", target: "no" },
      { source: "check", target: "yes" },
      { source: "check", target: "log" },
    ]);
  });

  test("a branch target outside dependsOn still shapes the layout; unknown and self targets don't", () => {
    const g = graph([
      node("check", "DECISION", [], { then: "yes", else: "check" }),
      node("yes", "TASK"),
      node("next", "TASK", ["check", "ghost", "next"]),
    ]);
    assert.deepEqual(arrangeEdges(g), [
      { source: "check", target: "yes" },
      { source: "check", target: "next" },
    ]);
  });

  test("an edge listed twice in dependsOn is fed once", () => {
    const g = graph([node("a", "TASK"), node("b", "TASK", ["a", "a"])]);
    assert.deepEqual(arrangeEdges(g), [{ source: "a", target: "b" }]);
  });
});
