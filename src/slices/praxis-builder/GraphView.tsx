// One graph in the work area: the canvas with its palette strip, the Problems list under it,
// and the inspector beside them. The graph's content is validated by the backend's
// `praxis_validate`, never in the frontend (#220). The builder owns the selection, so undo
// and its keys can set it, and gets a `BuilderCanvas` to run the canvas keys (#248). A
// right-click on a card opens its context menu, with the align and distribute commands, and
// one on empty canvas opens a menu with Paste, which puts the clipboard's nodes there.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC, type ReactNode, type RefObject } from "react";
import { ReactFlowProvider, useReactFlow, type Viewport } from "@xyflow/react";
import { ArrangeMenu, Menu, NODE_MENU_ACTIONS } from "./ArrangeMenu.tsx";
import type { ArrangeAction } from "./arrange.ts";
import { GraphCanvas, type CanvasControls } from "./GraphCanvas.tsx";
import { Inspector } from "./Inspector.tsx";
import { Palette } from "./Palette.tsx";
import { ProblemsPanel } from "./ProblemsPanel.tsx";
import { getClipboard, pasteFits } from "./clipboard.ts";
import { nextNodeId, type GraphEdit } from "./editor.ts";
import { NODE_HEIGHT, NODE_WIDTH } from "./flow/layout.ts";
import { issuesByNode } from "./issues.ts";
import { ariaKeyShortcuts, shortcutLabel } from "./keymap.ts";
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
  /** Runs a layout command: auto-arrange on every node, align and distribute on the selection. */
  onArrange: (action: ArrangeAction) => void;
  /** Pastes the clipboard's nodes with their top-left corner at this point on the canvas. */
  onPaste: (at: XYPosition) => void;
  /** The selected nodes, all of them in the graph. */
  selected: ReadonlySet<string>;
  /** Changes each time nodes are chosen, so the inspector starts afresh. */
  selectionKey: number;
  /** Selects these nodes. `keepInspector` keeps the inspector's place, as after a rename. */
  onSelect: (ids: readonly string[], keepInspector?: boolean) => void;
  /** Hands over the canvas, for the builder's keys, once it is ready. */
  onReady?: (canvas: BuilderCanvas) => void;
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

