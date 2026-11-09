// A graph trigger's state on the Praxis host, on its form (#469, #475): a status line with Check
// again, Open in browser for a pending candidate's admission page, and a note when the host's
// enabled state differs from the saved file's, then the Revisions panel. They draw
// `triggerHostStatus.ts`'s view of the trigger host model and never call `praxis` themselves:
// Check again asks the model. There is no admit, reject or enable: the owner decides in the browser.
import { useState, type FC } from "react";
import { HostStateLine, REVISIONS_SHOWN } from "./GraphHostPanel.tsx";
import { useMinuteTick } from "./HostStatusLine.tsx";
import type { HostCondition } from "./praxisHost.ts";
import { hintClass, Section } from "./RecordFields.tsx";
import type { TriggerControlActions } from "./triggerControl.ts";
import type { GraphTriggerHostView } from "./triggerHost.ts";
import { triggerRevisionRows, triggerStatusLine } from "./triggerHostStatus.ts";

/** What the trigger form needs to show a graph trigger's host state and check it again. */
export interface GraphTriggerHost {
  view: GraphTriggerHostView;
  condition: HostCondition;
  /** Rereads this graph trigger only. */
  onCheckAgain: () => void;
  /** Withdraw, Disable and Retire (#477); absent where the builder offers none. */
  control?: TriggerControlActions;
}

/** The status line under the trigger form's header. */
export const TriggerHostStatusLine: FC<{ name: string; host: GraphTriggerHost }> = ({ name, host }) => {
  useMinuteTick();
  const line = triggerStatusLine(host.view, host.condition, Date.now());
  return <HostStateLine name={name} line={line} onCheckAgain={host.onCheckAgain} note={line.enabledNote} />;
};

/** The Revisions panel: the host's revisions of the graph trigger newest first, `REVISIONS_SHOWN` at a time. */
export const TriggerRevisionsPanel: FC<{ view: GraphTriggerHostView }> = ({ view }) => {
  const [shown, setShown] = useState(REVISIONS_SHOWN);
  const rows = triggerRevisionRows(view);
  const more = Math.min(REVISIONS_SHOWN, rows.length - shown);
  let body;
  if (rows.length === 0) {
    const why =
      view.state.kind === "nameRefused"
        ? "Quay doesn't send praxis a name the host refuses."
        : view.checkedAt === null
          ? "Not read from the host yet."
          : "The host holds no revisions of this trigger.";
    body = <p className={hintClass}>{why}</p>;
  } else {
    body = (
      <>
        <table aria-label="Revisions on the host" className="w-full text-left text-xs text-[#c9d1d9]">
          <thead className="text-[10px] uppercase tracking-wider text-[#6e7681]">
            <tr>
              <th scope="col" className="py-1 pr-3 font-semibold">Revision</th>
              <th scope="col" className="py-1 pr-3 font-semibold">Status</th>
              <th scope="col" className="py-1 pr-3 font-semibold">Based on</th>
              <th scope="col" className="py-1 pr-3 font-semibold">Submitted</th>
              <th scope="col" className="py-1 font-semibold">Current</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((row) => (
              <tr key={row.revision} className="border-t border-[#21262d]">
                <th scope="row" className="py-1 pr-3 font-mono font-normal">{row.revision}</th>
                <td className="py-1 pr-3">{row.status}</td>
                <td className="py-1 pr-3">{row.base}</td>
                <td className="py-1 pr-3">{row.submitted}</td>
                <td className="py-1">{row.current ? "Current" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {more > 0 && (
          <button type="button" onClick={() => setShown((n) => n + REVISIONS_SHOWN)} className="text-xs text-[#58a6ff] hover:underline">
            Show {more} more
          </button>
        )}
        {view.olderRevisions && rows.length <= shown && <p className={hintClass}>The host holds older revisions than these.</p>}
      </>
    );
  }
  return (
    <Section title="Revisions">
      <p className={hintClass}>What the host holds of this trigger. The owner admits, rejects or enables it in the browser.</p>
      {body}
    </Section>
  );
};
