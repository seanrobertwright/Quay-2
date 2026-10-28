// The canvas for one Praxis graph: #226's variant A cards, laid out top to bottom, each
// with a badge counting its validation issues. Nodes can be dragged and clicked to select
// them, and dragging from one card's handle to another card connects them; Escape calls
// that drag off (#248). A single card dragged shows smart guides and snaps to them, unless
// Alt is held; several cards dragged together move rigidly, without guides. It must
// sit inside a ReactFlowProvider, which the caller supplies so a sibling (the Problems
// list) can move the viewport. For keyboard use (#264), each card is a tab stop named for
// a screen reader, with a ring while focused; edges take focus from the builder's Tab
// handling, after the cards. React Flow's own keys are off, since the builder's keymap
// handles every key.
import { useEffect, useMemo, useRef, useState, type FC } from "react";
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
  useStoreApi,
  type AriaLabelConfig,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PraxisGraph, XYPosition } from "./model.ts";
import { configSummary, nodeKindMeta, UNKNOWN_KIND_META } from "./kinds.ts";
import type { GraphEdit } from "./editor.ts";
import { EDGE_COLOR, graphToFlow, PRAXIS_NODE_TYPE, type PraxisFlowNode } from "./flow/to-flow.ts";
import { NODE_HEIGHT, NODE_WIDTH } from "./flow/layout.ts";
import type { NodeIssues } from "./issues.ts";
import { nodeAriaLabel } from "./keyboard.ts";
import { computeGuides, type Rect } from "./smart-guides.ts";
import { SmartGuides } from "./SmartGuides.tsx";

const handleClass = "!w-2.5 !h-2.5 !border-2 !border-[#0d1117]";

/** What a focused edge tells a screen reader it can do: React Flow's default offers selecting, which the builder doesn't. */
const ARIA_LABELS: Partial<AriaLabelConfig> = { "edge.a11yDescription.default": "Press Delete to remove this dependency." };

/** The ring a card shows while it has keyboard focus. */
const NODE_FOCUS_CLASS = "rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f0f6fc]";
/** A focused edge is drawn thicker and light, over the colour its own style sets. */
const EDGE_FOCUS_CLASS = "[&:focus-visible_.react-flow__edge-path]:stroke-[#f0f6fc]! [&:focus-visible_.react-flow__edge-path]:[stroke-width:3]!";

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

/** A card's size as drawn, or the layout's size before it has been measured. */
const sizeOf = (node: Pick<PraxisFlowNode, "measured"> | undefined) => ({
  width: node?.measured?.width ?? NODE_WIDTH,
  height: node?.measured?.height ?? NODE_HEIGHT,
});

const rectOf = (node: PraxisFlowNode): Rect => ({ id: node.id, ...node.position, ...sizeOf(node) });

interface Guides {
  vertical: number[];
  horizontal: number[];
}

const NO_GUIDES: Guides = { vertical: [], horizontal: [] };

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
  /** The nodes shown as selected. */
  selected: ReadonlySet<string>;
  onSelectNode: (nodeId: string) => void;
  onPaneClick: () => void;
  /** Called with the edit a new connection makes: a dependency, or a DECISION branch. */
  onEdit: (edit: GraphEdit) => void;
  /** Called once per drag, on drop, with the final position of each node dragged. */
  onMoveNodes: (moved: [string, XYPosition][]) => void;
  /** Called when a pan or zoom starts. */
  onMoveStart?: () => void;
  /** Called on a right-click on a card, with the pointer's position on screen. */
  onNodeContextMenu?: (nodeId: string, at: XYPosition) => void;
  /** Called on a right-click on empty canvas, with the pointer's position on screen. */
  onPaneContextMenu?: (at: XYPosition) => void;
  /** Hands over the canvas's own controls once it is ready. */
  onReady?: (controls: CanvasControls) => void;
}

