// Tests for the copied layout and mapping. The layoutWithDagre and builderToFlow cases
// port the Archon builder's flow/flow.test.ts (MIT; see ../NOTICE) from bun:test.
/// <reference types="node" />
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PraxisGraph, PraxisNode, XYPosition } from "../model.ts";
import { layoutWithDagre, NODE_HEIGHT, NODE_WIDTH, placeNodes } from "./layout.ts";
import { EDGE_COLOR, edgeId, graphToFlow, graphToFlowEdges, PRAXIS_NODE_TYPE } from "./to-flow.ts";

const node = (id: string, kind: string, dependsOn: string[] = [], config: PraxisNode["config"] = {}): PraxisNode => ({
  id,
  kind,
  dependsOn,
  config,
});

const graph = (...nodes: PraxisNode[]): PraxisGraph => ({ id: "g", revision: "", nodes });

/** plan → check (DECISION) → ship (then) / undo (else) → end */
const branching = () =>
  graph(
    node("plan", "TASK", [], { executionKind: "AGENT" }),
    node("check", "DECISION", ["plan"], { field: "ok", equals: true, then: "ship", else: "undo" }),
    node("ship", "TASK", ["check"], { executionKind: "TOOL" }),
    node("undo", "COMPENSATION", ["check"]),
    node("end", "END", ["ship", "undo"])
  );

describe("layoutWithDagre", () => {
  test("positions every node, dependents below their dependencies", () => {
    const positions = layoutWithDagre(
      ["a", "b", "c"],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ]
    );
    const a = positions.get("a");
    const b = positions.get("b");
    const c = positions.get("c");
    assert.ok(a && b && c);
    assert.ok(b.y >= a.y + NODE_HEIGHT);
    assert.ok(c.y >= b.y + NODE_HEIGHT);
  });

  test("skips edges referencing unknown ids instead of inventing nodes", () => {
    const positions = layoutWithDagre(["a"], [{ source: "a", target: "ghost" }]);
    assert.deepEqual([...positions.keys()], ["a"]);
  });
});

describe("placeNodes", () => {
  const chain = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ];

  test("with no saved positions it is a plain dagre layout", () => {
    const dagre = layoutWithDagre(["a", "b", "c"], chain);
    const placed = placeNodes(["a", "b", "c"], chain, new Map());
    for (const id of ["a", "b", "c"]) {
      const d = dagre.get(id)!;
      assert.deepEqual(placed.get(id), { x: Math.round(d.x), y: Math.round(d.y) });
    }
  });

  test("keeps saved positions as they are", () => {
    const saved = new Map<string, XYPosition>([
      ["a", { x: 7, y: 11 }],
      ["b", { x: 500, y: -40 }],
      ["c", { x: 0, y: 0 }],
    ]);
    assert.deepEqual(placeNodes(["a", "b", "c"], chain, saved), saved);
  });

  test("seeds an unplaced node from its placed neighbours", () => {
    // `a` was moved far right of where dagre puts it and the unrelated `z` far left;
    // `b` follows its neighbour `a`, not the average of every placed node.
    const ids = ["a", "b", "z"];
    const edges = [{ source: "a", target: "b" }];
    const dagre = layoutWithDagre(ids, edges);
    const da = dagre.get("a")!;
    const db = dagre.get("b")!;
    const dz = dagre.get("z")!;
    const saved = new Map<string, XYPosition>([
      ["a", { x: da.x + 1000, y: da.y + 200 }],
      ["z", { x: dz.x - 3000, y: dz.y }],
    ]);
    const placed = placeNodes(ids, edges, saved);
    assert.deepEqual(placed.get("a"), saved.get("a"));
    assert.deepEqual(placed.get("b"), { x: Math.round(db.x + 1000), y: Math.round(db.y + 200) });
  });

  test("a node with no placed neighbour follows the placed nodes overall", () => {
    const ids = ["a", "b", "lonely"];
    const edges = [{ source: "a", target: "b" }];
    const dagre = layoutWithDagre(ids, edges);
    const saved = new Map<string, XYPosition>([
      ["a", { x: dagre.get("a")!.x + 300, y: dagre.get("a")!.y }],
      ["b", { x: dagre.get("b")!.x + 300, y: dagre.get("b")!.y }],
    ]);
    const lonely = placeNodes(ids, edges, saved).get("lonely")!;
    assert.equal(lonely.x, Math.round(dagre.get("lonely")!.x + 300));
  });

  test("positions are whole numbers", () => {
    const saved = new Map<string, XYPosition>([["a", { x: 0.5, y: 0.25 }]]);
    const placed = placeNodes(["a", "b", "c"], chain, saved);
    for (const id of ["b", "c"]) {
      const p = placed.get(id)!;
      assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y), `${id}: ${JSON.stringify(p)}`);
    }
  });
});

