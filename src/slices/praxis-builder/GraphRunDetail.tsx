// A graph run's detail (#444, #465, #568, #569, #570, #571, #572): its run-level facts (status,
// control chip, held, awaiting approval, revision, and created and updated times), then its run
// canvas (#571), which draws the revision the run runs with each node in its node phase, and its
// node table (#569), followed while it is on screen on the template run detail's delays and stop
// rules but with a narrower person-wait (#570): a run waiting for a person is read every 15 s only
// while none of its nodes is active (graphRunDetail.ts), and on the backoff otherwise. Its one
// `praxis status` read per poll feeds them all, and the node panel; the run canvas reads its
// revision and the saved layout besides. The revision is the one the run's row in the Runs list
// names, kept from the first row that named it, since a run's revision never changes: the run
// canvas stays drawn once newer runs push the row off the list. While the host can't be used,
// the facts, the run canvas, the node panel and the table dim. When the revision can't be read,
// or is read but can't be drawn, the node table opens by itself.
//
// It holds the one selected node (#572), which the run canvas and the node table share: choosing
// a card or a row selects that node in both and opens its node panel beside the run canvas, or
// beside its place when no revision is drawn. A node held, or blocked, by a hold links to that
// hold's panel when it has one: the host gives a hold card, and so a panel, only for a hold on a
// node's own scope, so a hold on a grant, a branch or the run gets no link.
//
// It shares the template run detail's waiting banner, hold panel, certificate hint and page
// actions, with one hold panel per `aiws-graph-hold-card/1`. Decisions on a run (approve, pause,
// cancel, resolving a hold) are made only in the host's browser page, so it has no control for
// any of them, not even a disabled one.
import { useCallback, useId, useState, type FC } from "react";
import { Hourglass } from "lucide-react";
import { formatDateTime } from "../../lib/dates.ts";
import { REVISION_CACHE, type RevisionCache } from "./graphRevision.ts";
import type { GraphHold, GraphRunNode } from "./graphRunDetail.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { NodePanel, type HoldPanelLink } from "./NodePanel.tsx";
import { NodeTable } from "./NodeTable.tsx";
import { RunCanvas } from "./RunCanvas.tsx";
import { AMBER, CloseButton, ControlChip, FollowStatus, HeldBadge, HoldPanel, holdPanelName, useRunPageActions, WaitingBanner } from "./RunDetail.tsx";
import type { RunPageLookup, RunRow } from "./runsList.ts";
import { useRunDetail } from "./useRunDetail.ts";

interface GraphRunDetailProps {
  projectPath: string;
  /** The graph workflow the run is a run of. */
  workflow: string;
  workOrderId: string;
  /**
   * The run's row from the Runs list's last read, null while the list doesn't list the run: the
   * revision, kept once a row named it, the times, and the fallback for what `status` doesn't give.
   */
  row: RunRow | null;
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
 * The revision the run runs: `revision`, its row's, kept from the first row that named it. A run's
 * revision never changes, and its row leaves the Runs list once newer runs push it off, which would
 * otherwise take the run canvas away mid-view.
 */
function useKeptRevision(revision: number | null): number | null {
  const [kept, setKept] = useState(revision);
  if (kept === null && revision !== null) setKept(revision);
  return kept ?? revision;
}

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
  shown,
  runPage,
  runInTerminal,
  revisions = REVISION_CACHE,
  onClose,
}) => {
  const view = useRunDetail(projectPath, workOrderId, row, shown, "graph");
  const run = view.run;
  const revision = useKeptRevision(run?.revision ?? null);
  const { name, notice, openButton, trust } = useRunPageActions({ projectPath, workOrderId, run, row, runPage, runInTerminal });
  const [nodesOpen, setNodesOpen] = useState(false);
  const openNodes = useCallback(() => setNodesOpen(true), []);
  // The id of the node selected on the run canvas or in the node table, whose node panel is open.
  const [selected, setSelected] = useState<string | null>(null);
  // Each hold panel's element id, by its place in the run's holds, so the node panel can link to it.
  const holdsId = useId();
  const holdPanelId = (n: number) => `${holdsId}hold-${n}`;

  return (
    <section aria-label={`Run ${name}`} className="space-y-3 rounded-md border border-[#30363d] p-3">
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
        <div className={`flex flex-wrap items-start gap-3 ${view.dimmed ? "opacity-50" : ""}`}>
          <div className="min-w-0 flex-1 basis-80">
            <RunCanvas
              projectPath={projectPath}
              workflow={workflow}
              revision={revision}
              runName={name}
              nodes={run.nodes.rows}
              revisions={revisions}
              onUnreadable={openNodes}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
          {selected !== null && <NodePanel nodeId={selected} {...nodePanelOf(run.nodes.rows, run.holds, selected, holdPanelId)} />}
        </div>
      )}
      {run?.nodes && (
        <div className={view.dimmed ? "opacity-50" : ""}>
          <NodeTable nodes={run.nodes} open={nodesOpen} onOpenChange={setNodesOpen} selected={selected} onSelect={setSelected} />
        </div>
      )}
    </section>
  );
};
