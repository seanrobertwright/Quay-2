// A workflow template's Runs view (#362, #452): the template's runs on the Praxis host, newest
// first, polled through the runs list model while the view is on screen. Decisions on a run are
// made only in the host's browser page, so a run that needs a person offers Open in browser and
// nothing else. Show opens a run's detail (#453) above the list, followed while it is shown. Run
// in the header starts a run of the host's installed copy after a confirm (#454): a created run is
// selected and followed, and every other outcome gets a notice of its own.
import { useId, useRef, useState, type FC } from "react";
import { Play } from "lucide-react";
import type { TemplateHost } from "./HostStatusLine.tsx";
import type { JsonObject } from "./model.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { RunConfirm } from "./RunConfirm.tsx";
import { RunDetail } from "./RunDetail.tsx";
import { openRunPageOf } from "./runPage.ts";
import { RunsListBody, SimulatedRunsNotice } from "./RunsListBody.tsx";
import type { RunRow } from "./runsList.ts";
import { StartedNotice } from "./RunStartedNotice.tsx";
import { runRefusedBy, runStarts } from "./runStart.ts";
import type { GitChange } from "./types.ts";
import { useRunsList } from "./useRunsList.ts";
import { useRunStart } from "./useRunStart.ts";

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

export const RunsView: FC<RunsViewProps> = ({ projectPath, name, shown, content, runInTerminal, host = null, onInstall, unsaved = false, changed }) => {
  const { list, view } = useRunsList(projectPath, name, shown);
  const [notice, setNotice] = useState<string | null>(null);
  // The `workOrderId` of the run whose detail is shown, if any.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRow = view.runs?.find((r) => r.workOrderId === selected) ?? null;
  const [confirming, setConfirming] = useState(false);
  const runRef = useRef<HTMLButtonElement | null>(null);
  const runReasonId = useId();
  const run = useRunStart(runStarts, projectPath, name, (workOrderId) => {
    setSelected(workOrderId);
    list?.refresh();
  });
  const { creating, started } = run;
  const refusedBy = host ? runRefusedBy(host.view.state) : null;
  const runWithheld = creating !== null || refusedBy !== null;

  const startRun = () => {
    setConfirming(false);
    setNotice(null);
    run.start();
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

  const openInBrowser = async (run: RunRow) => {
    if (!list) return;
    setNotice(null);
    setNotice(await openRunPageOf(run.runId, run.runPageAddress, () => list.runPage(run.workOrderId)));
  };

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
          onCopy={run.copyRefusal}
          onDismiss={run.dismiss}
        />
      )}
      {view.simulated && <SimulatedRunsNotice />}
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
      <RunsListBody
        name={name}
        view={view}
        notice={notice}
        onShowMore={() => list?.showMore()}
        onOpenInBrowser={(run) => void openInBrowser(run)}
        selection={{ selected, onSelect: setSelected }}
      />
    </section>
  );
};
