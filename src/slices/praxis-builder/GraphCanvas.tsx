// The canvas for one Praxis graph: #226's variant A cards, laid out top to bottom, each
// with a badge counting its validation issues. Nodes can be dragged and clicked to select
// them, and dragging from one card's handle to another card connects them. It must
// sit inside a ReactFlowProvider, which the caller supplies so a sibling (the Problems
// list) can move the viewport.
import { useMemo, useState, type FC } from "react";
import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PraxisGraph, XYPosition } from "./model.ts";
import { configSummary, nodeKindMeta, UNKNOWN_KIND_META } from "./kinds.ts";
import type { GraphEdit } from "./editor.ts";
import { EDGE_COLOR, graphToFlow, PRAXIS_NODE_TYPE, type PraxisFlowNode } from "./flow/to-flow.ts";
import { NODE_WIDTH } from "./flow/layout.ts";
import type { NodeIssues } from "./issues.ts";

const handleClass = "!w-2.5 !h-2.5 !border-2 !border-[#0d1117]";

const IssueBadge: FC<{ issues: NodeIssues }> = ({ issues }) => (
  <span
    className={`absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-[#0d1117] ${
      issues.severity === "error" ? "bg-[#da3633]" : "bg-[#1f6feb]"
    }`}
  >
    {issues.count}
    <span className="sr-only">
      {issues.count === 1 ? " problem" : " problems"}
    </span>
  </span>
);

const PraxisCard: FC<NodeProps<PraxisFlowNode>> = ({ data, selected }) => {
  const { node, issues } = data;
  const meta = nodeKindMeta(node.kind);
  const summary = configSummary(node);
  const label = meta === UNKNOWN_KIND_META ? node.kind || "No kind" : meta.label;
  return (
    <div
      className={`relative rounded-lg border bg-[#161b22] shadow-md ${
        selected ? "border-[#58a6ff] ring-2 ring-[#58a6ff]/60" : "border-[#30363d]"
      }`}
      style={{ width: NODE_WIDTH, borderTop: `3px solid ${meta.color}` }}
    >
      {issues && <IssueBadge issues={issues} />}
      <Handle type="target" position={Position.Top} className={handleClass} style={{ background: EDGE_COLOR.plain }} />
      <div
        className="flex items-center gap-1.5 px-2.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: meta.color }}
      >
        <meta.icon className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <span className="ml-auto flex gap-1 normal-case tracking-normal font-normal">
          {node.inputSchema && (
            <span className="px-1 rounded bg-[#21262d] text-[#8b949e]" title="Has an input schema">
              in
            </span>
          )}
          {node.outputSchema && (
            <span className="px-1 rounded bg-[#21262d] text-[#8b949e]" title="Has an output schema">
              out
            </span>
          )}
        </span>
      </div>
      <div className="px-2.5 pb-3 pt-0.5">
        <div className="font-mono text-sm text-white truncate" title={node.id}>
          {node.id}
        </div>
        <div className={`text-[11px] truncate ${summary ? "text-[#8b949e]" : "text-[#484f58] italic"}`}>
          {summary || "no settings"}
        </div>
      </div>
      {node.kind === "DECISION" ? (
        <>
          <Handle id="then" type="source" position={Position.Bottom} className={`${handleClass} !cursor-crosshair`} style={{ left: "30%", background: EDGE_COLOR.then }} />
          <Handle id="else" type="source" position={Position.Bottom} className={`${handleClass} !cursor-crosshair`} style={{ left: "70%", background: EDGE_COLOR.else }} />
          <Handle id="dep" type="source" position={Position.Right} className={`${handleClass} !cursor-crosshair`} style={{ background: EDGE_COLOR.plain }} />
          <span className="absolute -bottom-4 text-[9px] font-semibold text-[#3fb950]" style={{ left: "30%", transform: "translateX(-50%)" }}>
            then
          </span>
          <span className="absolute -bottom-4 text-[9px] font-semibold text-[#ff7b72]" style={{ left: "70%", transform: "translateX(-50%)" }}>
            else
          </span>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className={`${handleClass} !cursor-crosshair`} style={{ background: EDGE_COLOR.plain }} />
      )}
    </div>
  );
};

