// A graph workflow's Runs view (#444, #464): the graph workflow's runs on the Praxis host, newest
// first, polled through the same Runs list model as a template's Runs view (#452), with its
// delays and stop rules, while the view is on screen. Decisions on a run are made only in the
// host's browser page, so a run that needs a person offers Open in browser and nothing else.
// Show opens a run's detail (#465) above the list, followed while it is shown. Run in the header
// starts a run of the host's admitted revision after a confirm (#466): a created run is selected
// and followed, and every other outcome gets a notice of its own, as for a template run. A run
// to show when the view opens, such as one a graph trigger's fire created (#478), starts selected.
// A shown run keeps the last row that named it, and one the list doesn't name is looked for once
// among the newest 100 (#579), but only when its own view doesn't name its revision (#586).
import { useCallback, useEffect, useState, type FC } from "react";
import type { GraphWorkflowHost } from "./GraphHostPanel.tsx";
import { GraphRunConfirm } from "./GraphRunConfirm.tsx";
import { GraphRunDetail } from "./GraphRunDetail.tsx";
import type { RevisionCache } from "./graphRevision.ts";
import { graphRunRefusedBy } from "./graphRunStart.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { RunControl } from "./RunControl.tsx";
import { RunsListBody, SimulatedRunsNotice } from "./RunsListBody.tsx";
import { GRAPH_RUNS, type RunRow, type RunsList, type RunsListView, type Unlisted } from "./runsList.ts";
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

/** A run whose detail is shown, and what the Runs list has said of it since it was shown. */
interface Showing {
  workOrderId: string;
  /** The list's runs when the run was shown. */
  runsThen: readonly RunRow[] | null;
  /** The last row of the list that named the run; null before one did. */
  row: RunRow | null;
}

/**
 * The run whose detail is shown (#465, #579): `initialRun` at first, then the one `show` picks, or
 * none. Its row is its newest in the Runs list, or once newer runs push it off the list, the last
 * row that named it. That row is this showing's: showing another run starts with none.
 *
 * While no row has named the run, `unlisted` says why. Only a read that ends after the run was
 * shown can tell, since the one before may be older than the run, as it is for a run just created.
 * When that read is full at the first limit without the run, the list reads the newest 100 once,
 * as Show more does, if the run's detail has said, with `needRow`, that its row is needed: the
 * run's view, once read, didn't name its revision. A run whose view names it is never looked for.
 */
function useShownRun(list: RunsList | null, view: RunsListView, initialRun: string | undefined) {
  const [showing, setShowing] = useState<Showing | null>(initialRun === undefined ? null : { workOrderId: initialRun, runsThen: null, row: null });
  const listed = showing === null ? null : (view.runs?.find((r) => r.workOrderId === showing.workOrderId) ?? null);
  if (showing !== null && listed !== null && listed !== showing.row) setShowing({ ...showing, row: listed });
  const row = listed ?? showing?.row ?? null;
  // The `workOrderId` of the run whose detail said its row is needed; null when none has.
  const [needed, setNeeded] = useState<string | null>(null);
  const needRow = useCallback(
    (workOrderId: string, isNeeded: boolean) => setNeeded((now) => (isNeeded ? workOrderId : now === workOrderId ? null : now)),
    [],
  );
  // The list as the last read since the run was shown left it; null before such a read.
  const since = showing !== null && view.runs !== null && view.runs !== showing.runsThen ? view : null;
  const unlisted: Unlisted = since?.atCap ? "atCap" : since?.complete ? "complete" : "reading";
  const widen = row === null && needed === showing?.workOrderId && since !== null && since.canShowMore && !since.dimmed;
  // The list model is outside React, so the read is asked of it once a render finds the need.
  useEffect(() => {
    if (widen) list?.showMore();
  }, [list, widen]);
  const show = (workOrderId: string | null) =>
    setShowing((now) =>
      workOrderId === null ? null : now?.workOrderId === workOrderId ? now : { workOrderId, runsThen: list?.view().runs ?? null, row: null },
    );
  return { selected: showing?.workOrderId ?? null, row, unlisted, show, needRow };
}

export const GraphRunsView: FC<GraphRunsViewProps> = ({ projectPath, name, shown, runInTerminal, host = null, unsaved = [], initialRun, revisions }) => {
  const { list, view } = useRunsList(projectPath, name, shown, GRAPH_RUNS);
  const pages = useRunPages(list);
  const { selected, row, unlisted, show, needRow } = useShownRun(list, view, initialRun);
  const run = useRunStart(graphRunStarts, projectPath, name, (workOrderId) => {
    show(workOrderId);
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
        onShowRun={show}
        onOpen={pages.openPage}
      />
      {view.simulated && <SimulatedRunsNotice />}
      {selected !== null && list && (
        <GraphRunDetail
          key={selected}
          projectPath={projectPath}
          workflow={name}
          workOrderId={selected}
          row={row}
          unlisted={unlisted}
          onRowNeeded={needRow}
          shown={shown}
          runPage={list.runPage}
          runInTerminal={runInTerminal}
          revisions={revisions}
          onClose={() => show(null)}
        />
      )}
      <RunsListBody
        name={name}
        view={view}
        notice={pages.notice}
        onShowMore={() => list?.showMore()}
        onOpenInBrowser={pages.openInBrowser}
        selection={{ selected, onSelect: show }}
      />
    </section>
  );
};
