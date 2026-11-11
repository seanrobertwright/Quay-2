// A graph run's detail (#444, #465, #568, #569, #571): its run-level facts (status, control chip,
// held, awaiting approval, revision, and created and updated times), then its run canvas (#571),
// which draws the revision the run runs with each node in its node phase, and its node table (#569),
// followed while it is on screen with the template run detail's delays and stop rules. The one read
// feeds them all, and while the host can't be used, the facts, the canvas and the table dim. When
// the revision can't be read, the node table opens by itself. It shares the template run detail's
// waiting banner, hold panel, certificate hint and page actions, with one hold panel per
// `aiws-graph-hold-card/1`. Decisions on a run (approve, pause, cancel, resolving a hold) are made
// only in the host's browser page, so it has no control for any of them, not even a disabled one.
import { useCallback, useState, type FC } from "react";
import { Hourglass } from "lucide-react";
import { formatDateTime } from "../../lib/dates.ts";
import { REVISION_CACHE, type RevisionCache } from "./graphRevision.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { NodeTable } from "./NodeTable.tsx";
import { RunCanvas } from "./RunCanvas.tsx";
import { AMBER, CloseButton, ControlChip, FollowStatus, HeldBadge, HoldPanel, useRunPageActions, WaitingBanner } from "./RunDetail.tsx";
import type { RunPageLookup, RunRow } from "./runsList.ts";
import { useRunDetail } from "./useRunDetail.ts";

interface GraphRunDetailProps {
  projectPath: string;
  /** The graph workflow the run is a run of. */
  workflow: string;
  workOrderId: string;
  /** The run's row from the Runs list's last read: the revision and times, and the fallback for what `status` doesn't give. */
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
  const { name, notice, openButton, trust } = useRunPageActions({ projectPath, workOrderId, run, row, runPage, runInTerminal });
  const [nodesOpen, setNodesOpen] = useState(false);
  const openNodes = useCallback(() => setNodesOpen(true), []);

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
        {run?.revision !== null && run?.revision !== undefined && <span className="text-[#8b949e]">revision {run.revision}</span>}
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
      {run?.holds.map((hold) => (
        <HoldPanel key={hold.key} hold={hold} run={run} openButton={openButton("Resolve in browser")} onTrust={trust} />
      ))}
      {run && run.waiting && run.holds.length === 0 && <WaitingBanner run={run} openButton={openButton("Open in browser")} onTrust={trust} />}
      {run?.nodes?.reported && (
        <div className={view.dimmed ? "opacity-50" : ""}>
          <RunCanvas
            projectPath={projectPath}
            workflow={workflow}
            revision={run.revision}
            runName={name}
            nodes={run.nodes.rows}
            revisions={revisions}
            onUnreadable={openNodes}
          />
        </div>
      )}
      {run?.nodes && (
        <div className={view.dimmed ? "opacity-50" : ""}>
          <NodeTable nodes={run.nodes} open={nodesOpen} onOpenChange={setNodesOpen} />
        </div>
      )}
    </section>
  );
};