const nodeTypes = { [PRAXIS_NODE_TYPE]: PraxisCard };

/**
 * The first fit stops at 60% so a deep graph's cards stay readable (#226). It must keep one
 * identity: React Flow copies a changed `fitViewOptions` prop over the options of a pending
 * `fitView()` call, so a fresh object on each render turns "zoom to this node" into "fit all".
 */
const FIRST_FIT = { minZoom: 0.6, maxZoom: 1 } as const;

interface GraphCanvasProps {
  graph: PraxisGraph;
  /** Node positions from the draft; nodes missing one are placed by dagre. */
  positions: ReadonlyMap<string, XYPosition>;
  /** The viewport this graph was last shown at, if it has been shown this session. */
  viewport: Viewport | undefined;
  onViewportChange: (viewport: Viewport) => void;
  /** Each node's validation issues, keyed by node id. */
  issues: ReadonlyMap<string, NodeIssues>;
  /** The node shown as selected, if any. */
  selectedId: string | null;
  onSelectNode: (nodeId: string) => void;
  onPaneClick: () => void;
  /** Called with the edit a new connection makes: a dependency, or a DECISION branch. */
  onEdit: (edit: GraphEdit) => void;
  /** Called once per drag, on drop, with the final position of each node dragged. */
  onMoveNodes: (moved: [string, XYPosition][]) => void;
  /** Hands over a way to read the viewport now, which a save writes to the layout file. */
  onReady?: (getViewport: () => Viewport) => void;
}

export const GraphCanvas: FC<GraphCanvasProps> = ({
  graph,
  positions,
  viewport,
  onViewportChange,
  issues,
  selectedId,
  onSelectNode,
  onPaneClick,
  onEdit,
  onMoveNodes,
  onReady,
}) => {
  const flow = useMemo(() => graphToFlow(graph, positions), [graph, positions]);
  const withIssues = useMemo(
    () => flow.nodes.map((n) => ({ ...n, data: { ...n.data, issues: issues.get(n.id) } })),
    [flow.nodes, issues]
  );
  // Only the selected node gets a new object, so a change of selection re-renders the two
  // cards it touches rather than every card.
  const shown = useMemo(
    () => withIssues.map((n) => (n.id === selectedId ? { ...n, selected: true } : n)),
    [withIssues, selectedId]
  );
  // The canvas moves nodes in its own state while a drag runs, and reports only the drop.
  // New nodes from the draft (a drop, a reload, a save) or new issues replace that state.
  const [nodes, setNodes] = useState<PraxisFlowNode[]>(shown);
  const [synced, setSynced] = useState(shown);
  if (synced !== shown) {
    setSynced(shown);
    setNodes(shown);
  }
  const onNodesChange = (changes: NodeChange<PraxisFlowNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns));
  // A DECISION's then and else handles set that branch; every other handle adds a dependency.
  const onConnect = ({ source, target, sourceHandle }: Connection) =>
    onEdit(
      sourceHandle === "then" || sourceHandle === "else"
        ? { type: "set-branch", decision: source, branch: sourceHandle, target }
        : { type: "connect", source, target }
    );
  return (
    <ReactFlow
      nodes={nodes}
      edges={flow.edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_, __, dragged) => onMoveNodes(dragged.map((n) => [n.id, n.position]))}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onConnect={onConnect}
      isValidConnection={(c) => c.source !== c.target}
      onInit={(instance) => onReady?.(() => instance.getViewport())}
      // Selection and deletion go through the builder, so React Flow keeps neither.
      elementsSelectable={false}
      deleteKeyCode={null}
      edgesFocusable={false}
      colorMode="dark"
      {...(viewport ? { defaultViewport: viewport } : { fitView: true })}
      fitViewOptions={FIRST_FIT}
      minZoom={0.2}
      onMoveEnd={(_, vp) => onViewportChange(vp)}
      onPaneClick={onPaneClick}
      aria-label={`Graph ${graph.id || "without an id"}`}
    >
      <Background gap={20} color="#21262d" />
      {/* Bottom right, clear of the palette strip on the left. */}
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
};
