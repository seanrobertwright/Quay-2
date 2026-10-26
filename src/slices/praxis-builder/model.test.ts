/// <reference types="node" />
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  configSummary,
  MAX_NODES,
  parseGraph,
  parseLayoutPositions,
  parseLayoutViewport,
  type PraxisNode,
} from "./model.ts";

describe("parseGraph", () => {
  test("reads a well-formed graph", () => {
    const parsed = parseGraph({
      id: "g",
      revision: "sha256:ab",
      nodes: [
        { id: "a", kind: "TASK", dependsOn: [], config: { executionKind: "AGENT" }, outputSchema: { type: "object" } },
        { id: "end", kind: "END", dependsOn: ["a"], config: {} },
      ],
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.id, "g");
    assert.equal(parsed.value.revision, "sha256:ab");
    assert.deepEqual(parsed.value.nodes[1].dependsOn, ["a"]);
    assert.deepEqual(parsed.value.nodes[0].outputSchema, { type: "object" });
    assert.equal(parsed.value.nodes[0].inputSchema, undefined);
  });

  test("reads missing or malformed node fields as empty so the canvas can draw", () => {
    const parsed = parseGraph({ nodes: [{ id: "a", dependsOn: "b", config: [] }, { id: "b", kind: 7, dependsOn: ["a", 3] }] });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.nodes[0], { id: "a", kind: "", dependsOn: [], config: {} });
    assert.deepEqual(parsed.value.nodes[1].dependsOn, ["a"]);
    assert.equal(parsed.value.nodes[1].kind, "");
  });

  test("refuses what the canvas can't draw", () => {
    const refused = [
      [],
      { id: "g" },
      { nodes: {} },
      { nodes: [{ kind: "END" }] },
      { nodes: [{ id: "" }] },
      { nodes: ["a"] },
      { nodes: [{ id: "a" }, { id: "a" }] },
      { nodes: Array.from({ length: MAX_NODES + 1 }, (_, i) => ({ id: `n${i}` })) },
    ];
    for (const content of refused) {
      const parsed = parseGraph(content);
      assert.equal(parsed.ok, false, JSON.stringify(content).slice(0, 60));
    }
  });
});

describe("parseLayoutPositions", () => {
  test("reads finite positions and skips the rest", () => {
    const positions = parseLayoutPositions({
      version: 1,
      nodes: { a: { x: 10, y: -4 }, b: { x: "1", y: 2 }, c: { x: 1 }, d: null, e: { x: Infinity, y: 0 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    assert.deepEqual([...positions], [["a", { x: 10, y: -4 }]]);
  });

  test("a layout with no nodes object gives no positions", () => {
    for (const layout of [null, undefined, [], { nodes: [] }, { nodes: "x" }, "text"]) {
      assert.equal(parseLayoutPositions(layout).size, 0);
    }
  });

  test("ids named like Object properties are read as plain ids", () => {
    const positions = parseLayoutPositions(JSON.parse('{"nodes":{"__proto__":{"x":1,"y":2},"constructor":{"x":3,"y":4}}}'));
    assert.deepEqual(positions.get("__proto__"), { x: 1, y: 2 });
    assert.deepEqual(positions.get("constructor"), { x: 3, y: 4 });
  });
});

describe("configSummary", () => {
  const n = (kind: string, config: PraxisNode["config"]): PraxisNode => ({ id: "x", kind, dependsOn: [], config });

  test("summarizes each configurable kind on one line", () => {
    assert.equal(configSummary(n("TASK", { executionKind: "TOOL" })), "TOOL");
    assert.equal(configSummary(n("TASK", { executionKind: "" })), "no execution kind");
    assert.equal(configSummary(n("DECISION", { field: "passed", equals: true })), "passed == true");
    assert.equal(configSummary(n("DECISION", { field: "" })), "no field");
    assert.equal(configSummary(n("JOIN", { mode: "ANY" })), "wait for any");
    assert.equal(configSummary(n("JOIN", { mode: "ALL" })), "wait for all");
    assert.equal(configSummary(n("LOOP", { maxIterations: "5" })), "≤ 5 iterations");
    assert.equal(configSummary(n("LOOP", { maxIterations: 5 })), "≤ 5 iterations");
    assert.equal(configSummary(n("LOOP", {})), "no iteration limit");
    assert.equal(configSummary(n("END", {})), "");
  });
});

describe("parseLayoutViewport", () => {
  test("reads a saved viewport", () => {
    assert.deepEqual(parseLayoutViewport({ viewport: { x: -3, y: 4, zoom: 0.8 } }), { x: -3, y: 4, zoom: 0.8 });
  });

  test("ignores a missing or unusable viewport", () => {
    assert.equal(parseLayoutViewport(undefined), undefined);
    assert.equal(parseLayoutViewport({ nodes: {} }), undefined);
    assert.equal(parseLayoutViewport({ viewport: { x: 0, y: 0, zoom: 0 } }), undefined);
    assert.equal(parseLayoutViewport({ viewport: { x: "0", y: 0, zoom: 1 } }), undefined);
    assert.equal(parseLayoutViewport({ viewport: [0, 0, 1] }), undefined);
  });
});
