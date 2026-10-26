// The canvas for one Praxis graph: #226's variant A cards, laid out top to bottom. Nodes
// can be dragged; everything else about the graph is read-only for now.
import { useMemo, useState, type FC } from "react";
import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { configSummary, type PraxisGraph, type XYPosition } from "./model.ts";
import { nodeKindMeta, UNKNOWN_KIND_META } from "./kinds.ts";
import { EDGE_COLOR, graphToFlow, PRAXIS_NODE_TYPE, type PraxisFlowNode } from "./flow/to-flow.ts";
import { NODE_WIDTH } from "./flow/layout.ts";

const handleClass = "!w-2.5 !h-2.5 !border-2 !border-[#0d1117] !cursor-default";

const PraxisCard: FC<NodeProps<PraxisFlowNode>> = ({ data }) => {
  const { node } = data;
  const meta = nodeKindMeta(node.kind);
  const summary = configSummary(node);
  const label = meta === UNKNOWN_KIND_META ? node.kind || "No kind" : meta.label;
  return (
    <div
      className="relative rounded-lg border border-[#30363d] bg-[#161b22] shadow-md"
      style={{ width: NODE_WIDTH, borderTop: `3px solid ${meta.color}` }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className={handleClass} style={{ background: EDGE_COLOR.plain }} />
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
          <Handle id="then" type="source" position={Position.Bottom} isConnectable={false} className={handleClass} style={{ left: "30%", background: EDGE_COLOR.then }} />
          <Handle id="else" type="source" position={Position.Bottom} isConnectable={false} className={handleClass} style={{ left: "70%", background: EDGE_COLOR.else }} />
          <Handle id="dep" type="source" position={Position.Right} isConnectable={false} className={handleClass} style={{ background: EDGE_COLOR.plain }} />
          <span className="absolute -bottom-4 text-[9px] font-semibold text-[#3fb950]" style={{ left: "30%", transform: "translateX(-50%)" }}>
            then
          </span>
          <span className="absolute -bottom-4 text-[9px] font-semibold text-[#ff7b72]" style={{ left: "70%", transform: "translateX(-50%)" }}>
            else
          </span>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} isConnectable={false} className={handleClass} style={{ background: EDGE_COLOR.plain }} />
      )}
    </div>
  );
};

const nodeTypes = { [PRAXIS_NODE_TYPE]: PraxisCard };

interface GraphCanvasProps {
  graph: PraxisGraph;
  /** Node positions from the draft; nodes missing one are placed by dagre. */
  positions: ReadonlyMap<string, XYPosition>;
  /** The viewport this graph was last shown at, if it has been shown this session. */
  viewport: Viewport | undefined;
  onViewportChange: (viewport: Viewport) => void;
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
  onMoveNodes,
  onReady,
}) => {
  const flow = useMemo(() => graphToFlow(graph, positions), [graph, positions]);
  // The canvas moves nodes in its own state while a drag runs, and reports only the drop.
  // A new layout from the draft (a drop, a reload, a save) replaces that state.
  const [nodes, setNodes] = useState(flow.nodes);
  const [shownFlow, setShownFlow] = useState(flow);
  if (shownFlow !== flow) {
    setShownFlow(flow);
    setNodes(flow.nodes);
  }
  const onNodesChange = (changes: NodeChange<PraxisFlowNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns));
  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, __, dragged) => onMoveNodes(dragged.map((n) => [n.id, n.position]))}
        onInit={(instance) => onReady?.(() => instance.getViewport())}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        colorMode="dark"
        {...(viewport ? { defaultViewport: viewport } : { fitView: true })}
        // The first fit stops at 60% so a deep graph's cards stay readable (#226).
        fitViewOptions={{ minZoom: 0.6, maxZoom: 1 }}
        minZoom={0.2}
        onMoveEnd={(_, vp) => onViewportChange(vp)}
        aria-label={`Graph ${graph.id || "without an id"}`}
      >
        <Background gap={20} color="#21262d" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  );
};
