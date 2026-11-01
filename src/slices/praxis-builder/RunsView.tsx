// A workflow template's Runs view (#362, #452): the template's runs on the Praxis host, newest
// first, polled through the runs list model while the view is on screen. Decisions on a run are
// made only in the host's browser page, so a run that needs a person offers Open in browser and
// nothing else. Show opens a run's detail (#453) above the list, followed while it is shown. Run
// in the header starts a run of the host's installed copy after a confirm (#454): a created run is
// selected and followed, and every other outcome gets a notice of its own.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FC } from "react";
import { Check, Copy, ExternalLink, FlaskConical, Pause, Play, TriangleAlert, UserCheck, X } from "lucide-react";
import { formatClock, formatDateTime } from "../../lib/dates.ts";
import type { TemplateHost } from "./HostStatusLine.tsx";
import type { JsonObject } from "./model.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { RunConfirm } from "./RunConfirm.tsx";
import { AMBER, RunDetail } from "./RunDetail.tsx";
import { openRunPageOf } from "./runPage.ts";
import { RUNS_MAX_LIMIT, type RunRow } from "./runsList.ts";
import { runRefusedBy, runStarts, type RunStart } from "./runStart.ts";
import type { GitChange } from "./types.ts";
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
  /** The template's state on the Praxis host, from the host catalog; null without one. */
  host?: TemplateHost | null;
  /** Opens "Install on host…"; absent when the template has no saved file to install. */
  onInstall?: () => void;
  /** The open draft has edits the saved file doesn't. */
  unsaved?: boolean;
  /** How the template file differs from the last commit; undefined when it doesn't. */
  changed?: GitChange;
}

/** The outcome of the last Run this view started, and what its Copy said. */
type Started = { start: RunStart; copied: string | null };

