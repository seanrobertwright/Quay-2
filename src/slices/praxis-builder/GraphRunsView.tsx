// A graph workflow's Runs view (#444, #464): the graph workflow's runs on the Praxis host, newest
// first, polled through the same Runs list model as a template's Runs view (#452), with its
// delays and stop rules, while the view is on screen. Decisions on a run are made only in the
// host's browser page, so a run that needs a person offers Open in browser and nothing else.
// Show opens a run's detail (#465) above the list, followed while it is shown.
import { useState, type FC } from "react";
import { GraphRunDetail } from "./GraphRunDetail.tsx";
import type { RunInTerminal } from "./praxisHost.ts";
import { openRunPageOf } from "./runPage.ts";
import { RunsListBody, SimulatedRunsNotice } from "./RunsListBody.tsx";
import { GRAPH_RUNS, type RunRow } from "./runsList.ts";
import { useRunsList } from "./useRunsList.ts";

interface GraphRunsViewProps {
  projectPath: string;
  name: string;
  /** True while the builder is shown. It is only hidden when it closes, so the view stops by this. */
  shown: boolean;
  /** How a run's detail opens a visible terminal for `praxis trust`. */
  runInTerminal?: RunInTerminal;
}

export const GraphRunsView: FC<GraphRunsViewProps> = ({ projectPath, name, shown, runInTerminal }) => {
  const { list, view } = useRunsList(projectPath, name, shown, GRAPH_RUNS);
  const [notice, setNotice] = useState<string | null>(null);
  // The `workOrderId` of the run whose detail is shown, if any.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRow = view.runs?.find((r) => r.workOrderId === selected) ?? null;

  const openInBrowser = async (run: RunRow) => {
    if (!list) return;
    setNotice(null);
    setNotice(await openRunPageOf(run.runId, run.runPageAddress, () => list.runPage(run.workOrderId)));
  };

  return (
    <section aria-label={`Runs of ${name}`} className="space-y-3">
      <header>
        <h2 className="text-sm font-semibold text-[#c9d1d9] min-w-0 break-all">
          Runs on the host
          <span className="ml-2 font-mono font-normal text-[#8b949e]">{name}</span>
        </h2>
      </header>
      {view.simulated && <SimulatedRunsNotice />}
      {selected !== null && list && (
        <GraphRunDetail
          key={selected}
          projectPath={projectPath}
          workOrderId={selected}
          row={selectedRow}
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
