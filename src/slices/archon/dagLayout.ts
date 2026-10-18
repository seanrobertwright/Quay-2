import { ArchonPlanNode } from "./types";

export interface DagSizing {
  nodeWidth: number;
  nodeHeight: number;
  horizontalGap: number;
  verticalGap: number;
  margin: number;
}

/** Card sizes for the workflow inspector. */
export const DEFAULT_DAG_SIZING: DagSizing = {
  nodeWidth: 210,
  nodeHeight: 80,
  horizontalGap: 90,
  verticalGap: 30,
  margin: 40,
};

/** Tighter cards for the run monitor, where the graph shares the screen with log and chat. */
export const COMPACT_DAG_SIZING: DagSizing = {
  nodeWidth: 172,
  nodeHeight: 62,
  horizontalGap: 44,
  verticalGap: 16,
  margin: 16,
};

export type LaidOutNode = ArchonPlanNode & { x: number; y: number; width: number; height: number };

export interface DagLayout {
  nodesWithCoords: LaidOutNode[];
  edges: { fromId: string; toId: string; path: string }[];
  width: number;
  height: number;
}

/**
 * Left-to-right layered layout: each node sits one column right of its deepest
 * dependency, and edges are cubic Bezier curves between card edges.
 */
export function computeDagLayout(
  nodes: ArchonPlanNode[],
  minHeight = 420,
  sizing: DagSizing = DEFAULT_DAG_SIZING
): DagLayout {
  const {
    nodeWidth: DAG_NODE_WIDTH,
    nodeHeight: DAG_NODE_HEIGHT,
    horizontalGap: HORIZONTAL_GAP,
    verticalGap: VERTICAL_GAP,
    margin,
  } = sizing;
  const START_X = margin;
  const START_Y = margin;

  if (nodes.length === 0) {
    return { nodesWithCoords: [], edges: [], width: 700, height: 400 };
  }

  const nodeMap = new Map<string, ArchonPlanNode>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  // Topological depth (layer index); a cycle back to a visited node counts as depth 0
  const layerMap = new Map<string, number>();
  const getDepth = (id: string, visited = new Set<string>()): number => {
    if (layerMap.has(id)) return layerMap.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);

    const n = nodeMap.get(id);
    if (!n || !n.depends_on || n.depends_on.length === 0) {
      layerMap.set(id, 0);
      return 0;
    }

    let maxParentDepth = 0;
    for (const parentId of n.depends_on) {
      maxParentDepth = Math.max(maxParentDepth, getDepth(parentId, new Set(visited)) + 1);
    }
    layerMap.set(id, maxParentDepth);
    return maxParentDepth;
  };
  nodes.forEach((n) => getDepth(n.id));

  const layers: string[][] = [];
  nodes.forEach((n) => {
    const l = layerMap.get(n.id) || 0;
    while (layers.length <= l) layers.push([]);
    layers[l].push(n.id);
  });

  const coords = new Map<string, { x: number; y: number }>();
  let maxLayerHeight = 0;
  layers.forEach((layerNodes, layerIdx) => {
    const layerHeight = layerNodes.length * DAG_NODE_HEIGHT + (layerNodes.length - 1) * VERTICAL_GAP;
    maxLayerHeight = Math.max(maxLayerHeight, layerHeight);
    layerNodes.forEach((nodeId, rowIdx) => {
      coords.set(nodeId, {
        x: START_X + layerIdx * (DAG_NODE_WIDTH + HORIZONTAL_GAP),
        y: START_Y + rowIdx * (DAG_NODE_HEIGHT + VERTICAL_GAP),
      });
    });
  });

  const nodesWithCoords = nodes.map((node) => {
    const pt = coords.get(node.id) || { x: 0, y: 0 };
    return { ...node, x: pt.x, y: pt.y, width: DAG_NODE_WIDTH, height: DAG_NODE_HEIGHT };
  });

  const edges: DagLayout["edges"] = [];
  nodes.forEach((node) => {
    const toPt = coords.get(node.id);
    if (!toPt || !node.depends_on) return;
    node.depends_on.forEach((parent) => {
      const fromPt = coords.get(parent);
      if (!fromPt) return;
      const x1 = fromPt.x + DAG_NODE_WIDTH;
      const y1 = fromPt.y + DAG_NODE_HEIGHT / 2;
      const x2 = toPt.x;
      const y2 = toPt.y + DAG_NODE_HEIGHT / 2;
      const cx = x1 + (x2 - x1) / 2;
      edges.push({ fromId: parent, toId: node.id, path: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}` });
    });
  });

  return {
    nodesWithCoords,
    edges,
    width: START_X * 2 + layers.length * (DAG_NODE_WIDTH + HORIZONTAL_GAP),
    height: Math.max(START_Y * 2 + maxLayerHeight, minHeight),
  };
}
