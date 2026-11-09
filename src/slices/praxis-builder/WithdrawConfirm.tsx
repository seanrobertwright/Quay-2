// The Withdraw confirm for a pending candidate of a graph workflow (#444, #463) or a graph trigger
// (#477). A decision-free session may withdraw any pending candidate, so Quay asks first: the
// confirm names the revision and says the owner can no longer admit it. It is a `WriteConfirm`:
// Withdraw asks the host model, which rereads the definition once the host has answered, and the
// confirm closes when that read is in.
import type { FC, RefObject } from "react";
import { Undo2 } from "lucide-react";
import type { WriteOutcome } from "./praxisHost.ts";
import { WriteConfirm } from "./WriteConfirm.tsx";

export const WithdrawConfirm: FC<{
  name: string;
  revision: number;
  /** Withdraws the revision, and resolves once the host has been read again. */
  onWithdraw: (revision: number) => Promise<WriteOutcome>;
  onClose: () => void;
  /** Where focus goes when the confirm closes and the Withdraw that opened it is gone. */
  returnFocus: RefObject<HTMLElement | null>;
}> = ({ name, revision, onWithdraw, onClose, returnFocus }) => (
  <WriteConfirm
    title={
      <>
        Withdraw revision {revision} of <span className="font-mono">{name}</span>?
      </>
    }
    closeLabel="Close withdraw"
    label="Withdraw"
    icon={Undo2}
    sending={`Withdrawing revision ${revision}…`}
    onSend={() => onWithdraw(revision)}
    onClose={onClose}
    returnFocus={returnFocus}
  >
    <p className="text-xs">
      Revision {revision} is waiting for the owner to admit it. The owner can no longer admit revision {revision}. The host keeps it in
      the history as withdrawn, and <span className="font-mono">{name}</span> falls back to its admitted revision&apos;s state, or to
      Not submitted when it has none.
    </p>
  </WriteConfirm>
);
