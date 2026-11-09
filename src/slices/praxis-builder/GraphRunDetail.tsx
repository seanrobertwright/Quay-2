// A graph run's detail (#444, #465): run-level facts only (status, control chip, held, awaiting
// approval, revision, and created and updated times), followed while it is on screen with the
// template run detail's delays and stop rules. Node states wait on the SDK's graph-run read model.
// It shares the template run detail's waiting banner, hold panel, certificate hint and page
// actions. Decisions on a run (approve, pause, cancel, resolving a hold) are made only in the
// host's browser page, so it has no control for any of them, not even a disabled one.
import type { FC } from "react";
import { Hourglass, Pause, X } from "lucide-react";
import { formatDateTime } from "../../lib/dates.ts";
import { GRAPH_RUN } from "./graphRunDetail.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { AMBER, FollowStatus, HoldPanel, useRunPageActions, WaitingBanner } from "./RunDetail.tsx";
import type { RunPageLookup, RunRow } from "./runsList.ts";
import { useRunDetail } from "./useRunDetail.ts";

interface GraphRunDetailProps {
  projectPath: string;
  workOrderId: string;
  /** The run's row from the Runs list's last read: the revision and times, and the fallback for what `status` doesn't give. */
  row: RunRow | null;
  /** True while the Runs view is on screen. */
  shown: boolean;
  /** Looks up the run's page when neither `status` nor the row gave it. */
  runPage: (workOrderId: string) => Promise<RunPageLookup>;
  runInTerminal?: RunInTerminal;
  onClose: () => void;
}

const BUTTON = "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-[11px] text-white";

/** A time as the host wrote it, in local words when it can be read. */
const timeText = (ms: number | null, text: string | null) => (ms !== null ? formatDateTime(ms) : (text ?? "Not given"));

export const GraphRunDetail: FC<GraphRunDetailProps> = ({ projectPath, workOrderId, row, shown, runPage, runInTerminal, onClose }) => {
  const view = useRunDetail(projectPath, workOrderId, row, shown, GRAPH_RUN);
  const run = view.run;
  const name = run?.runId ?? row?.runId ?? workOrderId;
  const { notice, openButton, trust } = useRunPageActions(projectPath, name, run?.runPageAddress ?? null, () => runPage(workOrderId), runInTerminal);

  return (
    <section aria-label={`Run ${name}`} className="space-y-3 rounded-md border border-[#30363d] p-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#c9d1d9]">
        <h3 className="font-mono font-semibold">{name}</h3>
        {run && <span>{run.status}</span>}
        {run?.outcome && <span className="text-[#8b949e]">{run.outcome}</span>}
        {run && (
          <span className="inline-flex items-center gap-1">
            <span className="sr-only">Control </span>
            <span data-chip="control" className="px-1.5 py-px rounded-full border border-[#30363d] bg-[#21262d] text-[10px]">
              {run.control}
            </span>
          </span>
        )}
        {run?.held && (
          <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-[#f0883e]/60 text-[#f0883e] text-[10px]">
            <Pause className="w-3 h-3" aria-hidden="true" />
            Held
          </span>
        )}
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
          <button type="button" onClick={onClose} aria-label={`Close ${name}`} className={BUTTON}>
            <X className="w-3 h-3" aria-hidden="true" />
            Close
          </button>
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
        <HoldPanel key={hold.holdId} hold={hold} run={run} openButton={openButton("Resolve in browser")} onTrust={trust} />
      ))}
      {run && run.waiting && run.holds.length === 0 && <WaitingBanner run={run} openButton={openButton("Open in browser")} onTrust={trust} />}
    </section>
  );
};
