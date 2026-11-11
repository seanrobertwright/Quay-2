// A graph run's detail (#444, #465, #568, #569, #570, #571, #572): its run-level facts (status,
// control chip, held, awaiting approval, revision, and created and updated times), then its run
// canvas (#571), which draws the revision the run runs with each node in its node phase, and its
// node table (#569), followed while it is on screen on the template run detail's delays and stop
// rules but with a narrower person-wait (#570): a run waiting for a person is read every 15 s only
// while none of its nodes is active (graphRunDetail.ts), and on the backoff otherwise. Its one
// `praxis status` read per poll feeds them all, and the node panel; the run canvas reads its
// revision and the saved layout besides. The revision and the times are the run's row's in the
// Runs list, which its Runs view keeps (#579): once newer runs push the row off the list, they
// stay as its last row gave them, and the run canvas stays drawn. While no row has named the run,
// the run canvas's place says why. While the host can't be used, the facts, the run canvas, the
// node panel and the table dim. When the revision can't be read, or is read but can't be drawn,
// or Quay can't tell which revision the run runs, the node table opens by itself.
//
// It holds the one selected node (#572), which the run canvas and the node table share: choosing
// a card or a row selects that node in both and opens its node panel beside the run canvas, or
// beside its place when no revision is drawn. A node held, or blocked, by a hold links to that
// hold's panel when it has one: the host gives a hold card, and so a panel, only for a hold on a
// node's own scope, so a hold on a grant, a branch or the run gets no link. The node panel's close
// button, or Escape on the run canvas, in the node table or in the node panel, clears the selection
// (#577), and the builder stays open; focus in the panel goes to the node's card, or else its row.
//
// It shares the template run detail's waiting banner, hold panel, certificate hint and page
// actions, with one hold panel per `aiws-graph-hold-card/1`. Decisions on a run (approve, pause,
// cancel, resolving a hold) are made only in the host's browser page, so it has no control for
// any of them, not even a disabled one.
import { useCallback, useId, useRef, useState, type FC, type KeyboardEvent } from "react";
import { Hourglass } from "lucide-react";
import { formatDateTime } from "../../lib/dates.ts";
import { REVISION_CACHE, type RevisionCache } from "./graphRevision.ts";
import type { GraphHold, GraphRunNode } from "./graphRunDetail.ts";
import { commandFor } from "./keymap.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { NodePanel, type HoldPanelLink } from "./NodePanel.tsx";
import { NodeTable, nodesToggleOf, rowOf } from "./NodeTable.tsx";
import { cardOf, RunCanvas } from "./RunCanvas.tsx";
import { AMBER, CloseButton, ControlChip, FollowStatus, HeldBadge, HoldPanel, holdPanelName, useRunPageActions, WaitingBanner } from "./RunDetail.tsx";
import type { RunPageLookup, RunRow, Unlisted } from "./runsList.ts";
import { useRunDetail } from "./useRunDetail.ts";

interface GraphRunDetailProps {
  projectPath: string;
  /** The graph workflow the run is a run of. */
  workflow: string;
  workOrderId: string;
  /**
   * The run's row in the Runs list, the last that named it once newer runs push it off the list;
   * null before a row named it: the revision, the times, and the fallback for what `status`
   * doesn't give.
   */
  row: RunRow | null;
  /** Why no row of the Runs list has named the run; read only while `row` is null. */
  unlisted: Unlisted;
  /** True while the Runs view is on screen. */
  shown: boolean;
  /** Looks up the run's page when neither `status` nor the row gave it. */
  runPage: (workOrderId: string) => Promise<RunPageLookup>;
  runInTerminal?: RunInTerminal;
  /** Where the run canvas reads its revision; the builder's own cache when absent. */
  revisions?: RevisionCache;
  onClose: () => void;
}

/** A time as the host wrote it, in local words when it can be read. */
const timeText = (ms: number | null, text: string | null) => (ms !== null ? formatDateTime(ms) : (text ?? "Not given"));

/**
 * What the node panel of node `nodeId` draws: its row of the run's `nodes`, or null when the host
 * reports none for it, and a link to the panel of the hold it has among the run's `holds`, whose
 * element id `holdPanelId` gives by its place there; null when it has no hold, or no panel does.
 */
function nodePanelOf(
  nodes: readonly GraphRunNode[],
  holds: readonly GraphHold[],
  nodeId: string,
  holdPanelId: (n: number) => string
): { node: GraphRunNode | null; hold: HoldPanelLink | null } {
  const node = nodes.find((n) => n.nodeId === nodeId) ?? null;
  const at = node?.holdId ? holds.findIndex((h) => h.holdId === node.holdId) : -1;
  return { node, hold: at < 0 ? null : { id: holdPanelId(at), name: holdPanelName(holds[at]) } };
}

