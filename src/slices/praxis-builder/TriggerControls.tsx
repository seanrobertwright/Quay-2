// The controls any session may use on a graph trigger, on its form (#469, #477): Withdraw for the
// newest pending candidate, Disable for a trigger the host has enabled, and Retire for one it holds
// an active revision of, each behind a confirm, and Enable in browser for a disabled one. They draw
// the trigger host model's view and never call `praxis` themselves: each confirm asks the trigger
// control model, and closes once the host has been read again. There is no enable, admit or
// reject: the owner decides in the browser, and Enable in browser opens the current revision's
// review page there through the loopback-only opener.
import { useEffect, useId, useRef, useState, type FC, type ReactNode, type RefObject } from "react";
import { Archive, CirclePause, ExternalLink, TriangleAlert, Undo2, type LucideIcon } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import type { ControlOutcome, TriggerControlActions } from "./triggerControl.ts";
import type { GraphTriggerHostView } from "./triggerHost.ts";
import { openRunPage } from "./runPage.ts";

const buttonClass =
  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] aria-disabled:opacity-50 shrink-0";

/** Which confirm is shown. */
type Shown = { kind: "withdraw"; revision: number } | { kind: "disable" } | { kind: "retire"; revision: number };

/** The newest pending candidate the host lists, or null. Revisions are newest first. */
const pendingRevision = (view: GraphTriggerHostView) => view.revisions.find((r) => r.status === "CANDIDATE")?.revision ?? null;

/** The trigger form's controls for graph trigger `name`, and the confirm one of them opened. */
export const TriggerControlBar: FC<{ name: string; view: GraphTriggerHostView; actions: TriggerControlActions }> = ({ name, view, actions }) => {
  const [shown, setShown] = useState<Shown | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set on unmount, so a page found after the form closed opens nothing.
  const gone = useRef(false);
  useEffect(
    () => () => {
      gone.current = true;
    },
    [],
  );
  // Where focus goes when a confirm closes and the control that opened it is gone.
  const returnFocus = useRef<HTMLDivElement | null>(null);
  const candidate = pendingRevision(view);
  // The host's enabled state of an active trigger with a current revision; null otherwise.
  const enabled = view.hostEnabled;
  if (candidate === null && enabled === null && shown === null && notice === null) return null;

  /** Enable in browser: finds the current revision's review page and opens it through the loopback-only opener. */
  const openReviewPage = async (revision: number) => {
    setNotice(null);
    const page = await actions.reviewPage(revision);
    if (gone.current) return;
    if (page.kind === "problem") {
      setNotice(`Couldn't find ${name}'s review page: ${page.message}`);
      return;
    }
    try {
      if (!(await openRunPage(page.address))) setNotice(`Quay opens only pages on this machine's Praxis host. praxis gave ${page.address} for ${name}.`);
    } catch (e) {
      if (!gone.current) setNotice(`Couldn't open ${name}'s review page: ${String(e)}`);
    }
  };
  return (
    <div ref={returnFocus} tabIndex={-1} role="group" aria-label={`Controls for ${name} on the host`} className="flex items-start gap-1.5 flex-wrap text-[11px] focus:outline-none">
      {candidate !== null && (
        <button type="button" aria-label={`Withdraw revision ${candidate}`} onClick={() => setShown({ kind: "withdraw", revision: candidate })} className={buttonClass}>
          <Undo2 className="w-3 h-3" aria-hidden="true" />
          Withdraw
        </button>
      )}
      {enabled === true && (
        <button type="button" onClick={() => setShown({ kind: "disable" })} className={buttonClass}>
          <CirclePause className="w-3 h-3" aria-hidden="true" />
          Disable
        </button>
      )}
      {shown?.kind === "disable" && (
        <ControlConfirm
          title={
            <>
              Disable <span className="font-mono">{name}</span>?
            </>
          }
          closeLabel="Close disable"
          label="Disable"
          icon={CirclePause}
          sending={`Disabling ${name}…`}
          onSend={() => actions.disable()}
          onClose={() => setShown(null)}
          returnFocus={returnFocus}
        >
          <p className="text-xs">
            New fires stop: from when the host takes the request, <span className="font-mono">{name}</span> starts no new runs. Runs it
            started already go on. Only the owner can enable it again, in the browser. Disabling it on the host doesn&apos;t change its
            saved file.
          </p>
        </ControlConfirm>
      )}
      {enabled === false && view.current !== null && (
        <button type="button" onClick={() => view.current && void openReviewPage(view.current.revision)} className={buttonClass}>
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          Enable in browser
        </button>
      )}
      {enabled !== null && view.current !== null && (
        <button type="button" onClick={() => view.current && setShown({ kind: "retire", revision: view.current.revision })} className={buttonClass}>
          <Archive className="w-3 h-3" aria-hidden="true" />
          Retire
        </button>
      )}
      {shown?.kind === "retire" && (
        <RetireConfirm name={name} revision={shown.revision} onRetire={() => actions.retire()} onClose={() => setShown(null)} returnFocus={returnFocus} />
      )}
      {shown?.kind === "withdraw" && (
        <ControlConfirm
          title={
            <>
              Withdraw revision {shown.revision} of <span className="font-mono">{name}</span>?
            </>
          }
          closeLabel="Close withdraw"
          label="Withdraw"
          icon={Undo2}
          sending={`Withdrawing revision ${shown.revision}…`}
          onSend={() => actions.withdraw(shown.revision)}
          onClose={() => setShown(null)}
          returnFocus={returnFocus}
        >
          <p className="text-xs">
            Revision {shown.revision} is waiting for the owner to admit it. The owner can no longer admit revision {shown.revision}. The host
            keeps it in the history as withdrawn, and <span className="font-mono">{name}</span> falls back to its admitted revision&apos;s
            state, or to Not submitted when it has none.
          </p>
        </ControlConfirm>
      )}
      {notice && (
        <p role="alert" className="basis-full text-[11px] text-[#ff7b72] break-words">
          {notice}
        </p>
      )}
    </div>
  );
};