describe("graphToFlow", () => {
  test("maps every node in order and synthesizes dependsOn edges", () => {
    const { nodes, edges } = graphToFlow(branching());
    assert.deepEqual(
      nodes.map((n) => n.id),
      ["plan", "check", "ship", "undo", "end"]
    );
    assert.ok(nodes.every((n) => n.type === PRAXIS_NODE_TYPE));
    assert.equal(nodes[1].data.node.kind, "DECISION");
    assert.deepEqual(
      edges.map((e) => e.id).sort(),
      [
        edgeId("check", "ship"),
        edgeId("check", "undo"),
        edgeId("plan", "check"),
        edgeId("ship", "end"),
        edgeId("undo", "end"),
      ].sort()
    );
  });

  test("seeds node dimensions for the MiniMap and fitView", () => {
    const { nodes } = graphToFlow(branching());
    assert.ok(nodes.every((n) => n.initialWidth === NODE_WIDTH && n.initialHeight === NODE_HEIGHT));
  });

  test("applies saved positions and lays out nodes missing one", () => {
    const saved = new Map<string, XYPosition>([["plan", { x: 7, y: 11 }]]);
    const { nodes } = graphToFlow(branching(), saved);
    assert.deepEqual(nodes.find((n) => n.id === "plan")?.position, { x: 7, y: 11 });
    // `end` had no saved position, so it sits below the node it depends on.
    const ship = nodes.find((n) => n.id === "ship")!;
    const end = nodes.find((n) => n.id === "end")!;
    assert.ok(end.position.y > ship.position.y);
  });

  test("ignores saved positions for nodes that no longer exist", () => {
    const saved = new Map<string, XYPosition>([["gone", { x: 1, y: 1 }]]);
    const { nodes } = graphToFlow(branching(), saved);
    assert.equal(nodes.length, 5);
    assert.ok(!nodes.some((n) => n.id === "gone"));
  });

  test("dangling and self dependencies produce no edge", () => {
    const edges = graphToFlowEdges(graph(node("a", "TASK", ["a", "ghost"]), node("end", "END", ["a"])));
    assert.deepEqual(
      edges.map((e) => e.id),
      [edgeId("a", "end")]
    );
  });

  test("edge ids stay distinct when node ids contain the old separator", () => {
    const edges = graphToFlowEdges(
      graph(node("a->b", "TASK"), node("c", "TASK", ["a->b"]), node("a", "TASK"), node("b->c", "TASK", ["a"]))
    );
    assert.equal(new Set(edges.map((e) => e.id)).size, edges.length);
    assert.deepEqual(JSON.parse(edges[0].id), ["a->b", "c", ""]);
  });
});

describe("DECISION branch edges", () => {
  test("then and else edges are labelled, coloured and leave from their handle", () => {
    const edges = graphToFlowEdges(branching());
    const then = edges.find((e) => e.id === edgeId("check", "ship"))!;
    const otherwise = edges.find((e) => e.id === edgeId("check", "undo"))!;
    assert.equal(then.label, "then");
    assert.equal(then.sourceHandle, "then");
    assert.equal(then.style?.stroke, EDGE_COLOR.then);
    assert.equal(otherwise.label, "else");
    assert.equal(otherwise.sourceHandle, "else");
    assert.equal(otherwise.style?.stroke, EDGE_COLOR.else);
  });

  test("a plain dependent of a decision leaves from the dependent handle, unlabelled", () => {
    const g = branching();
    g.nodes.push(node("log", "TASK", ["check"]));
    const log = graphToFlowEdges(g).find((e) => e.target === "log")!;
    assert.equal(log.sourceHandle, "dep");
    assert.equal(log.label, undefined);
    assert.equal(log.style?.stroke, EDGE_COLOR.plain);
  });

  test("edges out of other kinds use the default handle", () => {
    const plan = graphToFlowEdges(branching()).find((e) => e.source === "plan")!;
    assert.equal(plan.sourceHandle, undefined);
    assert.equal(plan.style?.strokeDasharray, undefined);
  });

  test("a branch whose target lacks the dependsOn is drawn dashed red", () => {
    const g = branching();
    g.nodes = g.nodes.map((n) => (n.id === "undo" ? { ...n, dependsOn: [] } : n));
    const edges = graphToFlowEdges(g);
    assert.ok(!edges.some((e) => e.id === edgeId("check", "undo")));
    const missing = edges.find((e) => e.source === "check" && e.target === "undo")!;
    assert.equal(missing.id, edgeId("check", "undo", "missing-else"));
    assert.equal(missing.sourceHandle, "else");
    assert.equal(missing.style?.stroke, EDGE_COLOR.else);
    assert.equal(missing.style?.strokeDasharray, "5 4");
    assert.match(String(missing.label), /^else/);
  });

  test("a branch pointing at a missing node draws nothing", () => {
    const g = graph(node("d", "DECISION", [], { field: "x", equals: 1, then: "ghost", else: "" }), node("end", "END", ["d"]));
    const edges = graphToFlowEdges(g);
    assert.deepEqual(
      edges.map((e) => e.id),
      [edgeId("d", "end")]
    );
  });
});

describe("edge names for screen readers", () => {
  test("each edge says which node depends on which, and names a branch", () => {
    const labels = new Map(graphToFlowEdges(branching()).map((e) => [e.id, e.ariaLabel]));
    assert.equal(labels.get(edgeId("plan", "check")), "check depends on plan");
    assert.equal(labels.get(edgeId("check", "ship")), "ship depends on check, the then branch of check");
    assert.equal(labels.get(edgeId("check", "undo")), "undo depends on check, the else branch of check");
  });

  test("a branch missing from dependsOn says so", () => {
    const g = graph(node("d", "DECISION", [], { then: "t", else: "" }), node("t", "TASK"));
    const [edge] = graphToFlowEdges(g);
    assert.equal(edge.ariaLabel, "The then branch of d points at t, which doesn't depend on d");
  });
});
