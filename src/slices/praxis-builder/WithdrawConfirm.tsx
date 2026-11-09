// The Withdraw confirm dialog for a pending graph workflow candidate (#444, #463). A decision-free
// session may withdraw any pending candidate, so Quay asks first: the dialog names the revision
// and says the owner can no longer admit it. Withdraw asks the graph host model, which rereads the
// graph workflow once the host has answered; the dialog closes when that read is in. A refusal or
// an outcome praxis couldn't confirm stays in the dialog in its own words. After a refusal
// Withdraw is withheld, since the host said no; after an unconfirmed one it may be pressed again.
// Focus stays inside it while it is shown (the shared `useDialogFocus` trap) and goes back to the
// Withdraw that opened it, or to `returnFocus` once that is gone. Escape closes it.
import { useEffect, useId, useRef, useState, type FC, type KeyboardEvent, type RefObject } from "react";
import { Undo2, X } from "lucide-react";
import type { WithdrawOutcome } from "./graphHost.ts";
import { useDialogFocus } from "../overlay/useOverlay.ts";

export const WithdrawConfirm: FC<{
  name: string;
  revision: number;
  /** Withdraws the revision, and resolves once the host has been read again. */
  onWithdraw: (revision: number) => Promise<WithdrawOutcome>;
  onClose: () => void;
  /** Where focus goes when the dialog closes and the Withdraw that opened it is gone. */
  returnFocus: RefObject<HTMLElement | null>;
}> = ({ name, revision, onWithdraw, onClose, returnFocus }) => {
  const titleId = useId();
  const outcomeId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
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

  useDialogFocus(true, rootRef, returnFocus);
  // Cancel, not the first control (Close), takes focus on open.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const withheld = sending || outcome?.kind === "refused";
  const send = async () => {
    if (withheld) return;
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

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-6">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a modal dialog owns Escape and its focus trap; every control inside it is native */}
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="max-w-xl w-full max-h-full overflow-y-auto rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-2xl text-[#c9d1d9] space-y-3"
      >
        <div className="flex items-center gap-2">
          <h3 id={titleId} className="text-sm font-semibold text-white min-w-0 break-all">
            Withdraw revision {revision} of <span className="font-mono">{name}</span>?
          </h3>
          <button
            type="button"
            aria-label="Close withdraw"
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
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
        <div className="flex justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            // Not `disabled`, which would drop focus; a refusal is shown and described.
            aria-disabled={withheld}
            aria-describedby={outcome ? outcomeId : undefined}
            onClick={() => void send()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#da3633] bg-[#da3633] hover:bg-[#f85149] text-xs text-white aria-disabled:opacity-40"
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
};