/**
 * Retire's confirm, stronger than the others: it says retiring can't be undone, and Retire is
 * withheld until the person ticks that they understand. praxis sends no revision with it, so it
 * says the host retires the trigger as it stands, which may not be the revision Quay shows.
 */
const RetireConfirm: FC<{
  name: string;
  /** The current revision the form shows. */
  revision: number;
  onRetire: () => Promise<ControlOutcome>;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}> = ({ name, revision, onRetire, onClose, returnFocus }) => {
  const [understood, setUnderstood] = useState(false);
  const whyId = useId();
  return (
    <ControlConfirm
      title={
        <>
          Retire <span className="font-mono">{name}</span>? This can&apos;t be undone.
        </>
      }
      closeLabel="Close retire"
      label="Retire"
      icon={Archive}
      sending={`Retiring ${name}…`}
      onSend={onRetire}
      onClose={onClose}
      returnFocus={returnFocus}
      withheld={understood ? null : { why: whyId }}
    >
      <p className="flex items-start gap-1.5 rounded-md border border-[#da3633] bg-[#da3633]/10 p-2 text-xs text-[#ffa198]">
        <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
        <span>
          Retiring can&apos;t be undone. No one can bring revision {revision} back, in Quay or in the browser: a retired trigger fires
          nothing, and fires again only if the owner admits a later revision.
        </span>
      </p>
      <p className="text-xs">
        The host retires <span className="font-mono">{name}</span> as it stands when the request lands, which may not be revision{" "}
        {revision} shown here: praxis sends no revision for the host to check it against.
      </p>
      <label className="flex items-start gap-1.5 text-xs">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5" />
        <span>I understand that retiring {name} can&apos;t be undone</span>
      </label>
      {!understood && (
        <p id={whyId} className="text-[11px] text-[#8b949e]">
          Tick the box above to retire {name}.
        </p>
      )}
    </ControlConfirm>
  );
};

/**
 * One control's confirm. Its primary button sends the control, and the confirm closes once the
 * host has been read again. A refusal stays in it in the host's words with the button withheld,
 * since the host said no; an outcome praxis couldn't confirm stays too and may be sent again.
 * `withheld` gives a reason of the confirm's own to withhold the button, with the id of the text
 * that says why.
 */
const ControlConfirm: FC<{
  title: ReactNode;
  closeLabel: string;
  label: string;
  icon: LucideIcon;
  /** What the confirm says while the control is sent. */
  sending: string;
  onSend: () => Promise<ControlOutcome>;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  withheld?: { why: string } | null;
  children: ReactNode;
}> = ({ title, closeLabel, label, icon, sending: sendingText, onSend, onClose, returnFocus, withheld, children }) => {
  const outcomeId = useId();
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Exclude<ControlOutcome, { kind: "done" }> | null>(null);
  // Set on unmount, so an answer that lands after the confirm closed changes nothing.
  const closed = useRef(false);
  useEffect(
    () => () => {
      closed.current = true;
    },
    [],
  );

  const send = async () => {
    setSending(true);
    setOutcome(null);
    const result = await onSend();
    if (closed.current) return;
    if (result.kind === "done") {
      onClose();
      return;
    }
    setSending(false);
    setOutcome(result);
  };

  return (
    <ConfirmDialog
      title={title}
      closeLabel={closeLabel}
      action={{
        label,
        icon,
        tone: "danger",
        withheld: sending || outcome?.kind === "refused" || Boolean(withheld),
        describedBy: outcome ? outcomeId : withheld ? withheld.why : undefined,
        onConfirm: () => void send(),
      }}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {children}
      {sending && (
        <p role="status" className="text-xs">
          {sendingText}
        </p>
      )}
      {outcome && (
        <p id={outcomeId} role="alert" className={`text-xs break-words ${outcome.kind === "refused" ? "text-[#ff7b72]" : "text-[#e3b341]"}`}>
          {outcome.message}
        </p>
      )}
    </ConfirmDialog>
  );
};
