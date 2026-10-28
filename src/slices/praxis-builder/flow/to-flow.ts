// Copied from the Archon builder (coleam00/Archon b9624b7,
// packages/web/src/experiments/console/builder/flow/to-flow.ts and flow/types.ts), MIT;
// see ../NOTICE. Quay changes: retyped from Archon's `BuilderWorkflow` to the Praxis
// graph, edge ids encoded as JSON, DECISION branch edges labelled and coloured in place
// of dashed `when:` edges, a dashed red edge for a branch whose target lacks the
// `dependsOn`, and an accessible name on every edge (#264).
/**
 * Praxis graph → xyflow nodes/edges.
 *
 * Positions are UI-only state, kept in the graph's layout file: callers pass the
 * saved position map and `placeNodes` computes a position for any node missing
 * from it, so a graph with no layout file lays itself out.
 */
import type { Edge, Node } from "@xyflow/react";
import { branchOf, type PraxisGraph, type PraxisNode, type XYPosition } from "../model.ts";
import { NODE_HEIGHT, NODE_WIDTH, placeNodes } from "./layout.ts";
import type { NodeIssues } from "../issues.ts";
import type { BindingMark } from "../graphBinding.ts";

/** The xyflow `nodeTypes` key every Praxis node renders under. */
export const PRAXIS_NODE_TYPE = "praxisNode";

export const EDGE_COLOR = { plain: "#6e7681", then: "#3fb950", else: "#f85149" } as const;

/** The data payload on each canvas node: the whole graph node. */
export interface PraxisNodeData {
  node: PraxisNode;
  /** The node's validation issues, set by the canvas for the card's badge. */
  issues?: NodeIssues;
  /** The chosen graph binding's mark for the node, set by the canvas for a dispatchable card. */
  binding?: BindingMark;
  /** Required by React Flow's Node<T> constraint — do not rely on this for typed access. */
  [key: string]: unknown;
}

export type PraxisFlowNode = Node<PraxisNodeData>;

/**
 * Stable edge id for a source and target. Praxis node ids have no grammar (an id may
 * contain `->`), so the pair is JSON-encoded. `tag` tells apart a second edge between
 * the same two nodes.
 */
export function edgeId(source: string, target: string, tag = ""): string {
  return JSON.stringify([source, target, tag]);
}

/**
 * Synthesize the edge list from each node's `dependsOn`. Dangling deps (ids not present
 * in the graph) and self-dependencies get no edge — they stay on the node (and are
 * flagged by validation) rather than becoming phantom canvas edges. An edge out of a
 * DECISION that is its `then` or `else` target is labelled and coloured, and leaves the
 * card from that branch's handle. A `then` or `else` whose target doesn't list the
 * decision in `dependsOn` is drawn dashed red.
 */
export function graphToFlowEdges(graph: PraxisGraph): Edge[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges: Edge[] = [];
  for (const target of graph.nodes) {
    for (const sourceId of new Set(target.dependsOn)) {
      const source = byId.get(sourceId);
      if (!source || sourceId === target.id) continue;
      const branch = branchOf(source, target.id);
      const color = EDGE_COLOR[branch ?? "plain"];
      edges.push({
        id: edgeId(sourceId, target.id),
        source: sourceId,
        target: target.id,
        type: "smoothstep",
        sourceHandle: source.kind === "DECISION" ? (branch ?? "dep") : undefined,
        label: branch ?? undefined,
        ariaLabel: `${target.id} depends on ${sourceId}${branch ? `, the ${branch} branch of ${sourceId}` : ""}`,
        labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: "#0d1117" },
        style: { stroke: color, strokeWidth: 1.5 },
        markerEnd: { type: "arrowclosed", color },
      });
    }
  }
  for (const decision of graph.nodes) {
    if (decision.kind !== "DECISION") continue;
    for (const branch of ["then", "else"] as const) {
      const targetId = decision.config[branch];
      if (typeof targetId !== "string" || targetId === decision.id) continue;
      const target = byId.get(targetId);
      if (!target || target.dependsOn.includes(decision.id)) continue;
      edges.push({
        id: edgeId(decision.id, targetId, `missing-${branch}`),
        source: decision.id,
        target: targetId,
        type: "smoothstep",
        sourceHandle: branch,
        label: `${branch}, missing from dependsOn`,
        ariaLabel: `The ${branch} branch of ${decision.id} points at ${targetId}, which doesn't depend on ${decision.id}`,
        labelStyle: { fill: EDGE_COLOR.else, fontSize: 10 },
        labelBgStyle: { fill: "#0d1117" },
        style: { stroke: EDGE_COLOR.else, strokeWidth: 1.5, strokeDasharray: "5 4" },
        markerEnd: { type: "arrowclosed", color: EDGE_COLOR.else },
      });
    }
  }
  return edges;
}

/** Map a Praxis graph (+ saved positions) to xyflow nodes and edges. */
export function graphToFlow(
  graph: PraxisGraph,
  positions: ReadonlyMap<string, XYPosition> = new Map()
): { nodes: PraxisFlowNode[]; edges: Edge[] } {
  const edges = graphToFlowEdges(graph);
  const placed = placeNodes(
    graph.nodes.map((n) => n.id),
    edges.map((e) => ({ source: e.source, target: e.target })),
    positions
  );

  const nodes: PraxisFlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: PRAXIS_NODE_TYPE,
    // placeNodes returns a position for every id it is given.
    position: placed.get(node.id) ?? { x: 0, y: 0 },
    // Seed dimensions so consumers that read node size (the MiniMap, fitView
    // bounds) have values before the DOM measurement lands. initialWidth/Height
    // only seed — the live DOM measurement still drives the node's real rendered
    // size on the canvas.
    initialWidth: NODE_WIDTH,
    initialHeight: NODE_HEIGHT,
    data: { node },
  }));

  return { nodes, edges };
}
