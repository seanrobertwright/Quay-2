// One graph in the work area: the canvas with its palette strip, the Problems list under it,
// and the inspector beside them. The graph's content is validated by the backend's
// `praxis_validate`, never in the frontend (#220). The builder owns the selection, so undo
// and its keys can set it, and gets a `BuilderCanvas` to run the canvas keys (#248). A
// right-click on a card, or Shift+F10 on a focused one, opens its context menu, with the align
// and distribute commands, and one on empty canvas opens a menu with Paste, which puts the
// clipboard's nodes there. Pressing a palette button with one node selected adds the new
// node below it, depending on it (#248). With a graph binding chosen (#273), the binding is
// validated against the graph draft, its attach checks' warnings under the graph's contracts
// are added (#274), its problems join the graph's, its marks show on the cards, and the
// inspector edits it.
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
import { issuesByNode, withBindingIssues } from "./issues.ts";
import { withAttachIssues } from "./bindingChecks.ts";
import { bindingMarks } from "./graphBinding.ts";
import type { ShownBinding } from "./RunsAsForm.tsx";
import { positionBelow } from "./keyboard.ts";
import { ariaKeyShortcuts, shortcutLabel } from "./keymap.ts";
import { useValidation } from "./useValidation.ts";
import { isObject, MAX_NODES, type NodeKind, type PraxisGraph, type XYPosition } from "./model.ts";

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
  /** The graph's Run context panel, shown beside the Problems list (#223). */
  runContext?: ReactNode;
  /** The graph binding chosen in the Binding picker, without its issues, which this view finds; null for None. */
  binding?: Omit<ShownBinding, "diagnostics"> | null;
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

/** A node or an edge on the canvas. An edge is named by the nodes it joins. */
export type CanvasItem = { type: "node"; id: string } | { type: "edge"; source: string; target: string };

