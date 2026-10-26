// One graph in the work area: the canvas, and the Problems list under it. The graph's file
// content is validated by the backend's `praxis_validate`, never in the frontend (#220).
import { useCallback, useMemo, useState, type FC } from "react";
import { ReactFlowProvider, useReactFlow, type Viewport } from "@xyflow/react";
import { GraphCanvas } from "./GraphCanvas.tsx";
import { ProblemsPanel } from "./ProblemsPanel.tsx";
import { issuesByNode } from "./issues.ts";
import { useValidation } from "./useValidation.ts";
import type { PraxisGraph, XYPosition } from "./model.ts";

interface GraphViewProps {
  graph: PraxisGraph;
  /** The file's JSON as read from disk, which is what gets validated. */
  content: unknown;
  positions: ReadonlyMap<string, XYPosition>;
  viewport: Viewport | undefined;
  onViewportChange: (viewport: Viewport) => void;
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

const prefersReducedMotion =() => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const GraphViewInner: FC<GraphViewProps> = ({
  graph,
  content,
  positions,
  viewport,
  onViewportChange,
  problemsShown,
  onToggleProblems,
}) => {
  const flow = useReactFlow();
  const status = useValidation("graphs", content);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const diagnostics = status.state === "done" ? status.validation.diagnostics : null;
  const issues = useMemo(() => issuesByNode(diagnostics ?? []), [diagnostics]);
  const nodeIds = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph]);

  const selectNode = useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
      void flow.fitView({ nodes: [{ id: nodeId }], maxZoom: 1.25, duration: prefersReducedMotion() ? 0 : 300 });
    },
    [flow]
  );
  const clearSelection = useCallback(() => setSelectedId(null), []);

  return (
    <>
      <div className="flex-1 min-h-0 relative">
        <GraphCanvas
          graph={graph}
          positions={positions}
          viewport={viewport}
          onViewportChange={onViewportChange}
          issues={issues}
          selectedId={selectedId}
          onPaneClick={clearSelection}
        />
      </div>
      <ProblemsPanel
        status={status}
        expanded={problemsShown}
        onToggle={onToggleProblems}
        nodeIds={nodeIds}
        onSelectNode={selectNode}
      />
    </>
  );
};