export const RunsView: FC<RunsViewProps> = ({ projectPath, name, shown, content, runInTerminal, host = null, onInstall, unsaved = false, changed }) => {
  const { list, view } = useRunsList(projectPath, name, shown);
  const [notice, setNotice] = useState<string | null>(null);
  // The work order whose detail is shown, if any.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRow = view.runs?.find((r) => r.workOrderId === selected) ?? null;
  const [confirming, setConfirming] = useState(false);
  const [started, setStarted] = useState<Started | null>(null);
  const runRef = useRef<HTMLButtonElement | null>(null);
  const runReasonId = useId();
  const creating = useSyncExternalStore(runStarts.subscribe, () => runStarts.inFlight(projectPath, name));
  const refusedBy = host ? runRefusedBy(host.view.state) : null;
  const runWithheld = creating !== null || refusedBy !== null;

  const mountedRef = useRef(true);
  const listRef = useRef(list);
  listRef.current = list;
  const settle = useRef((start: RunStart) => {
    if (!mountedRef.current) return;
    setStarted({ start, copied: null });
    if (start.kind === "created") {
      setSelected(start.workOrderId);
      listRef.current?.refresh();
    }
  }).current;
  useEffect(() => {
    mountedRef.current = true;
    // A creation this template's Runs view started before it left the screen is joined, so its
    // outcome shows when it ends. One this view starts is settled where it starts.
    void runStarts.inFlight(projectPath, name)?.then(settle);
    return () => {
      mountedRef.current = false;
    };
  }, [projectPath, name, settle]);

  const startRun = () => {
    setConfirming(false);
    setStarted(null);
    setNotice(null);
    void runStarts.start(projectPath, name).then(settle);
  };

  const openPage = async (label: string, address: string | null, workOrderId: string | null) => {
    if (!list) return;
    setNotice(null);
    setNotice(
      await openRunPageOf(label, address, () =>
        workOrderId === null ? Promise.resolve({ problem: "praxis named no run." }) : list.runPage(workOrderId),
      ),
    );
  };

  const copyRefusal = (message: string) => {
    const copied = (text: string) => setStarted((s) => (s ? { ...s, copied: text } : s));
    navigator.clipboard.writeText(message).then(
      () => copied("Copied praxis's words."),
      (e) => copied(`Couldn't copy: ${String(e)}`),
    );
  };

  const openInBrowser = async (run: RunRow) => {
    if (!list) return;
    setNotice(null);
    setNotice(await openRunPageOf(run.runId, null, () => list.runPage(run.workOrderId)));
  };

  const readAt = view.readAt === null ? null : formatClock(view.readAt);
  return (
    <section aria-label={`Runs of ${name}`} className="space-y-3">
      <header className="flex items-start gap-2">
        <h2 className="text-sm font-semibold text-[#c9d1d9] min-w-0 break-all">
          Runs on the host
          <span className="ml-2 font-mono font-normal text-[#8b949e]">{name}</span>
        </h2>
        <button
          ref={runRef}
          type="button"
          // Not `disabled`, which would drop focus; the reason is shown and described.
          aria-disabled={runWithheld}
          aria-describedby={runWithheld ? runReasonId : undefined}
          onClick={() => !runWithheld && setConfirming(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white shrink-0 aria-disabled:opacity-40"
        >
          <Play className="w-3.5 h-3.5" aria-hidden="true" />
          Run
        </button>
      </header>
      {runWithheld && (
        <p id={runReasonId} className="text-[11px] text-[#8b949e]">
          {creating !== null ? `Starting a run of ${name}…` : refusedBy}
        </p>
      )}
      {confirming && (
        <RunConfirm
          name={name}
          host={host}
          unsaved={unsaved}
          changed={changed}
          onInstall={
            onInstall &&
            (() => {
              setConfirming(false);
              onInstall();
            })
          }
          onRun={startRun}
          onClose={() => setConfirming(false)}
          returnFocus={runRef}
        />
      )}
      {started && (
        <StartedNotice
          started={started}
          name={name}
          onShowRun={setSelected}
          onOpen={(label, address, workOrderId) => void openPage(label, address, workOrderId)}
          onCopy={copyRefusal}
          onDismiss={() => setStarted(null)}
        />
      )}
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

/** The notice for a Run's outcome: a toast for a created run, otherwise what stopped it. */
const StartedNotice: FC<{
  started: Started;
  name: string;
  onShowRun: (workOrderId: string) => void;
  onOpen: (label: string, address: string | null, workOrderId: string | null) => void;
  onCopy: (message: string) => void;
  onDismiss: () => void;
}> = ({ started, name, onShowRun, onOpen, onCopy, onDismiss }) => {
  const { start, copied } = started;
  const buttonClass = "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#30363d] hover:bg-[#21262d] text-[#c9d1d9]";
  const dismiss = (
    <button type="button" aria-label="Dismiss" onClick={onDismiss} className="ml-auto p-0.5 rounded text-[#8b949e] hover:text-white">
      <X className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
  if (start.kind === "created") {
    return (
      <div role="status" aria-label="Run started" className="flex flex-wrap items-center gap-2 px-2 py-1.5 rounded-md border border-[#238636]/60 bg-[#0d1117] text-xs">
        <Check className="w-3.5 h-3.5 text-[#3fb950]" aria-hidden="true" />
        <span>
          Started <span className="font-mono">{start.runId}</span> of {name}.
        </span>
        <button type="button" onClick={() => onOpen(start.runId, start.runPageAddress, start.workOrderId)} className={buttonClass}>
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          Open in browser
        </button>
        {dismiss}
      </div>
    );
  }
  const blocking = start.kind === "blocked" ? start.blockingWorkOrderId : null;
  return (
    <div role="alert" aria-label="Run not started" className="space-y-1.5 px-2 py-1.5 rounded-md border border-[#f85149]/60 bg-[#0d1117] text-xs">
      <div className="flex items-start gap-1.5">
        <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0 text-[#f85149]" aria-hidden="true" />
        <p className="min-w-0 break-words whitespace-pre-wrap">
          {start.kind === "refused" ? (
            <>
              praxis refused the run: <span className="font-mono">{start.message}</span>
            </>
          ) : (
            start.message
          )}
        </p>
        {dismiss}
      </div>
      {start.kind === "blocked" && (
        <div className="flex flex-wrap gap-2">
          {blocking !== null && (
            <button type="button" onClick={() => onShowRun(blocking)} className={buttonClass}>
              Show run
            </button>
          )}
          <button type="button" onClick={() => onOpen("the blocking run", start.blockingRunAddress, blocking)} className={buttonClass}>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
            Open in browser
          </button>
        </div>
      )}
      {start.kind === "refused" && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onCopy(start.message)} className={buttonClass}>
            <Copy className="w-3 h-3" aria-hidden="true" />
            Copy
          </button>
          <span role="status" className="text-[11px] text-[#8b949e]">
            {copied}
          </span>
        </div>
      )}
    </div>
  );
};
