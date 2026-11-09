// A graph workflow's state on the Praxis host, on its form (#444, #461): a status line with Check
// again, and Open in browser for a pending candidate's admission page, then the Revisions panel.
// A pending candidate has Withdraw (#463) in both, which asks the form to show its confirm. They
// draw `graphHostStatus.ts`'s view of the graph host model and never call `praxis` themselves:
// Check again and Withdraw ask the model. There is no admit, reject or retire: the owner decides
// in the browser.
import { useState, type FC } from "react";
import { ExternalLink, RefreshCw, Undo2 } from "lucide-react";
import type { GraphWorkflowHostView, WithdrawOutcome } from "./graphHost.ts";
import { graphStatusLine, revisionRows } from "./graphHostStatus.ts";
import { hostStateLook } from "./HostList.tsx";
import { useMinuteTick } from "./HostStatusLine.tsx";
import type { HostCondition } from "./praxisHost.ts";
import { hintClass, Section } from "./RecordFields.tsx";
import { openRunPage } from "./runPage.ts";

/** What the form needs to show a graph workflow's host state, check it again and withdraw a pending candidate. */
export interface GraphWorkflowHost {
  view: GraphWorkflowHostView;
  condition: HostCondition;
  /** Rereads this graph workflow only. */
  onCheckAgain: () => void;
  /** Withdraws pending candidate `revision`, and resolves once the host has been read again. */
  onWithdraw: (revision: number) => Promise<WithdrawOutcome>;
}

/** How many revisions the panel draws at first, and adds with each Show more. */
export const REVISIONS_SHOWN = 20;

const buttonClass =
  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] aria-disabled:opacity-50 shrink-0";

/** The status line under the form's header. `onWithdraw` shows the confirm for a revision. */
export const GraphHostStatusLine: FC<{ name: string; host: GraphWorkflowHost; onWithdraw: (revision: number) => void }> = ({
  name,
  host,
  onWithdraw,
}) => {
  useMinuteTick();
  const [notice, setNotice] = useState<string | null>(null);
  const line = graphStatusLine(host.view, host.condition, Date.now());
  const { Icon, toneClass } = hostStateLook(line.look, line.tone, line.muted);
  const openAdmission = async (address: string) => {
    setNotice(null);
    try {
      if (!(await openRunPage(address))) setNotice(`Quay opens only pages on this machine's Praxis host. praxis gave ${address} for ${name}.`);
    } catch (e) {
      setNotice(`Couldn't open ${name}'s admission page: ${String(e)}`);
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1.5 flex-wrap text-[11px] text-[#8b949e]">
        <span role="status" className="inline-flex items-start gap-1.5 min-w-0">
          <Icon className={`w-3.5 h-3.5 mt-px shrink-0 ${toneClass}`} aria-hidden="true" />
          <span className="min-w-0 break-words">
            <span className="sr-only">On the host: </span>
            <span className="text-[#c9d1d9]">{line.label}</span>
            {line.reason && <>. {line.reason}</>}
            {line.revision && <>. {line.revision}</>}
            {line.checked && <> · {line.checked}</>}
          </span>
        </span>
        {line.checkAgain && (
          <button
            type="button"
            // Not `disabled`, which would drop focus while the check runs.
            aria-disabled={line.checking}
            onClick={() => !line.checking && host.onCheckAgain()}
            className={buttonClass}
          >
            <RefreshCw className={`w-3 h-3 ${line.checking ? "animate-spin" : ""}`} aria-hidden="true" />
            {line.checking ? "Checking…" : "Check again"}
          </button>
        )}
        {line.admissionPage && (
          <button type="button" onClick={() => void openAdmission(line.admissionPage as string)} className={buttonClass}>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
            Open in browser
          </button>
        )}
        {line.withdraw !== null && <WithdrawButton revision={line.withdraw} onWithdraw={onWithdraw} />}
      </div>
      {notice && (
        <p role="alert" className="text-[11px] text-[#ff7b72] break-words">
          {notice}
        </p>
      )}
    </div>
  );
};

/** Withdraw for pending candidate `revision`, which shows its confirm. */
const WithdrawButton: FC<{ revision: number; onWithdraw: (revision: number) => void }> = ({ revision, onWithdraw }) => (
  <button type="button" aria-label={`Withdraw revision ${revision}`} onClick={() => onWithdraw(revision)} className={buttonClass}>
    <Undo2 className="w-3 h-3" aria-hidden="true" />
    Withdraw
  </button>
);

/**
 * The Revisions panel: the host's revisions newest first, `REVISIONS_SHOWN` at a time, with
 * Withdraw on each pending candidate. `onWithdraw` shows the confirm for a revision.
 */
export const RevisionsPanel: FC<{ view: GraphWorkflowHostView; onWithdraw: (revision: number) => void }> = ({ view, onWithdraw }) => {
  const [shown, setShown] = useState(REVISIONS_SHOWN);
  const rows = revisionRows(view);
  const more = Math.min(REVISIONS_SHOWN, rows.length - shown);
  let body;
  if (rows.length === 0) {
    const why =
      view.state.kind === "nameRefused"
        ? "Quay doesn't send praxis a name the host refuses."
        : view.checkedAt === null
          ? "Not read from the host yet."
          : "The host holds no revisions of this graph workflow.";
    body = <p className={hintClass}>{why}</p>;
  } else {
    body = (
      <>
        <table aria-label="Revisions on the host" className="w-full text-left text-xs text-[#c9d1d9]">
          <thead className="text-[10px] uppercase tracking-wider text-[#6e7681]">
            <tr>
              <th scope="col" className="py-1 pr-3 font-semibold">Revision</th>
              <th scope="col" className="py-1 pr-3 font-semibold">Status</th>
              <th scope="col" className="py-1 pr-3 font-semibold">Submitted</th>
              <th scope="col" className="py-1 pr-3 font-semibold">Decided</th>
              <th scope="col" className="py-1 pr-3 font-semibold">Current</th>
              <th scope="col" className="py-1 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((row) => (
              <tr key={row.revision} className="border-t border-[#21262d]">
                <th scope="row" className="py-1 pr-3 font-mono font-normal">{row.revision}</th>
                <td className="py-1 pr-3">{row.status}</td>
                <td className="py-1 pr-3">{row.submitted}</td>
                <td className="py-1 pr-3">{row.decided}</td>
                <td className="py-1 pr-3">{row.current ? "Current" : ""}</td>
                <td className="py-1">{row.withdrawable && <WithdrawButton revision={row.revision} onWithdraw={onWithdraw} />}</td>
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
      <p className={hintClass}>What the host holds of this graph workflow. The owner admits, rejects or retires it in the browser.</p>
      {body}
    </Section>
  );
};
