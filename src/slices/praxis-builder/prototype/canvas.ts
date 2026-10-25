// PROTOTYPE (#226) — throwaway. Canvas plumbing shared by the variants: dagre layout,
// and an xyflow node list that follows the graph while keeping measured sizes and
// dragged positions (xyflow v12 hides nodes that lose their `measured` field).
import { useCallback, useEffect, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import { applyNodeChanges, type Node, type NodeChange, type XYPosition } from "@xyflow/react";
import type { PGraph, PNode } from "./model";

export interface LayoutOpts {
  width: number;
  height: number;
  direction: "TB" | "LR";
  nodesep?: number;
  ranksep?: number;
  sizeOf?: (n: PNode) => { width: number; height: number };
}

export function layoutGraph(graph: PGraph, o: LayoutOpts): Map<string, XYPosition> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: o.direction, nodesep: o.nodesep ?? 36, ranksep: o.ranksep ?? 56 });
  g.setDefaultEdgeLabel(() => ({}));
  const size = (n: PNode) => o.sizeOf?.(n) ?? { width: o.width, height: o.height };
  for (const n of graph.nodes) g.setNode(n.id, size(n));
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const n of graph.nodes) for (const d of n.dependsOn) if (ids.has(d) && d !== n.id) g.setEdge(d, n.id);
  dagre.layout(g);
  const out = new Map<string, XYPosition>();
  for (const n of graph.nodes) {
    const p = g.node(n.id);
    const s = size(n);
    out.set(n.id, { x: p.x - s.width / 2, y: p.y - s.height / 2 });
  }
  return out;
}

// Edge ids join two node ids; Praxis ids have no grammar, so encode as JSON.
export const edgeId = (source: string, target: string, tag = "") => JSON.stringify([source, target, tag]);

export function useFlowNodes<D extends Record<string, unknown>>(
  graph: PGraph,
  selectedId: string | null,
  type: string,
  data: (n: PNode) => D,
  layout: LayoutOpts,
) {
  const [nodes, setNodes] = useState<Node<D>[]>(() => {
    const pos = layoutGraph(graph, layout);
    return graph.nodes.map((n) => ({ id: n.id, type, position: pos.get(n.id)!, data: data(n), selected: n.id === selectedId }));
  });
  const aliases = useRef(new Map<string, string>()); // new id -> old id, for renames
  const placements = useRef(new Map<string, XYPosition>()); // where to drop newly added nodes

  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      const lowest = prev.reduce((m, p) => Math.max(m, p.position.y), 0);
      const next = graph.nodes.map((n): Node<D> => {
        const p = byId.get(n.id) ?? byId.get(aliases.current.get(n.id) ?? "");
        const position = p?.position ?? placements.current.get(n.id) ?? { x: 40, y: lowest + 120 };
        return { ...(p ?? {}), id: n.id, type, position, data: data(n), selected: n.id === selectedId };
      });
      aliases.current.clear();
      placements.current.clear();
      return next;
    });
    // `data` is rebuilt each render; graph and selection are what it depends on.
  }, [graph, selectedId, type]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<D>>[]) =>
      setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type === "position" || c.type === "dimensions"), ns)),
    [],
  );

  const relayout = useCallback(() => {
    const pos = layoutGraph(graph, layout);
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
  }, [graph, layout]);

  return {
    nodes,
    onNodesChange,
    relayout,
    noteRename: (from: string, to: string) => aliases.current.set(to, from),
    placeAt: (id: string, p: XYPosition) => placements.current.set(id, p),
  };
}