/** The canvas as the builder's keys see it. */
export interface BuilderCanvas extends CanvasControls {
  /** Whether a keydown's target is in the canvas region: the canvas and its palette. */
  contains: (target: Node | null) => boolean;
  /** Whether a keydown's target is a node's card. */
  isNode: (target: Node | null) => boolean;
  /** The node or edge a keydown's target is, or null. */
  itemAt: (target: EventTarget | null) => CanvasItem | null;
  /** Selects a node, zooms to it and gives it focus, as Go to node does. */
  goToNode: (nodeId: string) => void;
  /** Opens a node's context menu beside its card, for Shift+F10 and the Menu key. */
  openNodeMenu: (nodeId: string) => void;
  /** The last card in the tab order, and the edges (SVG groups), which follow it there. */
  tabOrder: () => { lastNode: HTMLElement | null; edges: SVGElement[] };
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

const nodeSelector = (id: string) => `.react-flow__node[data-id="${CSS.escape(id)}"]`;

/** The canvas item an element is, or is inside. */
function itemOf(el: Element | null): CanvasItem | null {
  const item = el?.closest(".react-flow__node, .react-flow__edge");
  const id = item?.getAttribute("data-id");
  if (!item || id == null) return null;
  if (item.classList.contains("react-flow__node")) return { type: "node", id };
  // Edge ids are JSON `[source, target, tag]` (see `edgeId`).
  try {
    const [source, target] = JSON.parse(id) as unknown[];
    return typeof source === "string" && typeof target === "string" ? { type: "edge", source, target } : null;
  } catch {
    return null;
  }
}

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
  runContext,
  binding = null,
}) => {
  const flow = useReactFlow();
  const canvasBox = useRef<HTMLDivElement | null>(null);
  /** Pans, at the same zoom, to centre a rectangle on screen that isn't wholly in the canvas. */
  const reveal = useCallback(
    (r: { left: number; top: number; width: number; height: number }) => {
      const box = canvasBox.current?.getBoundingClientRect();
      if (!box) return;
      if (r.left >= box.left && r.top >= box.top && r.left + r.width <= box.right && r.top + r.height <= box.bottom) return;
      const vp = flow.getViewport();
      void flow.setViewport({
        x: vp.x + box.left + box.width / 2 - (r.left + r.width / 2),
        y: vp.y + box.top + box.height / 2 - (r.top + r.height / 2),
        zoom: vp.zoom,
      });
    },
    [flow]
  );
  /**
   * Focuses a node's card once the canvas draws it: a node just added has no card until React
   * Flow renders it, which can be a frame or two after the edit. The focus doesn't scroll:
   * that would scroll React Flow's wrapper, which pans, not scrolls, the canvas.
   */
  const focusNode = useCallback((nodeId: string) => {
    let frames = 0;
    const attempt = () => {
      const card = canvasBox.current?.querySelector<HTMLElement>(nodeSelector(nodeId));
      if (card) card.focus({ preventScroll: true });
      else if (++frames < 10) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, []);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const graphStatus = useValidation("graphs", content);
  const verdict = graphStatus.state === "done" ? graphStatus.validation.verdict : undefined;
  const bindingCheck = useValidation("graph-bindings", binding?.content ?? null, content);
  const bindingStatus = binding ? withAttachIssues(bindingCheck, binding.attach) : null;
  const status = useMemo(
    () => withBindingIssues(graphStatus, binding?.id ?? "", bindingStatus),
    [graphStatus, binding?.id, bindingStatus]
  );
  const shownBinding: ShownBinding | null = useMemo(
    () =>
      binding && {
        ...binding,
        diagnostics: bindingStatus?.state === "done" ? bindingStatus.validation.diagnostics : NO_DIAGNOSTICS,
      },
    [binding, bindingStatus]
  );
  const marks = useMemo(
    () => (binding && isObject(content) ? bindingMarks(binding.content, content) : undefined),
    [binding, content]
  );
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
  // The inspector's node sections show the graph's issues; Runs as shows the binding's.
  const graphDiagnostics = graphStatus.state === "done" ? graphStatus.validation.diagnostics : NO_DIAGNOSTICS;
  const nodeIds = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph]);
  const selectedNode = selected.size === 1 ? (graph.nodes.find((n) => selected.has(n.id)) ?? null) : null;

  const canvasReady = useCallback(
    (controls: CanvasControls) => {
      const duration = () => (prefersReducedMotion() ? 0 : 200);
      onReady?.({
        ...controls,
        contains: (target) => canvasBox.current?.contains(target) ?? false,
        isNode: (target) =>
          target instanceof Element && target.classList.contains("react-flow__node") && (canvasBox.current?.contains(target) ?? false),
        itemAt: (target) => (target instanceof Element && canvasBox.current?.contains(target) ? itemOf(target) : null),
        goToNode: (nodeId) => latest.current.goToNode(nodeId),
        openNodeMenu: (nodeId) => latest.current.openNodeMenu(nodeId),
        tabOrder: () => {
          const box = canvasBox.current;
          const cards = box ? [...box.querySelectorAll<HTMLElement>(".react-flow__node")] : [];
          const edges = box ? [...box.querySelectorAll<SVGElement>(".react-flow__edge")] : [];
          return { lastNode: cards[cards.length - 1] ?? null, edges };
        },
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
  const goToNode = useCallback(
    (nodeId: string) => {
      zoomTo(nodeId);
      focusNode(nodeId);
    },
    [zoomTo, focusNode]
  );
  const clearSelection = useCallback(() => choose(null), [choose]);

  // A right-click on a card outside the selection selects that card alone, as file managers do.
  // The menu sits at a point on screen, so it closes when the cards or the view move. `at` is
  // in the canvas box; a pane menu also keeps the point on the canvas a paste goes to, and
  // why Paste is unavailable, if it is.
  // A menu opened from the keyboard gives focus back to its node's card when it closes.
  const [menu, setMenu] = useState<
    | { kind: "node"; at: XYPosition; returnTo?: string }
    | { kind: "pane"; at: XYPosition; pasteAt: XYPosition; pasteBlocked: string | null }
    | null
  >(null);
  const nodeCount = graph.nodes.length;
  const [menuPositions, setMenuPositions] = useState(positions);
  if (menuPositions !== positions) {
    setMenuPositions(positions);
    setMenu(null);
  }
  const openMenu = useCallback(
    (nodeId: string, at: XYPosition, returnTo?: string) => {
      const box = canvasBox.current?.getBoundingClientRect();
      if (!box) return;
      // The Menu key can fire a contextmenu event after the keydown has opened the menu; that
      // second opening would move it and lose the card to give focus back to.
      if (returnTo === undefined && menu?.kind === "node" && menu.returnTo === nodeId) return;
      if (!selected.has(nodeId)) choose(nodeId);
      setMenu({ kind: "node", at: { x: at.x - box.left, y: at.y - box.top }, returnTo });
    },
    [selected, choose, menu]
  );
  /** Opens a node's menu at its card's lower left corner, as Shift+F10 does. */
  const openNodeMenu = (nodeId: string) => {
    const card = canvasBox.current?.querySelector<HTMLElement>(nodeSelector(nodeId));
    if (!card) return;
    const r = card.getBoundingClientRect();
    openMenu(nodeId, { x: r.left, y: r.bottom }, nodeId);
  };
  // The canvas handed to the builder is made once, so its calls go through this.
  const latest = useRef({ goToNode, openNodeMenu });
  latest.current = { goToNode, openNodeMenu };
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
  const returnTo = menu?.kind === "node" ? menu.returnTo : undefined;
  const closeMenu = useCallback(
    (refocus: boolean) => {
      setMenu(null);
      if (!refocus) return;
      const card = returnTo === undefined ? null : canvasBox.current?.querySelector<HTMLElement>(nodeSelector(returnTo));
      (card ?? canvasBox.current)?.focus({ preventScroll: true });
    },
    [returnTo]
  );

  /**
   * Adds a node of `kind` centred on a point on screen, if it is on the canvas. A press, with
   * no point, adds it below the one selected node, depending on it, or else in the middle of
   * the view; either way it moves off any node already there. A drop never connects the node.
   * The new node is selected and takes focus.
   */
  const addNode = (kind: NodeKind, at: XYPosition | null) => {
    const box = canvasBox.current?.getBoundingClientRect();
    if (!box) return;
    if (at && (at.x < box.left || at.x > box.right || at.y < box.top || at.y > box.bottom)) return;
    const boxOf = (nodeId: string) => {
      const n = flow.getInternalNode(nodeId);
      return n && { ...n.internals.positionAbsolute, width: n.measured.width ?? NODE_WIDTH, height: n.measured.height ?? NODE_HEIGHT };
    };
    const above = at ? undefined : selectedNode?.id;
    const aboveBox = above === undefined ? undefined : boxOf(above);
    let position: XYPosition;
    if (aboveBox) {
      const taken = graph.nodes.flatMap((n) => boxOf(n.id) ?? []);
      position = positionBelow(aboveBox, taken, { width: NODE_WIDTH, height: NODE_HEIGHT });
    } else {
      const centre = flow.screenToFlowPosition(at ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 });
      position = { x: centre.x - NODE_WIDTH / 2, y: centre.y - NODE_HEIGHT / 2 };
    }
    if (!at) {
      const taken = [...positions.values()];
      while (taken.some((p) => Math.abs(p.x - position.x) < STACK_OFFSET && Math.abs(p.y - position.y) < STACK_OFFSET)) {
        position = { x: position.x + STACK_OFFSET, y: position.y + STACK_OFFSET };
      }
    }
    const id = nextNodeId(graph.nodes.map((n) => n.id), kind);
    onEdit({ type: "add-node", id, kind, position, after: aboveBox ? above : undefined });
    choose(id);
    focusNode(id);
    // Below a node off screen, or after a click, which doesn't show focus, the new card may
    // be out of view.
    const { zoom } = flow.getViewport();
    const corner = flow.flowToScreenPosition(position);
    reveal({ left: corner.x, top: corner.y, width: NODE_WIDTH * zoom, height: NODE_HEIGHT * zoom });
  };

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Focusable, so a click on empty canvas puts focus in the canvas region for its keys.
            A card or edge that takes keyboard focus off screen is panned into view. */}
        <div
          ref={canvasBox}
          tabIndex={-1}
          className="flex-1 min-h-0 relative outline-none"
          onFocus={(e) => {
            if (e.target.matches(".react-flow__node:focus-visible, .react-flow__edge:focus-visible")) {
              reveal(e.target.getBoundingClientRect());
            }
          }}
        >
          <GraphCanvas
            graph={graph}
            positions={positions}
            viewport={viewport}
            onViewportChange={onViewportChange}
            issues={issues}
            bindingMarks={marks}
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
          beside={runContext}
        />
      </div>
      <Inspector
        rootRef={inspectorRef}
        selectionKey={selectionKey}
        graph={graph}
        node={selectedNode}
        selectionCount={selected.size}
        diagnostics={graphDiagnostics}
        onEdit={onEdit}
        onRenamed={(id) => onSelect([id], true)}
        onGoToNode={goToNode}
        binding={shownBinding}
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