/** What the canvas lets the builder do to it from outside. */
export interface CanvasControls {
  /** The viewport now, which a save writes to the layout file. */
  readViewport: () => Viewport;
  /** Calls off a connection being dragged. Returns false when none is. */
  cancelConnection: () => boolean;
  /** A card's size as drawn, which align and distribute work from. */
  nodeSize: (nodeId: string) => { width: number; height: number };
  /** Where a card is drawn, or undefined for a node the canvas doesn't have. */
  nodePosition: (nodeId: string) => XYPosition | undefined;
}

export const GraphCanvas: FC<GraphCanvasProps> = ({
  graph,
  positions,
  viewport,
  onViewportChange,
  issues,
  selected,
  onSelectNode,
  onPaneClick,
  onEdit,
  onMoveNodes,
  onMoveStart,
  onNodeContextMenu,
  onPaneContextMenu,
  onReady,
}) => {
  const flow = useMemo(() => graphToFlow(graph, positions), [graph, positions]);
  const withIssues = useMemo(
    () =>
      flow.nodes.map((n) => {
        const nodeIssues = issues.get(n.id);
        return { ...n, ariaLabel: nodeAriaLabel(n.data.node, nodeIssues), className: NODE_FOCUS_CLASS, data: { ...n.data, issues: nodeIssues } };
      }),
    [flow.nodes, issues]
  );
  // Out of the document's tab order, which puts edges before nodes; the builder's Tab
  // handling reaches them after the last node.
  const edges = useMemo(
    () => flow.edges.map((e) => ({ ...e, className: EDGE_FOCUS_CLASS, domAttributes: { tabIndex: -1 } })),
    [flow.edges]
  );
  // Only selected nodes get a new object, so a change of selection re-renders the cards it
  // touches rather than every card.
  const shown = useMemo(
    () => withIssues.map((n) => (selected.has(n.id) ? { ...n, selected: true } : n)),
    [withIssues, selected]
  );
  // The canvas moves nodes in its own state while a drag runs, and reports only the drop.
  // New nodes from the draft (a drop, a reload, a save) or new issues replace that state.
  const [nodes, setNodes] = useState<PraxisFlowNode[]>(shown);
  const [synced, setSynced] = useState(shown);
  if (synced !== shown) {
    setSynced(shown);
    setNodes(shown);
  }
  // The other cards' places, which a dragged card snaps to.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Smart guides (#248). Alt is read from the drag's own events and from the keyboard, so
  // pressing or letting go of it mid-drag takes effect at the next move.
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const altHeld = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      altHeld.current = e.altKey;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, []);
  /**
   * Where the one card being dragged was last put, snapped or not. React Flow's last change of
   * a drag, and the drop, carry the pointer's position; this replaces it, so what is drawn,
   * and what the draft records, is where the card was shown.
   */
  const lastPlaced = useRef<{ id: string; position: XYPosition } | null>(null);
  /** One card being dragged snaps to the guides it is near; several move as they are. */
  const snapped = (changes: NodeChange<PraxisFlowNode>[]): { changes: NodeChange<PraxisFlowNode>[]; guides: Guides } => {
    const [change] = changes;
    if (changes.length !== 1 || change.type !== "position" || !change.position) {
      lastPlaced.current = null;
      return { changes, guides: NO_GUIDES };
    }
    if (!change.dragging) {
      const placed = lastPlaced.current;
      return { changes: placed?.id === change.id ? [{ ...change, position: placed.position }] : changes, guides: NO_GUIDES };
    }
    if (altHeld.current) {
      lastPlaced.current = { id: change.id, position: change.position };
      return { changes, guides: NO_GUIDES };
    }
    const node = nodesRef.current.find((n) => n.id === change.id);
    const others = nodesRef.current.filter((n) => n.id !== change.id).map(rectOf);
    const found = computeGuides({ id: change.id, ...change.position, ...sizeOf(node) }, others);
    lastPlaced.current = { id: change.id, position: found.snap };
    const none = found.vertical.length === 0 && found.horizontal.length === 0;
    return {
      changes: [{ ...change, position: found.snap }],
      guides: none ? NO_GUIDES : { vertical: found.vertical, horizontal: found.horizontal },
    };
  };
  const onNodesChange = (changes: NodeChange<PraxisFlowNode>[]) => {
    const result = snapped(changes);
    // Keep the same object while there are no guides, so moves without them don't re-render.
    setGuides((g) => (g === NO_GUIDES && result.guides === NO_GUIDES ? g : result.guides));
    setNodes((ns) => applyNodeChanges(result.changes, ns));
  };
  const onDragStop = (dragged: PraxisFlowNode[]) => {
    setGuides(NO_GUIDES);
    const placed = lastPlaced.current;
    lastPlaced.current = null;
    onMoveNodes(dragged.map((n) => [n.id, placed?.id === n.id && dragged.length === 1 ? placed.position : n.position]));
  };
  const store = useStoreApi<PraxisFlowNode>();
  // Set only while Escape ends a connection drag, so the drop it fakes connects nothing.
  const connectionCancelled = useRef(false);
  const cancelConnection = () => {
    if (!store.getState().connection.inProgress) return false;
    // React Flow ends a connection drag on the document's mouseup, and there is no other way
    // to stop the drag from outside. The event runs its handlers, onConnect included, before
    // dispatchEvent returns.
    connectionCancelled.current = true;
    try {
      document.dispatchEvent(new MouseEvent("mouseup"));
    } finally {
      connectionCancelled.current = false;
    }
    return true;
  };
  // A DECISION's then and else handles set that branch; every other handle adds a dependency.
  const onConnect = ({ source, target, sourceHandle }: Connection) => {
    if (connectionCancelled.current) return;
    onEdit(
      sourceHandle === "then" || sourceHandle === "else"
        ? { type: "set-branch", decision: source, branch: sourceHandle, target }
        : { type: "connect", source, target }
    );
  };
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStart={(e) => {
        altHeld.current = e.altKey;
      }}
      onNodeDrag={(e) => {
        altHeld.current = e.altKey;
      }}
      onNodeDragStop={(_, __, dragged) => onDragStop(dragged)}
      onNodeContextMenu={(e, node) => {
        if (!onNodeContextMenu) return;
        e.preventDefault();
        onNodeContextMenu(node.id, { x: e.clientX, y: e.clientY });
      }}
      onPaneContextMenu={(e) => {
        if (!onPaneContextMenu) return;
        e.preventDefault();
        onPaneContextMenu({ x: e.clientX, y: e.clientY });
      }}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onConnect={onConnect}
      isValidConnection={(c) => c.source !== c.target}
      onInit={(instance) =>
        onReady?.({
          readViewport: () => instance.getViewport(),
          cancelConnection,
          nodeSize: (nodeId) => sizeOf(instance.getInternalNode(nodeId)),
          nodePosition: (nodeId) => instance.getInternalNode(nodeId)?.internals.positionAbsolute,
        })
      }
      // Selection and deletion go through the builder, so React Flow keeps neither.
      elementsSelectable={false}
      deleteKeyCode={null}
      disableKeyboardA11y
      edgesFocusable
      ariaLabelConfig={ARIA_LABELS}
      colorMode="dark"
      {...(viewport ? { defaultViewport: viewport } : { fitView: true })}
      fitViewOptions={FIRST_FIT}
      minZoom={0.2}
      onMoveStart={onMoveStart}
      onMoveEnd={(_, vp) => onViewportChange(vp)}
      onPaneClick={onPaneClick}
      aria-label={`Graph ${graph.id || "without an id"}`}
    >
      <Background gap={20} color="#21262d" />
      <SmartGuides vertical={guides.vertical} horizontal={guides.horizontal} />
      {/* Bottom right, clear of the palette strip on the left. */}
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  );
};