export const GraphRunDetail: FC<GraphRunDetailProps> = ({
  projectPath,
  workflow,
  workOrderId,
  row,
  unlisted,
  shown,
  runPage,
  runInTerminal,
  revisions = REVISION_CACHE,
  onClose,
}) => {
  const view = useRunDetail(projectPath, workOrderId, row, shown, "graph");
  const run = view.run;
  const revision = run?.revision ?? null;
  const { name, notice, openButton, trust } = useRunPageActions({ projectPath, workOrderId, run, row, runPage, runInTerminal });
  const [nodesOpen, setNodesOpen] = useState(false);
  const openNodes = useCallback(() => setNodesOpen(true), []);
  // The id of the node selected on the run canvas or in the node table, whose node panel is open.
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  /**
   * Closes the node panel, clearing the selection, and moves focus, which would fall to the page with
   * the panel, to the node's card, or else its row, or else the Nodes toggle that shows its row.
   */
  const closePanel = () => {
    const root = detail.current;
    if (selected !== null && root !== null) {
      const card = cardOf(root, selected);
      // A card takes focus without a scroll, which would scroll React Flow's wrapper: the run canvas
      // pans a card that takes focus from the keyboard into view itself.
      if (card !== null) card.focus({ preventScroll: true });
      else (rowOf(root, selected) ?? nodesToggleOf(root))?.focus();
    }
    setSelected(null);
  };
  /**
   * Escape, as the builder's keys read it (keymap.ts), on the run canvas, in the node table or in the
   * node panel, while a node is selected: it clears the selection, and only that. It is handled here,
   * so the builder's own Escape doesn't hide the builder too. Focus in the panel moves as it closes;
   * anywhere else it stays.
   */
  const escapeClears = (e: KeyboardEvent<HTMLDivElement>) => {
    if (selected === null || commandFor(e.nativeEvent, "other") !== "escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target instanceof Node && panel.current?.contains(e.target)) closePanel();
    else setSelected(null);
  };
  // Each hold panel's element id, by its place in the run's holds, so the node panel can link to it.
  const holdsId = useId();
  const holdPanelId = (n: number) => `${holdsId}hold-${n}`;

  return (
    <section ref={detail} aria-label={`Run ${name}`} className="space-y-3 rounded-md border border-[#30363d] p-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#c9d1d9]">
        <h3 className="font-mono font-semibold">{name}</h3>
        {run && <span>{run.status}</span>}
        {run?.outcome && <span className="text-[#8b949e]">{run.outcome}</span>}
        {run && <ControlChip control={run.control} />}
        {run?.held && <HeldBadge />}
        {run?.awaitingApproval && (
          <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-[#79c0ff]/60 text-[#79c0ff] text-[10px]">
            <Hourglass className="w-3 h-3" aria-hidden="true" />
            Awaiting approval
          </span>
        )}
        {revision !== null && <span className="text-[#8b949e]">revision {revision}</span>}
        {run?.simulated && <span className={`px-1.5 py-px rounded-full border text-[10px] ${AMBER}`}>Simulated</span>}
        <span className="ml-auto inline-flex items-center gap-2">
          {openButton("Open in browser")}
          <CloseButton name={name} onClose={onClose} />
        </span>
      </header>
      <FollowStatus name={name} view={view} notice={notice} />
      {run && (
        <dl className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-[#c9d1d9] ${view.dimmed ? "opacity-50" : ""}`}>
          <dt className="text-[#8b949e]">Created</dt>
          <dd>{timeText(run.createdAt, run.createdAtText)}</dd>
          <dt className="text-[#8b949e]">Updated</dt>
          <dd>{timeText(run.updatedAt, run.updatedAtText)}</dd>
        </dl>
      )}
      {run?.holds.map((hold, n) => (
        <HoldPanel key={hold.key} id={holdPanelId(n)} hold={hold} run={run} openButton={openButton("Resolve in browser")} onTrust={trust} />
      ))}
      {run && run.waiting && run.holds.length === 0 && <WaitingBanner run={run} openButton={openButton("Open in browser")} onTrust={trust} />}
      {run?.nodes?.reported && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape clears the selected node; every control inside handles its own keys
        <div className={`flex flex-wrap items-start gap-3 ${view.dimmed ? "opacity-50" : ""}`} onKeyDown={escapeClears}>
          <div className="min-w-0 flex-1 basis-80">
            <RunCanvas
              projectPath={projectPath}
              workflow={workflow}
              revision={revision}
              unlisted={unlisted}
              runName={name}
              nodes={run.nodes.rows}
              revisions={revisions}
              onUnreadable={openNodes}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
          {selected !== null && (
            <NodePanel nodeId={selected} {...nodePanelOf(run.nodes.rows, run.holds, selected, holdPanelId)} onClose={closePanel} rootRef={panel} />
          )}
        </div>
      )}
      {run?.nodes && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape clears the selected node; every control inside handles its own keys
        <div className={view.dimmed ? "opacity-50" : ""} onKeyDown={escapeClears}>
          <NodeTable nodes={run.nodes} open={nodesOpen} onOpenChange={setNodesOpen} selected={selected} onSelect={setSelected} />
        </div>
      )}
    </section>
  );
};
