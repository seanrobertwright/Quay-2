// A graph run's run canvas (#571): the main graph of the revision the run runs, as the host gives
// it (graphRevision.ts), drawn read-only in the run's detail above its node table. It never draws
// the project's saved graph file. Its cards are the graph canvas's (NodeCard.tsx), at the same size
// and without the problem count, each with its node phase's chip over its top edge, its border in
// the phase's tone and its counter line at its foot, as the node table draws them (NodePhaseChip.tsx).
// A node the view has no entry for draws no chip and "no state reported"; an entry with no node in
// the graph is in the node table only; each such mismatch is also a problem line. A SUBWORKFLOW
// node is one card: child graphs are never drawn.
//
// Positions come from the project's saved layout for the graph's id, when it has one, through the
// graph canvas's rule for a partial layout (`placeNodes`, flow/layout.ts): saved positions kept and
// the rest placed near their placed neighbours. Otherwise dagre lays the graph out. A layout file
// that is there but can't be used, as `praxis_read` reports it, is ignored, and a note above the
// drawing says so and why, in the graph canvas's words (`layoutIgnoredText`, model.ts). The note is
// information, not a problem line: the revision is still drawn. Nothing is said when the project has
// no graph of that id or no layout file for it, or when `praxis_read` fails. The run canvas never
// writes a layout.
//
// It is read-only by construction: it is given no edit handlers and no draft to write to, React
// Flow drags, connects, selects and deletes nothing on it, and the one change it takes from React
// Flow is the size React Flow measured a card at. Pan, zoom and fit view work, by pointer, by its
// controls and by the builder's view keys (keymap.ts). It has no palette, no auto-arrange and no
// menu.
//
// One node is selected at a time (#572), shared with the node table: the run's detail holds it.
// A click on a card, or the builder's select key (Enter or Space) on the card with focus, selects
// its node and so opens its node panel; each card is a tab stop, as on the graph canvas. The
// selected card has a near-white ring close around its border, in no node phase's tone, and is the
// current one to a screen reader. The ring a card with focus has stands further out, so a card
// both selected and focused shows both. Every other key of the graph canvas, adding to the
// selection included, does nothing on it.
//
// A card that takes keyboard focus while not wholly in view is panned into view (#575), as on the
// graph canvas, and so is the selected card, when the selection changes and when the run canvas
// changes size, as when the node panel opens beside it and narrows it. Each is the graph canvas's
// reveal (reveal.ts): a pan at the same zoom, without animation. A read of the run that keeps the
// selection moves nothing, so a person who panned away from the selected card stays there.
import { useEffect, useId, useMemo, useRef, useState, type FC, type KeyboardEvent, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Dimensions,
  type Node,
  type NodeChange,
  type NodeDimensionChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Info, RotateCw, TriangleAlert } from "lucide-react";
import { graphToFlow, PRAXIS_NODE_TYPE, type PraxisNodeData } from "./flow/to-flow.ts";
import type { GraphRunNode } from "./graphRunDetail.ts";
import type { RevisionCache } from "./graphRevision.ts";
import { configSummary } from "./kinds.ts";
import { commandFor } from "./keymap.ts";
import { layoutIgnoredText, parseLayoutPositions, type PraxisGraph, type PraxisNode, type XYPosition } from "./model.ts";
import { moveView } from "./motion.ts";
import { NODE_FOCUS_CLASS, NodeCard } from "./NodeCard.tsx";
import { NodePhaseChip, phaseFrame } from "./NodePhaseChip.tsx";
import { cardRect, reveal, revealFocused } from "./reveal.ts";
import { RUNS_MAX_LIMIT, type Unlisted } from "./runsList.ts";
import type { DefinitionFile, FileProblem } from "./types.ts";
import { focusLost } from "./useKeptFocus.ts";

const BUTTON = "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-[11px] text-white";

/** A run canvas card's data: the graph node, and its row from the view's nodes, or null when the view has none for it. */
interface RunNodeData extends PraxisNodeData {
  run: GraphRunNode | null;
}
type RunFlowNode = Node<RunNodeData>;

/** The border of a card for a node the view has no entry for. */
const NO_STATE_FRAME = "border-dashed border-[#30363d]";

/**
 * The ring around the selected card, a shape as well as a colour: near-white, at least 3:1 against
 * the card, the run canvas and the border of every node phase's tone, and close against the card's
 * border, so the ring a card with focus has (NODE_FOCUS_CLASS), further out, stays apart from it.
 * An outline rather than Tailwind's `ring`, which is a box shadow: a Windows contrast theme drops
 * box shadows but keeps outlines.
 */
