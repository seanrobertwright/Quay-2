// The shell the Praxis Builder's confirm dialogs share (Run, Withdraw): a modal dialog over the
// builder with a title, an icon-only Close, the confirm's own body, and a Cancel and a primary
// button. Focus stays inside it while it is shown (the shared `useDialogFocus` trap), Cancel takes
// focus when it opens, and focus goes back to `returnFocus` when it closes. Escape closes it.
import { useEffect, useId, useRef, type FC, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { X, type LucideIcon } from "lucide-react";
import { useDialogFocus } from "../overlay/useOverlay.ts";

const TONE = {
  go: "border-[#238636] bg-[#238636] hover:bg-[#2ea043]",
  danger: "border-[#da3633] bg-[#da3633] hover:bg-[#f85149]",
} as const;

/** The primary button. While `withheld` it is marked `aria-disabled` and pressing it does nothing. */
export interface ConfirmAction {
  label: string;
  icon: LucideIcon;
  tone: keyof typeof TONE;
  withheld: boolean;
  /** The id of the text that says why the action is withheld or what happened, when there is one. */
  describedBy?: string;
  onConfirm: () => void;
}

export const ConfirmDialog: FC<{
  title: ReactNode;
  /** The Close button's accessible name. */
  closeLabel: string;
  action: ConfirmAction;
  onClose: () => void;
  /** Where focus goes when the dialog closes. */
  returnFocus: RefObject<HTMLElement | null>;
  children: ReactNode;
}> = ({ title, closeLabel, action, onClose, returnFocus, children }) => {
  const titleId = useId();
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

  const Icon = action.icon;
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
            {title}
          </h3>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {children}
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
            aria-disabled={action.withheld}
            aria-describedby={action.describedBy}
            onClick={() => !action.withheld && action.onConfirm()}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${TONE[action.tone]} text-xs text-white aria-disabled:opacity-40`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {action.label}
          </button>
        </div>
      </div>
    </div>
  );
};