/** The canvas as the builder's keys see it. */
export interface BuilderCanvas extends CanvasControls {
  /** Whether a keydown's target is in the canvas region: the canvas and its palette. */
  contains: (target: Node | null) => boolean;
  /** Puts focus in the canvas region, as after deleting the focused node. */
  focus: () => void;
  fitView: () => void;
  /** Fits the view once the canvas draws the next change of positions, as after auto-arrange. */
  fitViewWhenMoved: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  /** The canvas's size on screen, or null before it is drawn. */
  getCanvasRect: () => { width: number; height: number } | null;
}

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
  onArrange,
  onPaste,
  selected,
  selectionKey,
  onSelect,
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
  const choose = useCallback((id: string | null) => onSelect(id === null ? [] : [id]), [onSelect]);
  // Effects run child first, so by this one React Flow has taken the new positions.
  const fitPending = useRef(false);
  useEffect(() => {
    if (!fitPending.current) return;
    fitPending.current = false;
    void flow.fitView({ duration: prefersReducedMotion() ? 0 : 200 });
  }, [positions, flow]);

  const diagnostics = status.state === "done" ? status.validation.diagnostics : NO_DIAGNOSTICS;
  const issues = useMemo(() => issuesByNode(diagnostics), [diagnostics]);
  const nodeIds = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph]);
  const selectedNode = selected.size === 1 ? (graph.nodes.find((n) => selected.has(n.id)) ?? null) : null;

  const canvasReady = useCallback(
    (controls: CanvasControls) => {
      const duration = () => (prefersReducedMotion() ? 0 : 200);
      onReady?.({
        ...controls,
        contains: (target) => canvasBox.current?.contains(target) ?? false,
        focus: () => canvasBox.current?.focus(),
        fitView: () => void flow.fitView({ duration: duration() }),
        fitViewWhenMoved: () => {
          fitPending.current = true;
        },
        zoomIn: () => void flow.zoomIn({ duration: duration() }),
        zoomOut: () => void flow.zoomOut({ duration: duration() }),
        zoomReset: () => void flow.zoomTo(1, { duration: duration() }),
        getCanvasRect: () => {
          const r = canvasBox.current?.getBoundingClientRect();
          return r ? { width: r.width, height: r.height } : null;
        },
      });
    },
    [flow, onReady]
  );

  const zoomTo = useCallback(
    (nodeId: string) => {
      choose(nodeId);
      void flow.fitView({ nodes: [{ id: nodeId }], maxZoom: 1.25, duration: prefersReducedMotion() ? 0 : 300 });
    },
    [flow, choose]
  );
  const clearSelection = useCallback(() => choose(null), [choose]);

  // A right-click on a card outside the selection selects that card alone, as file managers do.
  // The menu sits at a point on screen, so it closes when the cards or the view move. `at` is
  // in the canvas box; a pane menu also keeps the point on the canvas a paste goes to, and
  // why Paste is unavailable, if it is.
  const [menu, setMenu] = useState<
    { kind: "node"; at: XYPosition } | { kind: "pane"; at: XYPosition; pasteAt: XYPosition; pasteBlocked: string | null } | null
  >(null);
  const nodeCount = graph.nodes.length;
  const [menuPositions, setMenuPositions] = useState(positions);
  if (menuPositions !== positions) {
    setMenuPositions(positions);
    setMenu(null);
  }
  const openMenu = useCallback(
    (nodeId: string, at: XYPosition) => {
      const box = canvasBox.current?.getBoundingClientRect();
      if (!box) return;
      if (!selected.has(nodeId)) choose(nodeId);
      setMenu({ kind: "node", at: { x: at.x - box.left, y: at.y - box.top } });
    },
    [selected, choose]
  );
  const openPaneMenu = useCallback(
    (at: XYPosition) => {
      const box = canvasBox.current?.getBoundingClientRect();
      if (!box) return;
      const envelope = getClipboard();
      setMenu({
        kind: "pane",
        at: { x: at.x - box.left, y: at.y - box.top },
        pasteAt: flow.screenToFlowPosition(at),
        pasteBlocked: envelope === null ? "Nothing copied" : pasteFits(nodeCount, envelope) ? null : "Graph full",
      });
    },
    [flow, nodeCount]
  );
  const dismissMenu = useCallback(() => setMenu(null), []);
  const closeMenu = useCallback((refocus: boolean) => {
    setMenu(null);
    if (refocus) canvasBox.current?.focus();
  }, []);

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
        {/* Focusable, so a click on empty canvas puts focus in the canvas region for its keys. */}
        <div ref={canvasBox} tabIndex={-1} className="flex-1 min-h-0 relative outline-none">
          <GraphCanvas
            graph={graph}
            positions={positions}
            viewport={viewport}
            onViewportChange={onViewportChange}
            issues={issues}
            selected={selected}
            onSelectNode={choose}
            onPaneClick={clearSelection}
            onEdit={onEdit}
            onMoveNodes={onMoveNodes}
            onNodeContextMenu={openMenu}
            onPaneContextMenu={openPaneMenu}
            onMoveStart={dismissMenu}
            onReady={canvasReady}
          />
          <Palette onAdd={addNode} full={graph.nodes.length >= MAX_NODES} />
          {menu?.kind === "node" && (
            <PlacedMenu at={menu.at} bounds={canvasBox}>
              <ArrangeMenu
                label="Node"
                actions={NODE_MENU_ACTIONS}
                selectedCount={selected.size}
                onChoose={onArrange}
                onClose={closeMenu}
              />
            </PlacedMenu>
          )}
          {menu?.kind === "pane" && (
            <PlacedMenu at={menu.at} bounds={canvasBox}>
              <Menu
                label="Canvas"
                items={[
                  {
                    name: "Paste",
                    enabled: menu.pasteBlocked === null,
                    group: "clipboard",
                    hint: menu.pasteBlocked ?? shortcutLabel("paste"),
                    ariaKeyShortcuts: ariaKeyShortcuts("paste"),
                    onChoose: () => onPaste(menu.pasteAt),
                  },
                ]}
                onClose={closeMenu}
              />
            </PlacedMenu>
          )}
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
        selectionKey={selectionKey}
        graph={graph}
        node={selectedNode}
        selectionCount={selected.size}
        diagnostics={diagnostics}
        onEdit={onEdit}
        onRenamed={(id) => onSelect([id], true)}
        onDeleted={() => {
          choose(null);
          // The delete button is gone; focus stays in the builder, so its keys still work.
          inspectorRef.current?.focus();
        }}
      />
    </div>
  );
};

/** A context menu at a point in the canvas box, moved in to stay inside it. */
const PlacedMenu: FC<{
  at: XYPosition;
  bounds: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}> = ({ at, bounds, children }) => {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState(at);
  useLayoutEffect(() => {
    const box = bounds.current;
    const menu = wrapper.current;
    if (!box || !menu) return;
    setPlace({
      x: Math.max(0, Math.min(at.x, box.clientWidth - menu.offsetWidth)),
      y: Math.max(0, Math.min(at.y, box.clientHeight - menu.offsetHeight)),
    });
  }, [at, bounds]);
  return (
    <div ref={wrapper} className="absolute" style={{ left: place.x, top: place.y }}>
      {children}
    </div>
  );
};
