// Copied from the Archon builder (coleam00/Archon b9624b7,
// packages/web/src/experiments/console/builder/flow/layout.ts), MIT; see ../NOTICE.
// Quay changes: card size matches the Praxis node card, and `placeNodes` seeds nodes
// without a saved position from their placed neighbours.
/**
 * Local dagre layout helper. A reimplementation of the production
 * `@/lib/dag-layout` pattern (rankdir TB, ranksep 80, nodesep 40). Pure: returns a
 * position map, mutates nothing.
 */
import dagre from "@dagrejs/dagre";
import type { XYPosition } from "../model.ts";

export const NODE_WIDTH = 230;
export const NODE_HEIGHT = 92;

/**
 * Compute top-to-bottom dagre positions for a DAG. Edges referencing unknown
 * node ids are skipped (dagre would otherwise invent phantom nodes for them).
 * Dagre does not throw on cyclic input (it breaks cycles internally), so any
 * exception here is a real bug and propagates — no silent fallback.
 */
export function layoutWithDagre(
  nodeIds: readonly string[],
  edges: readonly { source: string; target: string }[]
): Map<string, XYPosition> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 40 });

  for (const id of nodeIds) {
    g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  const known = new Set(nodeIds);
  for (const edge of edges) {
    if (known.has(edge.source) && known.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  const positions = new Map<string, XYPosition>();
  for (const id of nodeIds) {
    const pos = g.node(id) as { x: number; y: number } | undefined;
    if (pos === undefined) continue;
    // dagre positions by center; xyflow positions by top-left corner.
    positions.set(id, { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 });
  }
  return positions;
}

/**
 * A position for every node. Saved positions are kept. When any node lacks one, dagre
 * lays out the whole graph, and each unplaced node takes its dagre position shifted by
 * the mean offset between saved and dagre positions of its placed neighbours (or of
 * every placed node when it has no placed neighbour), so it lands beside the nodes it
 * connects to. With nothing saved this is a plain dagre layout. Computed positions are
 * rounded to whole numbers, as the layout file stores them.
 */
export function placeNodes(
  nodeIds: readonly string[],
  edges: readonly { source: string; target: string }[],
  saved: ReadonlyMap<string, XYPosition>
): Map<string, XYPosition> {
  const positions = new Map<string, XYPosition>();
  const unplaced = nodeIds.filter((id) => !saved.has(id));
  for (const id of nodeIds) {
    const p = saved.get(id);
    if (p) positions.set(id, p);
  }
  if (unplaced.length === 0) return positions;

  const computed = layoutWithDagre(nodeIds, edges);
  const offsetOver = (ids: Iterable<string>): XYPosition | null => {
    let dx = 0;
    let dy = 0;
    let n = 0;
    for (const id of ids) {
      const s = saved.get(id);
      const c = computed.get(id);
      if (!s || !c) continue;
      dx += s.x - c.x;
      dy += s.y - c.y;
      n++;
    }
    return n === 0 ? null : { x: dx / n, y: dy / n };
  };
  const overall = offsetOver(nodeIds) ?? { x: 0, y: 0 };
  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = neighbours.get(from);
    if (list) list.push(to);
    else neighbours.set(from, [to]);
  };
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }

  for (const id of unplaced) {
    const c = computed.get(id) ?? { x: 0, y: 0 };
    const offset = offsetOver(neighbours.get(id) ?? []) ?? overall;
    positions.set(id, { x: Math.round(c.x + offset.x), y: Math.round(c.y + offset.y) });
  }
  return positions;
}
