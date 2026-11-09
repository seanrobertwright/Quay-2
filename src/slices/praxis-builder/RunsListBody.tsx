// What every Runs view draws from its Runs list (#452, #464): the read status, the runs newest
// first with their markers, Show more, and the note at the host's cap. A workflow template's Runs
// view and a graph workflow's both draw it, so their lists look and read the same.
import type { FC } from "react";
import { ExternalLink, FlaskConical, Hourglass, Pause, UserCheck } from "lucide-react";
import { formatClock, formatDateTime } from "../../lib/dates.ts";
import { AMBER } from "./RunDetail.tsx";
import { RUNS_MAX_LIMIT, type RunRow, type RunsListView } from "./runsList.ts";

/** The amber note above a simulated host's runs. */
export const SimulatedRunsNotice: FC = () => (
  <p className={`flex items-start gap-1.5 px-2 py-1.5 rounded-md border text-[11px] ${AMBER}`}>
    <FlaskConical className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
    These runs are on a simulated host: their approvals aren&apos;t made by a person.
  </p>
);

interface RunsListBodyProps {
  /** The record whose runs these are, for the empty and reading notes. */
  name: string;
  view: RunsListView;
  /** Why the last Open in browser didn't open, if it didn't. */
  notice: string | null;
  onShowMore: () => void;
  onOpenInBrowser: (run: RunRow) => void;
  /** The run whose detail is shown, and how a row's id shows or hides it; absent when the view has no run detail. */
  selection?: { selected: string | null; onSelect: (workOrderId: string | null) => void };
}

export const RunsListBody: FC<RunsListBodyProps> = ({ name, view, notice, onShowMore, onOpenInBrowser, selection }) => {
  const readAt = view.readAt === null ? null : formatClock(view.readAt);
  return (
    <>
      <div role="status" className="text-[11px] text-[#8b949e] space-y-1">
        {view.runs === null && view.problem === null && <p>Reading the runs of {name}…</p>}
        {view.dimmed && (
          <p className="text-[#f85149]">
            The host can&apos;t be used, so this list may be out of date{readAt ? `: it was read at ${readAt}` : ""}. {view.problem}
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
              {selection ? (
                <button
                  type="button"
                  aria-label={`Show ${run.runId}`}
                  aria-pressed={selection.selected === run.workOrderId}
                  onClick={() => selection.onSelect(selection.selected === run.workOrderId ? null : run.workOrderId)}
                  className="font-mono underline-offset-2 hover:underline aria-pressed:text-white aria-pressed:underline"
                >
                  {run.runId}
                </button>
              ) : (
                <span className="font-mono">{run.runId}</span>
              )}
              <span>{run.status}</span>
              {run.stage !== null && (
                <span className="text-[#8b949e]">
                  <span className="sr-only">Stage </span>
                  {run.stage}
                </span>
              )}
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
              {run.awaitingApproval && (
                <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-[#79c0ff]/60 text-[#79c0ff] text-[10px]">
                  <Hourglass className="w-3 h-3" aria-hidden="true" />
                  Awaiting approval
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
                    onClick={() => onOpenInBrowser(run)}
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
          onClick={onShowMore}
          className="inline-flex items-center px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white"
        >
          Show more
        </button>
      )}
      {view.atCap && (
        <p className="text-[11px] text-[#8b949e]">
          Showing the newest {RUNS_MAX_LIMIT} runs, the most praxis lists. Older runs can&apos;t be listed, because praxis has no way to page past them.
        </p>
      )}
    </>
  );
};
