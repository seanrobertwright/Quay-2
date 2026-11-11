// A graph workflow's Runs view (#444, #464): the graph workflow's runs on the Praxis host, newest
// first, polled through the same Runs list model as a template's Runs view (#452), with its
// delays and stop rules, while the view is on screen. Decisions on a run are made only in the
// host's browser page, so a run that needs a person offers Open in browser and nothing else.
// Show opens a run's detail (#465) above the list, followed while it is shown. Run in the header
// starts a run of the host's admitted revision after a confirm (#466): a created run is selected
// and followed, and every other outcome gets a notice of its own, as for a template run. A run
// to show when the view opens, such as one a graph trigger's fire created (#478), starts selected.
import { useState, type FC } from "react";
import type { GraphWorkflowHost } from "./GraphHostPanel.tsx";
import { GraphRunConfirm } from "./GraphRunConfirm.tsx";
import { GraphRunDetail } from "./GraphRunDetail.tsx";
import type { RevisionCache } from "./graphRevision.ts";
import { graphRunRefusedBy } from "./graphRunStart.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { RunControl } from "./RunControl.tsx";
import { RunsListBody, SimulatedRunsNotice } from "./RunsListBody.tsx";
import { GRAPH_RUNS } from "./runsList.ts";
import { graphRunStarts } from "./runStart.ts";
import type { DefinitionRef } from "./types.ts";
import { useRunPages } from "./useRunPages.ts";
import { useRunsList } from "./useRunsList.ts";
import { useRunStart } from "./useRunStart.ts";

interface GraphRunsViewProps {
  projectPath: string;
  name: string;
  /** True while the builder is shown. It is only hidden when it closes, so the view stops by this. */
  shown: boolean;
  /** How a run's detail opens a visible terminal for `praxis trust`. */
  runInTerminal?: RunInTerminal;
  /** The graph workflow's state on the Praxis host, from the graph host model; null without one. */
  host?: GraphWorkflowHost | null;
  /** The bundle's records whose drafts have edits their saved files don't. */
  unsaved?: readonly DefinitionRef[];
  /** The `workOrderId` of the run whose detail is shown when the view opens; none when absent. */
  initialRun?: string;
  /** Where a run's run canvas reads its revision; the builder's own cache when absent. */
  revisions?: RevisionCache;
}

export const GraphRunsView: FC<GraphRunsViewProps> = ({ projectPath, name, shown, runInTerminal, host = null, unsaved = [], initialRun, revisions }) => {
  const { list, view } = useRunsList(projectPath, name, shown, GRAPH_RUNS);
  const pages = useRunPages(list);
  // The `workOrderId` of the run whose detail is shown, if any.
  const [selected, setSelected] = useState<string | null>(initialRun ?? null);
  const selectedRow = view.runs?.find((r) => r.workOrderId === selected) ?? null;
  const run = useRunStart(graphRunStarts, projectPath, name, (workOrderId) => {
    setSelected(workOrderId);
    list?.refresh();
  });

  return (
    <section aria-label={`Runs of ${name}`} className="space-y-3">
      <RunControl
        name={name}
        run={run}
        refusedBy={host ? graphRunRefusedBy(name, host.view) : null}
        confirm={(dialog) => <GraphRunConfirm projectPath={projectPath} name={name} host={host} unsaved={unsaved} {...dialog} />}
        onStart={pages.clearNotice}
        onShowRun={setSelected}
        onOpen={pages.openPage}
      />
      {view.simulated && <SimulatedRunsNotice />}
      {selected !== null && list && (
        <GraphRunDetail
          key={selected}
          projectPath={projectPath}
          workflow={name}
          workOrderId={selected}
          row={selectedRow}
          shown={shown}
          runPage={list.runPage}
          runInTerminal={runInTerminal}
          revisions={revisions}
          onClose={() => setSelected(null)}
        />
      )}
      <RunsListBody
        name={name}
        view={view}
        notice={pages.notice}
        onShowMore={() => list?.showMore()}
        onOpenInBrowser={pages.openInBrowser}
        selection={{ selected, onSelect: setSelected }}
      />
    </section>
  );
};
