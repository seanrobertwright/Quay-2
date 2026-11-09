// A graph workflow's Runs view (#444, #464): the graph workflow's runs on the Praxis host, newest
// first, polled through the same Runs list model as a template's Runs view (#452), with its
// delays and stop rules, while the view is on screen. Decisions on a run are made only in the
// host's browser page, so a run that needs a person offers Open in browser and nothing else.
import { useState, type FC } from "react";
import { openRunPageOf } from "./runPage.ts";
import { RunsListBody, SimulatedRunsNotice } from "./RunsListBody.tsx";
import { GRAPH_RUNS, type RunRow } from "./runsList.ts";
import { useRunsList } from "./useRunsList.ts";

interface GraphRunsViewProps {
  projectPath: string;
  name: string;
  /** True while the builder is shown. It is only hidden when it closes, so the view stops by this. */
  shown: boolean;
}

export const GraphRunsView: FC<GraphRunsViewProps> = ({ projectPath, name, shown }) => {
  const { list, view } = useRunsList(projectPath, name, shown, GRAPH_RUNS);
  const [notice, setNotice] = useState<string | null>(null);

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
      <RunsListBody name={name} view={view} notice={notice} onShowMore={() => list?.showMore()} onOpenInBrowser={(run) => void openInBrowser(run)} />
    </section>
  );
};
