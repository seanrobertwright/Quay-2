// The builder's layout commands (#248): auto-arrange, the six aligns and the two
// distributes, as the Arrange menu and the node context menu offer them. Each turns the
// draft's positions into the positions it moves nodes to, which the builder records as one
// step; the draft rounds them to integers when it takes them.
import { align, arrangeEdges, autoArrange, distributeH, distributeV, type AlignMode, type NodeRect } from "./align.ts";
import type { PraxisGraph, XYPosition } from "./model.ts";

export type ArrangeAction =
  | { type: "auto" }
  | { type: "align"; mode: AlignMode }
  | { type: "distribute"; axis: "horizontal" | "vertical" };

/** Every action, in menu order. */
export const ARRANGE_ACTIONS: readonly ArrangeAction[] = [
  { type: "auto" },
  { type: "align", mode: "left" },
  { type: "align", mode: "centerV" },
  { type: "align", mode: "right" },
  { type: "align", mode: "top" },
  { type: "align", mode: "centerH" },
  { type: "align", mode: "bottom" },
  { type: "distribute", axis: "horizontal" },
  { type: "distribute", axis: "vertical" },
];

const ALIGN_LABELS: Record<AlignMode, string> = {
  left: "Align left",
  centerV: "Align vertical centres",
  right: "Align right",
  top: "Align top",
  centerH: "Align horizontal centres",
  bottom: "Align bottom",
};

/** The menu item's name, which is also the undo step's label. */
export function arrangeLabel(action: ArrangeAction): string {
  switch (action.type) {
    case "auto":
      return "Auto-arrange";
    case "align":
      return ALIGN_LABELS[action.mode];
    case "distribute":
      return action.axis === "horizontal" ? "Distribute horizontally" : "Distribute vertically";
  }
}

/** Whether the action applies with `selectedCount` nodes selected: align needs 2, distribute 3. */
export function canArrange(action: ArrangeAction, selectedCount: number): boolean {
  switch (action.type) {
    case "auto":
      return true;
    case "align":
      return selectedCount >= 2;
    case "distribute":
      return selectedCount >= 3;
  }
}

/**
 * Where the action moves nodes, in graph node order: every node for auto-arrange, the
 * selected nodes otherwise. Empty when too few selected nodes have a position.
 */
export function arrangedPositions(
  action: ArrangeAction,
  graph: PraxisGraph,
  positions: ReadonlyMap<string, XYPosition>,
  selected: ReadonlySet<string>,
  sizeOf: (id: string) => { width: number; height: number }
): [string, XYPosition][] {
  const ids = graph.nodes.map((n) => n.id);
  if (action.type === "auto") {
    const laid = autoArrange(ids, arrangeEdges(graph));
    return ids.flatMap((id) => {
      const p = laid.get(id);
      return p ? [[id, p] as [string, XYPosition]] : [];
    });
  }
  const rects: NodeRect[] = ids.flatMap((id) => {
    const position = positions.get(id);
    return selected.has(id) && position ? [{ id, position, ...sizeOf(id) }] : [];
  });
  if (!canArrange(action, rects.length)) return [];
  const moved =
    action.type === "align" ? align(action.mode, rects) : (action.axis === "horizontal" ? distributeH : distributeV)(rects);
  return rects.map((r) => [r.id, moved.get(r.id) ?? r.position]);
}
