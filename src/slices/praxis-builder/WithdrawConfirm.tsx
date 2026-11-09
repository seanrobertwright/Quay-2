// The Withdraw confirm dialog for a pending graph workflow candidate (#444, #463). A decision-free
// session may withdraw any pending candidate, so Quay asks first: the dialog names the revision
// and says the owner can no longer admit it. Withdraw asks the graph host model, which rereads the
// graph workflow once the host has answered; the dialog closes when that read is in. A refusal or
// an outcome praxis couldn't confirm stays in the dialog in its own words. After a refusal
// Withdraw is withheld, since the host said no; after an unconfirmed one it may be pressed again.
// It is a `ConfirmDialog`, so focus stays inside it while it is shown and goes back to the Withdraw
// that opened it, or to `returnFocus` once that is gone. Escape closes it.
import { useEffect, useId, useRef, useState, type FC, type RefObject } from "react";
import { Undo2 } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import type { WithdrawOutcome } from "./graphHost.ts";

export const WithdrawConfirm: FC<{
  name: string;
  revision: number;
  /** Withdraws the revision, and resolves once the host has been read again. */
  onWithdraw: (revision: number) => Promise<WithdrawOutcome>;
  onClose: () => void;
  /** Where focus goes when the dialog closes and the Withdraw that opened it is gone. */
  returnFocus: RefObject<HTMLElement | null>;
}> = ({ name, revision, onWithdraw, onClose, returnFocus }) => {
  const outcomeId = useId();
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Exclude<WithdrawOutcome, { kind: "withdrawn" }> | null>(null);
  // Set on unmount, so an answer that lands after the dialog closed changes nothing.
  const closed = useRef(false);
  useEffect(
    () => () => {
      closed.current = true;
    },
    [],
  );

  const withheld = sending || outcome?.kind === "refused";
  const send = async () => {
    setSending(true);
    setOutcome(null);
    const result = await onWithdraw(revision);
    if (closed.current) return;
    if (result.kind === "withdrawn") {
      onClose();
      return;
    }
    setSending(false);
    setOutcome(result);
  };

  return (
    <ConfirmDialog
      title={
        <>
          Withdraw revision {revision} of <span className="font-mono">{name}</span>?
        </>
      }
      closeLabel="Close withdraw"
      action={{ label: "Withdraw", icon: Undo2, tone: "danger", withheld, describedBy: outcome ? outcomeId : undefined, onConfirm: () => void send() }}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <p className="text-xs">
        Revision {revision} is waiting for the owner to admit it. The owner can no longer admit revision {revision}. The host keeps it
        in the history as withdrawn, and <span className="font-mono">{name}</span> falls back to its admitted revision&apos;s state, or to
        Not submitted when it has none.
      </p>
      {sending && (
        <p role="status" className="text-xs">
          Withdrawing revision {revision}…
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
