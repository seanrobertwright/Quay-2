// The confirm for one write to the Praxis host that a person must confirm first (#463, #477): a
// withdrawal of a graph workflow or graph trigger candidate, or a graph trigger's disabling or
// retirement. Its primary button sends the write, and the confirm closes once the host has been
// read again. A refusal stays in it in the host's words with the button withheld, since the host
// said no; an outcome praxis couldn't confirm stays too and may be sent again. It is a
// `ConfirmDialog`, so focus stays inside it while it is shown and goes back to the control that
// opened it, or to `returnFocus` once that is gone. Escape closes it.
import { useEffect, useId, useRef, useState, type FC, type ReactNode, type RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import type { WriteOutcome } from "./praxisHost.ts";

export const WriteConfirm: FC<{
  title: ReactNode;
  closeLabel: string;
  label: string;
  icon: LucideIcon;
  /** What the confirm says while the write is sent. */
  sending: string;
  /** Sends the write, and resolves once the host has been read again. */
  onSend: () => Promise<WriteOutcome>;
  onClose: () => void;
  /** Where focus goes when the confirm closes and the control that opened it is gone. */
  returnFocus: RefObject<HTMLElement | null>;
  /** A reason of the confirm's own to withhold the button, with the id of the text that says why. */
  withheld?: { why: string } | null;
  children: ReactNode;
}> = ({ title, closeLabel, label, icon, sending: sendingText, onSend, onClose, returnFocus, withheld, children }) => {
  const outcomeId = useId();
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Exclude<WriteOutcome, { kind: "done" }> | null>(null);
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
