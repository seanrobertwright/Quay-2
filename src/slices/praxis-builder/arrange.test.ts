/// <reference types="node" />
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ARRANGE_ACTIONS, arrangedPositions, arrangeLabel, canArrange, type ArrangeAction } from "./arrange.ts";
import type { PraxisGraph, XYPosition } from "./model.ts";

const graph: PraxisGraph = {
  id: "g",
  revision: "1",
  nodes: [
    { id: "a", kind: "TASK", dependsOn: [], config: {} },
    { id: "b", kind: "TASK", dependsOn: ["a"], config: {} },
    { id: "c", kind: "TASK", dependsOn: ["b"], config: {} },
  ],
};
const positions = new Map<string, XYPosition>([
  ["a", { x: 0, y: 0 }],
  ["b", { x: 250, y: 40 }],
  ["c", { x: 600, y: 90 }],
]);
const size = () => ({ width: 100, height: 50 });
const LEFT: ArrangeAction = { type: "align", mode: "left" };
const ACROSS: ArrangeAction = { type: "distribute", axis: "horizontal" };

describe("canArrange", () => {
  test("align needs two nodes, distribute three, auto-arrange none", () => {
    assert.equal(canArrange(LEFT, 1), false);
    assert.equal(canArrange(LEFT, 2), true);
    assert.equal(canArrange(ACROSS, 2), false);
    assert.equal(canArrange(ACROSS, 3), true);
    assert.equal(canArrange({ type: "auto" }, 0), true);
  });
});

describe("arrangedPositions", () => {
  test("align moves only the selected nodes", () => {
    const moved = arrangedPositions(LEFT, graph, positions, new Set(["b", "c"]), size);
    assert.deepEqual(moved, [
      ["b", { x: 250, y: 40 }],
      ["c", { x: 250, y: 90 }],
    ]);
  });

  test("distribute spaces the selected nodes evenly", () => {
    const moved = new Map(arrangedPositions(ACROSS, graph, positions, new Set(["a", "b", "c"]), size));
    assert.equal(moved.get("b")?.x, 300);
  });

  test("keeps fractions, which the draft rounds when it takes them", () => {
    const centre: ArrangeAction = { type: "align", mode: "centerV" };
    const odd = new Map([...positions, ["b", { x: 251, y: 40 }]]);
    const moved = new Map(arrangedPositions(centre, graph, odd, new Set(["a", "b"]), size));
    assert.equal(moved.get("a")?.x, 125.5);
  });

  test("returns nothing when too few nodes are selected", () => {
    assert.deepEqual(arrangedPositions(ACROSS, graph, positions, new Set(["a", "b"]), size), []);
  });

  test("auto-arrange lays out every node, whatever is selected", () => {
    const moved = new Map(arrangedPositions({ type: "auto" }, graph, positions, new Set(), size));
    assert.deepEqual([...moved.keys()], ["a", "b", "c"]);
    assert.ok(moved.get("a")!.y < moved.get("b")!.y && moved.get("b")!.y < moved.get("c")!.y);
  });

  test("ignores selected ids without a position", () => {
    const moved = arrangedPositions(LEFT, graph, positions, new Set(["b", "c", "ghost"]), size);
    assert.equal(moved.length, 2);
  });
});

test("every action has its own label", () => {
  const labels = ARRANGE_ACTIONS.map(arrangeLabel);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(arrangeLabel({ type: "auto" }), "Auto-arrange");
});