const SELECTED_RING = "outline-2 outline-[#f0f6fc]";

const RunCard: FC<NodeProps<RunFlowNode>> = ({ data, selected }) => {
  const { node, run } = data;
  const frame = run === null ? NO_STATE_FRAME : phaseFrame(run.phase);
  const footer =
    run === null ? (
      <span className="italic text-[#8b949e]">no state reported</span>
    ) : (
      <span data-counter className="text-[#8b949e]">
        {run.counter}
      </span>
    );
  return (
    <NodeCard node={node} frame={selected ? `${frame} ${SELECTED_RING}` : frame} connectable={false} footer={footer}>
      {run !== null && (
        <span className="absolute -top-3 right-2 rounded-full bg-[#161b22]">
          <NodePhaseChip phase={run.phase} />
        </span>
      )}
    </NodeCard>
  );
};

const RUN_NODE_TYPES = { [PRAXIS_NODE_TYPE]: RunCard };

/** How a card is named to a screen reader: its kind, id and settings, then its node phase and counter line. */
function runCardLabel(node: PraxisNode, run: GraphRunNode | null): string {
  const summary = configSummary(node) || "no settings";
  const state = run === null ? "no state reported" : [run.phase, run.counter].filter((s) => s !== null).join(", ");
  return `${node.kind || "No kind"} ${node.id}, ${summary}, ${state}`;
}

/**
 * The run's node of each graph node, by id, and a problem line for each mismatch between them: a
 * graph node the view has no entry for, then an entry with no graph node.
 */
function matchNodes(graph: PraxisGraph, nodes: readonly GraphRunNode[], revision: number): { runs: Map<string, GraphRunNode>; problems: string[] } {
  const runs = new Map(nodes.map((n) => [n.nodeId, n]));
  const drawn = new Set(graph.nodes.map((n) => n.id));
  const problems = [
    ...graph.nodes.filter((n) => !runs.has(n.id)).map((n) => `Node ${n.id} is in revision ${revision}'s graph, but the host reports no node phase for it.`),
    ...nodes.filter((n) => !drawn.has(n.nodeId)).map((n) => `Node ${n.nodeId} has a node phase on the host, but isn't in revision ${revision}'s graph, so only the node table shows it.`),
  ];
  return { runs, problems };
}

/** The node id of `target` when it is a card, which React Flow draws with its node's id as `data-id`; else null. */
const cardId = (target: unknown): string | null =>
  target instanceof HTMLElement && target.classList.contains("react-flow__node") ? (target.dataset.id ?? null) : null;

/** The card of node `nodeId` in `root`, the reverse of `cardId`; null when no run canvas there draws one for it. */
export const cardOf = (root: ParentNode, nodeId: string): HTMLElement | null =>
  [...root.querySelectorAll<HTMLElement>(".react-flow__node")].find((card) => cardId(card) === nodeId) ?? null;

/** Each card's size as React Flow measured it, by node id. */
type Sizes = ReadonlyMap<string, Dimensions>;

/**
 * `sizes` with each size React Flow measured in `changes`, or `sizes` itself when they hold none.
 * Every other change is dropped, React Flow's select changes included: the run canvas moves and
 * removes nothing, and its one selected node is the detail's (`selected`), not React Flow's.
 */
function withMeasures(sizes: Sizes, changes: NodeChange<RunFlowNode>[]): Sizes {
  const measured = changes.filter((c): c is NodeDimensionChange & { dimensions: Dimensions } => c.type === "dimensions" && c.dimensions !== undefined);
  if (measured.length === 0) return sizes;
  const next = new Map(sizes);
  for (const change of measured) next.set(change.id, change.dimensions);
  return next;
}

/** The first fit shows the whole graph, no larger than its cards' own size. One identity, as GraphCanvas.tsx's `FIRST_FIT` explains. */
const RUN_FIT = { maxZoom: 1 } as const;

/** The project's saved layout for a graph, as the run canvas draws with it. */
interface SavedLayout {
  /** The saved position of each node the layout places. */
  saved: ReadonlyMap<string, XYPosition>;
  /** Why the project's layout file for the graph was ignored, when it is there but can't be used; else null. */
  layoutProblem: FileProblem | null;
}

