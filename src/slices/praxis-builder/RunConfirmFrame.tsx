// The frame both Run confirm dialogs draw in (#454, #466): the title and Close, the dialog's own
// facts, its warnings, why Start run is withheld, and Cancel and Start run. Focus stays inside it
// while it is shown (the shared `useDialogFocus` trap), Cancel takes it on open, and it goes back
// to the Runs header's Run when the dialog closes. Escape closes it.
import { useEffect, useId, useRef, type FC, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Play, TriangleAlert, X } from "lucide-react";
import { useDialogFocus } from "../overlay/useOverlay.ts";

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
  const titleId = useId();
  const refusalId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useDialogFocus(true, rootRef, returnFocus);
  // Cancel, not the first control (Close), takes focus on open.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

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
            Run <span className="font-mono">{name}</span> on the host
          </h3>
          <button
            type="button"
            aria-label="Close run"
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
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
            // Not `disabled`, which would drop focus; the reason is shown and described.
            aria-disabled={withheld}
            aria-describedby={refusal ? refusalId : undefined}
            onClick={() => !withheld && onRun()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#238636] bg-[#238636] hover:bg-[#2ea043] text-xs text-white aria-disabled:opacity-40"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            Start run
          </button>
        </div>
      </div>
    </div>
  );
};
