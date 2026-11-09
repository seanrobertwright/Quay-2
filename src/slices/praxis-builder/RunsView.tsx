// A workflow template's Runs view (#362, #452): the template's runs on the Praxis host, newest
// first, polled through the runs list model while the view is on screen. Decisions on a run are
// made only in the host's browser page, so a run that needs a person offers Open in browser and
// nothing else. Show opens a run's detail (#453) above the list, followed while it is shown. Run
// in the header starts a run of the host's installed copy after a confirm (#454): a created run is
// selected and followed, and every other outcome gets a notice of its own.
import { useState, type FC } from "react";
import type { TemplateHost } from "./HostStatusLine.tsx";
import type { JsonObject } from "./model.ts";
import type { RunInTerminal } from "./praxisHost.ts";
import { RunConfirm } from "./RunConfirm.tsx";
import { RunControl } from "./RunControl.tsx";
import { RunDetail } from "./RunDetail.tsx";
import { RunsListBody, SimulatedRunsNotice } from "./RunsListBody.tsx";
import { runRefusedBy, runStarts } from "./runStart.ts";
import type { GitChange } from "./types.ts";
import { useRunPages } from "./useRunPages.ts";
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
  const pages = useRunPages(list);
  // The `workOrderId` of the run whose detail is shown, if any.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRow = view.runs?.find((r) => r.workOrderId === selected) ?? null;
  const run = useRunStart(runStarts, projectPath, name, (workOrderId) => {
    setSelected(workOrderId);
    list?.refresh();
  });

  return (
    <section aria-label={`Runs of ${name}`} className="space-y-3">
      <RunControl
        name={name}
        run={run}
        refusedBy={host ? runRefusedBy(host.view.state) : null}
        confirm={(dialog) => (
          <RunConfirm
            name={name}
            host={host}
            unsaved={unsaved}
            changed={changed}
            onInstall={
              onInstall &&
              (() => {
                dialog.onClose();
                onInstall();
              })
            }
            {...dialog}
          />
        )}
        onStart={pages.clearNotice}
        onShowRun={setSelected}
        onOpen={pages.openPage}
      />
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
        notice={pages.notice}
        onShowMore={() => list?.showMore()}
        onOpenInBrowser={pages.openInBrowser}
        selection={{ selected, onSelect: setSelected }}
      />
    </section>
  );
};