interface DrawnProps extends SavedLayout {
  graph: PraxisGraph;
  nodes: readonly GraphRunNode[];
  revision: number;
  /** The id of the heading that names the run canvas. */
  labelledBy: string;
  /** The id of the selected node, or null when none is. */
  selected: string | null;
  /** Selects node `nodeId`, when its card is chosen. */
  onSelect: (nodeId: string) => void;
  /** The drawing's element, which takes focus, and whose box a card is brought into view in. */
  drawingRef: RefObject<HTMLDivElement | null>;
}

/**
 * The drawn revision, its cards in their node phases, and its problem lines, under a note that says
 * why the project's saved layout wasn't used, when it was ignored. Inside a ReactFlowProvider.
 */
const DrawnCanvas: FC<DrawnProps> = ({ graph, saved, layoutProblem, nodes, revision, labelledBy, selected, onSelect, drawingRef }) => {
  const view = useReactFlow();
  const noteId = useId();
  const flow = useMemo(() => graphToFlow(graph, saved), [graph, saved]);
  const { runs, problems } = useMemo(() => matchNodes(graph, nodes, revision), [graph, nodes, revision]);
  // React Flow measures each card and reports its size as a change. A card keeps its size from one
  // read of the run to the next: without it React Flow would measure the card again, and drop its
  // edges until it had.
  const [sizes, setSizes] = useState<Sizes>(() => new Map());
  const cards: RunFlowNode[] = useMemo(
    () =>
      flow.nodes.map((n) => {
        const run = runs.get(n.id) ?? null;
        const measured = sizes.get(n.id);
        return { ...n, ...(measured && { measured }), ariaLabel: runCardLabel(n.data.node, run), className: NODE_FOCUS_CLASS, data: { ...n.data, run } };
      }),
    [flow.nodes, runs, sizes]
  );
  // Only the selected card gets a new object, so a change of selection re-renders the cards it
  // touches rather than every card. It is marked for a screen reader as the current one.
  const shown = useMemo(
    () => cards.map((c) => (c.id === selected ? { ...c, selected: true, domAttributes: { "aria-current": "true" as const } } : c)),
    [cards, selected]
  );
  // The selected card is brought into view when the selection changes, checked against the
  // drawing's size once the change is drawn, so the node panel opening beside it can't hide it,
  // and again when the drawing changes size, which React Flow measures. Nothing else moves it.
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    const node = selected === null ? undefined : view.getInternalNode(selected);
    if (node) reveal(drawingRef.current, view, cardRect(view, node.internals.positionAbsolute, node.measured));
  }, [view, drawingRef, selected, width, height]);
  // The builder's view keys, which the builder itself runs only on the graph canvas, and its key
  // for selecting the node whose card has focus.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focused = cardId(e.target);
    const command = commandFor(e.nativeEvent, focused === null ? "canvas" : "node");
    switch (command) {
      case "select":
        if (focused !== null) onSelect(focused);
        break;
      case "fit-view":
      case "zoom-in":
      case "zoom-out":
      case "zoom-reset":
        moveView(view, command);
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  return (
    <>
      {layoutProblem !== null && (
        // Information, not one of the problem lines: the revision is drawn, laid out automatically.
        <p id={noteId} role="note" className="flex items-start gap-1.5 text-[#8b949e]">
          <Info className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          <span className="break-words min-w-0">{layoutIgnoredText(graph.id, layoutProblem.message)}</span>
        </p>
      )}
      <div className="h-80 rounded-md border border-[#30363d] overflow-hidden">
        <ReactFlow
          ref={drawingRef}
          nodes={shown}
          edges={flow.edges}
          nodeTypes={RUN_NODE_TYPES}
          onNodesChange={(changes) => setSizes((now) => withMeasures(now, changes))}
          onNodeClick={(_, node) => onSelect(node.id)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          disableKeyboardA11y
          colorMode="dark"
          fitView
          fitViewOptions={RUN_FIT}
          minZoom={0.2}
          onKeyDown={onKeyDown}
          // A card that takes keyboard focus while not wholly in view is panned into view.
          onFocus={(e) => revealFocused(drawingRef.current, view, e.target)}
          // Focusable, so a click on the run canvas puts focus in it for its keys.
          tabIndex={-1}
          aria-labelledby={labelledBy}
          // The note is also the drawing's description, which a screen reader gives as focus enters it.
          aria-describedby={layoutProblem === null ? undefined : noteId}
        >
          <Background gap={20} color="#21262d" />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </div>
      {problems.length > 0 && (
        <ul aria-label="Run canvas problems" className="space-y-0.5 text-[#f85149]">
          {problems.map((problem, n) => (
            <li key={n} className="flex items-start gap-1.5">
              <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
              {problem}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

/** No saved layout: dagre places every node, and nothing says why. */
const NO_LAYOUT: SavedLayout = { saved: new Map(), layoutProblem: null };

/**
 * The project's saved layout for graph `graphId`, which `praxis_read` gives with the project's own
 * graph of that id: the node positions of its layout file, and why that file was ignored when it is
 * there but can't be used, as `praxis_read` reports it. No positions when the project has no such
 * graph, no layout file for it or one that can't be used, so dagre places every node. When
 * `praxis_read` fails there are no positions and no problem, so the run canvas says nothing of it.
 */
async function savedLayout(projectPath: string, graphId: string): Promise<SavedLayout> {
  if (graphId === "") return NO_LAYOUT;
  try {
    const file = await invoke<DefinitionFile>("praxis_read", { projectPath, kind: "graphs", id: graphId });
    return { saved: parseLayoutPositions(file.layout), layoutProblem: file.layoutProblem ?? null };
  } catch {
    return NO_LAYOUT;
  }
}

/** Where the run canvas's revision is: being read, not read, read but not drawn, or drawn with its saved layout. */
type CanvasState =
  | { state: "reading" }
  | { state: "failed"; problem: string }
  | { state: "undrawn"; reason: string }
  | ({ state: "drawn"; graph: PraxisGraph } & SavedLayout);

const READING: CanvasState = { state: "reading" };

/**
 * Revision `revision` of `workflow`, through `revisions`, with the saved layout of its graph, and a
 * way to read it again after a failed read, and whether that read is running. `onUnreadable` is
 * called each time a read of it ends with no drawing: it can't be read, or it is read but can't be
 * drawn. A result for another revision or an earlier try is never shown as this one's.
 */
function useRevision(
  projectPath: string,
  workflow: string,
  revision: number,
  revisions: RevisionCache,
  onUnreadable: () => void
): { state: CanvasState; retrying: boolean; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([projectPath, workflow, revision, attempt]);
  const [shown, setShown] = useState<{ key: string; state: CanvasState } | null>(null);
  const unreadable = useRef(onUnreadable);
  useEffect(() => {
    unreadable.current = onUnreadable;
  });
  useEffect(() => {
    let live = true;
    void revisions.read(projectPath, workflow, revision).then(async (read) => {
      if (!live) return;
      if (read.kind === "failed") {
        setShown({ key, state: { state: "failed", problem: read.problem } });
        unreadable.current();
      } else if (read.kind === "undrawn") {
        setShown({ key, state: { state: "undrawn", reason: read.reason } });
        unreadable.current();
      } else {
        const layout = await savedLayout(projectPath, read.graph.id);
        if (live) setShown({ key, state: { state: "drawn", graph: read.graph, ...layout } });
      }
    });
    return () => {
      live = false;
    };
  }, [revisions, projectPath, workflow, revision, key]);
  const state = shown?.key === key ? shown.state : READING;
  // A read is a retry while the last one shown, an earlier try's, failed.
  const retrying = state.state === "reading" && shown?.state.state === "failed";
  return { state, retrying, retry: () => setAttempt((n) => n + 1) };
}

/** What the status line says of the revision, or nothing once it is drawn. */
function statusLine(state: CanvasState, workflow: string, revision: number): string {
  switch (state.state) {
    case "reading":
      return `Reading revision ${revision} of ${workflow}…`;
    case "failed":
      return `Revision ${revision} of ${workflow} couldn't be read: ${state.problem}`;
    case "undrawn":
      return `Revision ${revision} of ${workflow} isn't drawn. ${state.reason} The node table lists the run's nodes.`;
    case "drawn":
      return "";
  }
}

interface RunCanvasProps {
  projectPath: string;
  /** The graph workflow the run is a run of. */
  workflow: string;
  /** The revision the run runs, from its row in the Runs list; null before the list named it. */
  revision: number | null;
  /** Why no row of the Runs list has named the run, while `revision` is null. */
  unlisted: Unlisted;
  /** The run's name, for the heading. */
  runName: string;
  /** The run's nodes, from the view's `nodes[]`. */
  nodes: readonly GraphRunNode[];
  revisions: RevisionCache;
  /**
   * Called each time a read of the revision ends with no drawing, as it can't be read, or is read
   * but can't be drawn, and once Quay can't tell which revision the run runs, so the node table
   * can open in the run canvas's place.
   */
  onUnreadable: () => void;
  /** The id of the selected node, or null when none is. */
  selected: string | null;
  /** Selects node `nodeId`, when its card is chosen. */
  onSelect: (nodeId: string) => void;
}

/**
 * The run canvas of a graph run, with a heading that names the run and its revision. Until a row of
 * the Runs list names the revision, its place says the revision is being looked up, or why Quay
 * can't tell it (#579).
 */
export const RunCanvas: FC<RunCanvasProps> = ({ revision, runName, unlisted, ...rest }) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-1.5 text-[11px] text-[#c9d1d9]">
      <h4 id={headingId} className="font-semibold">
        Run canvas: {runName}
        {revision !== null && `, revision ${revision}`}
      </h4>
      {revision === null ? (
        <UnlistedRevision unlisted={unlisted} onUnreadable={rest.onUnreadable} />
      ) : (
        <RevisionCanvas revision={revision} labelledBy={headingId} {...rest} />
      )}
    </section>
  );
};

/** What the run canvas's place says while no row of the Runs list has named the run's revision. */
function unlistedLine(unlisted: Unlisted): string {
  switch (unlisted) {
    case "reading":
      return "Looking in the Runs list for the revision this run runs…";
    case "atCap":
      return `Quay can't tell which revision this run runs, because praxis lists only the newest ${RUNS_MAX_LIMIT} runs of a graph workflow, and this run isn't among them. The run canvas isn't drawn: the node table shows the run's node phases.`;
    case "complete":
      return "The Runs list doesn't name this run, so Quay can't tell which revision it runs. The run canvas isn't drawn: the node table shows the run's node phases.";
  }
}

/**
 * The run canvas's place while no row of the Runs list has named the run's revision: why, on a
 * status line. Once Quay can't tell the revision, `onUnreadable` is called, so the node table
 * opens, and not again while the reason stays the same, so a reader who closes the table keeps it
 * closed.
 */
const UnlistedRevision: FC<{ unlisted: Unlisted; onUnreadable: () => void }> = ({ unlisted, onUnreadable }) => {
  const unreadable = useRef(onUnreadable);
  useEffect(() => {
    unreadable.current = onUnreadable;
  });
  useEffect(() => {
    if (unlisted !== "reading") unreadable.current();
  }, [unlisted]);
  return (
    <p role="status" className="text-[#8b949e] break-words">
      {unlistedLine(unlisted)}
    </p>
  );
};

const RevisionCanvas: FC<Omit<RunCanvasProps, "revision" | "runName" | "unlisted"> & { revision: number; labelledBy: string }> = ({
  projectPath,
  workflow,
  revision,
  nodes,
  revisions,
  onUnreadable,
  selected,
  onSelect,
  labelledBy,
}) => {
  const { state, retrying, retry } = useRevision(projectPath, workflow, revision, revisions, onUnreadable);
  const status = useRef<HTMLParagraphElement>(null);
  const drawing = useRef<HTMLDivElement>(null);
  // Try again stays, with focus, while its read runs, and leaves once the read ends other than in
  // a failure. Focus that fell to the page with it goes to what took its place: the drawing, or
  // the status line that says why the revision isn't drawn.
  const wasRetrying = useRef(false);
  useEffect(() => {
    const ended = wasRetrying.current && !retrying;
    wasRetrying.current = retrying;
    if (!ended || state.state === "failed" || !focusLost(document.activeElement)) return;
    (state.state === "drawn" ? drawing.current : status.current)?.focus();
  }, [retrying, state.state]);
  return (
    <>
      <p ref={status} tabIndex={-1} role="status" className={state.state === "failed" ? "text-[#f85149] break-words" : "text-[#8b949e] break-words"}>
        {statusLine(state, workflow, revision)}
      </p>
      {(state.state === "failed" || retrying) && (
        <button
          type="button"
          // Not `disabled`, which would drop focus while the revision is read again.
          aria-disabled={retrying}
          onClick={() => !retrying && retry()}
          className={`${BUTTON} aria-disabled:opacity-50`}
        >
          <RotateCw className="w-3 h-3" aria-hidden="true" />
          Try again
        </button>
      )}
      {state.state === "drawn" && (
        <ReactFlowProvider>
          <DrawnCanvas
            graph={state.graph}
            saved={state.saved}
            layoutProblem={state.layoutProblem}
            nodes={nodes}
            revision={revision}
            labelledBy={labelledBy}
            selected={selected}
            onSelect={onSelect}
            drawingRef={drawing}
          />
        </ReactFlowProvider>
      )}
    </>
  );
};
