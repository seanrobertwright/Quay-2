// The frame both Run confirm dialogs draw in (#454, #466): a `ConfirmDialog` titled with the
// name, holding the dialog's own facts, its warnings, and why Start run is withheld, with Cancel
// and Start run. Focus goes back to the Runs header's Run when the dialog closes.
import { useId, type FC, type ReactNode, type RefObject } from "react";
import { Play, TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

export const RunConfirmFrame: FC<{
  name: string;
  /** Start run is withheld: while the host is read again, or for `refusal`. */
  withheld: boolean;
  /** Why Start run is withheld, once the host's answer is in. */
  refusal: string | null;
  warnings: readonly { key: string; text: string }[];
  /** Drawn under the warnings, such as Install on host…; only while there are warnings. */
  warningActions?: ReactNode;
  onRun: () => void;
  onClose: () => void;
  /** Where focus goes when the dialog closes: the Runs header's Run. */
  returnFocus: RefObject<HTMLElement | null>;
  /** The dialog's own facts, between the title and the warnings. */
  children: ReactNode;
}> = ({ name, withheld, refusal, warnings, warningActions, onRun, onClose, returnFocus, children }) => {
  const refusalId = useId();
  return (
    <ConfirmDialog
      title={
        <>
          Run <span className="font-mono">{name}</span> on the host
        </>
      }
      closeLabel="Close run"
      action={{ label: "Start run", icon: Play, tone: "go", withheld, describedBy: refusal ? refusalId : undefined, onConfirm: onRun }}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {children}
      {warnings.length > 0 && (
        <section aria-label="Warnings" className="space-y-1">
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li key={w.key} className="flex items-start gap-1.5 text-xs text-[#e3b341]">
                <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  <span className="sr-only">Warning: </span>
                  {w.text}
                </span>
              </li>
            ))}
          </ul>
          {warningActions}
        </section>
      )}
      {refusal && (
        <p id={refusalId} className="text-xs text-[#ff7b72]">
          {refusal}
        </p>
      )}
    </ConfirmDialog>
  );
};
