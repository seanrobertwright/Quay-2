// A workflow template's Runs view (#362, #452): the template's runs on the Praxis host, newest
// first, polled through the runs list model while the view is on screen. Decisions on a run are
// made only in the host's browser page, so a run that needs a person offers Open in browser and
// nothing else. Show opens a run's detail (#453) above the list, followed while it is shown.
import { useState, type FC } from "react";
import { ExternalLink, FlaskConical, Pause, UserCheck } from "lucide-react";
import { formatClock, formatDateTime } from "../../lib/dates.ts";
import type { JsonObject } from "./model.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { AMBER, RunDetail } from "./RunDetail.tsx";
import { openRunPageOf } from "./runPage.ts";
import { RUNS_MAX_LIMIT, type RunRow } from "./runsList.ts";
import { useRunsList } from "./useRunsList.ts";

interface RunsViewProps {
  projectPath: string;
  name: string;
  /** True while the builder is shown. It is only hidden when it closes, so the view stops by this. */
  shown: boolean;
  /** The template's content, whose stages a run's detail is drawn on. */
  content: JsonObject;
  /** How a run's detail opens a visible terminal for `praxis trust`. */
  runInTerminal?: RunInTerminal;
}

export const RunsView: FC<RunsViewProps> = ({ projectPath, name, shown, content, runInTerminal }) => {
  const { list, view } = useRunsList(projectPath, name, shown);
  const [notice, setNotice] = useState<string | null>(null);
  // The work order whose detail is shown, if any.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRow = view.runs?.find((r) => r.workOrderId === selected) ?? null;

  const openInBrowser = async (run: RunRow) => {
    if (!list) return;
    setNotice(null);
    setNotice(await openRunPageOf(run.runId, null, () => list.runPage(run.workOrderId)));
  };

  const readAt = view.readAt === null ? null : formatClock(view.readAt);
  return (
    <section aria-label={`Runs of ${name}`} className="space-y-3">
      {view.simulated && (
        <p className={`flex items-start gap-1.5 px-2 py-1.5 rounded-md border text-[11px] ${AMBER}`}>
          <FlaskConical className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          These runs are on a simulated host: their approvals aren't made by a person.
        </p>
      )}
      {selected !== null && list && (
        <RunDetail
          key={selected}
          projectPath={projectPath}
          workOrderId={selected}
          row={selectedRow}
          content={content}
          shown={shown}
          runPage={list.runPage}
          runInTerminal={runInTerminal}
          onClose={() => setSelected(null)}
        />
      )}
      <div role="status" className="text-[11px] text-[#8b949e] space-y-1">
        {view.runs === null && view.problem === null && <p>Reading the runs of {name}…</p>}
        {view.dimmed && (
          <p className="text-[#f85149]">
            The host can't be used, so this list may be out of date{readAt ? `: it was read at ${readAt}` : ""}. {view.problem}
          </p>
        )}
        {!view.dimmed && view.problem && <p className="text-[#f85149]">{view.problem}</p>}
        {!view.dimmed && readAt && <p>Read at {readAt}.</p>}
        {notice && <p className="text-[#f85149]">{notice}</p>}
      </div>
      {view.runs !== null && view.runs.length === 0 && <p className="text-xs text-[#8b949e]">The host has no runs of {name}.</p>}
      {view.runs !== null && view.runs.length > 0 && (
        <ul aria-label="Runs" className={`divide-y divide-[#21262d] border border-[#30363d] rounded-md ${view.dimmed ? "opacity-50" : ""}`}>
          {view.runs.map((run) => (
            <li key={run.runId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs text-[#c9d1d9]">
              <button
                type="button"
                aria-label={`Show ${run.runId}`}
                aria-pressed={selected === run.workOrderId}
                onClick={() => setSelected(selected === run.workOrderId ? null : run.workOrderId)}
                className="font-mono underline-offset-2 hover:underline aria-pressed:text-white aria-pressed:underline"
              >
                {run.runId}
              </button>
              <span>{run.status}</span>
              <span className="text-[#8b949e]">
                <span className="sr-only">Stage </span>
                {run.stage}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="sr-only">Control </span>
                <span data-chip="control" className="px-1.5 py-px rounded-full border border-[#30363d] bg-[#21262d] text-[10px]">
                  {run.control}
                </span>
              </span>
              {run.held && (
                <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-[#f0883e]/60 text-[#f0883e] text-[10px]">
                  <Pause className="w-3 h-3" aria-hidden="true" />
                  Held
                </span>
              )}
              <span className="text-[#8b949e]">revision {run.revision}</span>
              <span className="text-[#8b949e]">
                <span className="sr-only">Created </span>
                {run.createdAt === null ? run.createdAtText : formatDateTime(run.createdAt)}
              </span>
              {view.simulated && <span className={`px-1.5 py-px rounded-full border text-[10px] ${AMBER}`}>Simulated</span>}
              {run.needsYou && (
                <span className="ml-auto inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[#79c0ff]">
                    <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    Needs you
                  </span>
                  <button
                    type="button"
                    aria-label={`Open ${run.runId} in browser`}
                    onClick={() => void openInBrowser(run)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#30363d] hover:bg-[#21262d]"
                  >
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    Open in browser
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.canShowMore && (
        <button
          type="button"
          onClick={() => list?.showMore()}
          className="inline-flex items-center px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white"
        >
          Show more
        </button>
      )}
      {view.atCap && (
        <p className="text-[11px] text-[#8b949e]">
          Showing the newest {RUNS_MAX_LIMIT} runs, the most praxis lists. Older runs can't be listed, because praxis has no way to page past them.
        </p>
      )}
    </section>
  );
};
