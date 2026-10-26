// One graph in the work area: the canvas with its palette strip, the Problems list under it,
// and the inspector beside them. The graph's content is validated by the backend's
// `praxis_validate`, never in the frontend (#220).
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { ReactFlowProvider, useReactFlow, type Viewport } from "@xyflow/react";
import { GraphCanvas } from "./GraphCanvas.tsx";
import { Inspector } from "./Inspector.tsx";
import { Palette } from "./Palette.tsx";
import { ProblemsPanel } from "./ProblemsPanel.tsx";
import { nextNodeId, type GraphEdit } from "./editor.ts";
import { NODE_HEIGHT, NODE_WIDTH } from "./flow/layout.ts";
import { issuesByNode } from "./issues.ts";
import { useValidation } from "./useValidation.ts";
import { MAX_NODES, type NodeKind, type PraxisGraph, type XYPosition } from "./model.ts";

interface GraphViewProps {
  graph: PraxisGraph;
  /** The draft's JSON, edits included, which is what gets validated. */
  content: unknown;
  positions: ReadonlyMap<string, XYPosition>;
  viewport: Viewport | undefined;
  onViewportChange: (viewport: Viewport) => void;
  /** Called once per drag, on drop, with the final position of each node dragged. */
  onMoveNodes: (moved: [string, XYPosition][]) => void;
  /** Applies an edit to the draft. */
  onEdit: (edit: GraphEdit) => void;
  /** Hands over a way to read the canvas viewport now. */
  onReady?: (getViewport: () => Viewport) => void;
  /** Called with the SDK's verdict each time the content is validated: null when it is valid. */
  onValidated?: (verdict: string | null) => void;
  problemsShown: boolean;
  onToggleProblems: () => void;
}

export const GraphView: FC<GraphViewProps> = (props) => (
  <ReactFlowProvider>
    <GraphViewInner {...props} />
  </ReactFlowProvider>
);

const NO_NODES: ReadonlySet<string> = new Set();
const noSelection = () => {};

/**
 * The Problems list alone, for a graph file the canvas can't draw (a repeated or missing node
 * id, say). The backend still reports where each issue is; there are just no cards to zoom to.
 */
export const UndrawnGraphProblems: FC<{ content: unknown; problemsShown: boolean; onToggleProblems: () => void }> = ({
  content,
  problemsShown,
  onToggleProblems,
}) => {
  const status = useValidation("graphs", content);
  return (
    <ProblemsPanel
      status={status}
      expanded={problemsShown}
      onToggle={onToggleProblems}
      nodeIds={NO_NODES}
      onSelectNode={noSelection}
    />
  );
};

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const NO_DIAGNOSTICS: never[] = [];

/**
 * How far a node added by pressing a palette button moves from a card already near that spot,
 * down and right, so each stacked card's corner shows. "Near" is closer than this on both
 * axes: the middle of the view drifts as the Problems list under it grows.
 */
const STACK_OFFSET = 24;

const GraphViewInner: FC<GraphViewProps> = ({
  graph,
  content,
  positions,
  viewport,
  onViewportChange,
  onMoveNodes,
  onEdit,
  onReady,
  onValidated,
  problemsShown,
  onToggleProblems,
}) => {
  const flow = useReactFlow();
  const canvasBox = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const status = useValidation("graphs", content);
  const verdict = status.state === "done" ? status.validation.verdict : undefined;
  useEffect(() => {
    if (verdict !== undefined) onValidated?.(verdict);
  }, [verdict, onValidated]);
  // `chosen` counts selections, so the inspector starts afresh for each node chosen but
  // keeps its place when the selected node is renamed.
  const [selection, setSelection] = useState<{ id: string | null; chosen: number }>({ id: null, chosen: 0 });
  const choose = useCallback((id: string | null) => setSelection((s) => ({ id, chosen: s.chosen + 1 })), []);

  const diagnostics = status.state === "done" ? status.validation.diagnostics : NO_DIAGNOSTICS;
  const issues = useMemo(() => issuesByNode(diagnostics), [diagnostics]);
  const nodeIds = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph]);
  const selectedNode = graph.nodes.find((n) => n.id === selection.id) ?? null;
  const selectedId = selectedNode?.id ?? null;

  const zoomTo = useCallback(
    (nodeId: string) => {
      choose(nodeId);
      void flow.fitView({ nodes: [{ id: nodeId }], maxZoom: 1.25, duration: prefersReducedMotion() ? 0 : 300 });
    },
    [flow, choose]
  );
  const clearSelection = useCallback(() => choose(null), [choose]);

  /**
   * Adds a node of `kind` centred on a point on screen, if it is on the canvas, or in the
   * middle of the view, moved off any node already there.
   */
  const addNode = (kind: NodeKind, at: XYPosition | null) => {
    const box = canvasBox.current?.getBoundingClientRect();
    if (!box) return;
    if (at && (at.x < box.left || at.x > box.right || at.y < box.top || at.y > box.bottom)) return;
    const centre = flow.screenToFlowPosition(at ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 });
    let position = { x: centre.x - NODE_WIDTH / 2, y: centre.y - NODE_HEIGHT / 2 };
    if (!at) {
      const taken = [...positions.values()];
      while (taken.some((p) => Math.abs(p.x - position.x) < STACK_OFFSET && Math.abs(p.y - position.y) < STACK_OFFSET)) {
        position = { x: position.x + STACK_OFFSET, y: position.y + STACK_OFFSET };
      }
    }
    const id = nextNodeId(graph.nodes.map((n) => n.id), kind);
    onEdit({ type: "add-node", id, kind, position });
    choose(id);
  };

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 flex flex-col">
        <div ref={canvasBox} className="flex-1 min-h-0 relative">
          <GraphCanvas
            graph={graph}
            positions={positions}
            viewport={viewport}
            onViewportChange={onViewportChange}
            issues={issues}
            selectedId={selectedId}
            onSelectNode={choose}
            onPaneClick={clearSelection}
            onEdit={onEdit}
            onMoveNodes={onMoveNodes}
            onReady={onReady}
          />
          <Palette onAdd={addNode} full={graph.nodes.length >= MAX_NODES} />
        </div>
        <ProblemsPanel
          status={status}
          expanded={problemsShown}
          onToggle={onToggleProblems}
          nodeIds={nodeIds}
          onSelectNode={zoomTo}
        />
      </div>
      <Inspector
        rootRef={inspectorRef}
        selectionKey={selection.chosen}
        graph={graph}
        node={selectedNode}
        diagnostics={diagnostics}
        onEdit={onEdit}
        onRenamed={(id) => setSelection((s) => ({ ...s, id }))}
        onDeleted={() => {
          choose(null);
          // The delete button is gone; focus stays in the builder, so its keys still work.
          inspectorRef.current?.focus();
        }}
      />
    </div>
  );
};
