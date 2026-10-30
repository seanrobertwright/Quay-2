import React, { useEffect, useId, useRef } from "react";
import { usePopupLayer } from "../../overlay/useOverlay";

export interface ConfirmRequest {
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * Topos's own confirm dialog (#366), since Quay has no shared one: `role="alertdialog"` with focus
 * trapped between its buttons and starting on Cancel. Escape cancels it before it closes Topos.
 */
export const ConfirmDialog: React.FC<{ request: ConfirmRequest | null; onCancel: () => void }> = ({ request, onCancel }) => {
  const titleId = useId();
  const detailId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const open = request !== null;
  usePopupLayer(open, onCancel, panel);

  // Focus goes back where it was once the dialog closes.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => before?.focus();
  }, [open]);

  if (request === null) return null;

  // Focus is trapped: Tab and Shift+Tab move between the two buttons.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    (e.currentTarget === cancel.current ? confirm : cancel).current?.focus();
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        className="w-full max-w-md bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-4 flex flex-col gap-3"
      >
        <h3 id={titleId} className="text-sm font-semibold text-white">
          {request.title}
        </h3>
        <p id={detailId} className="text-xs text-[#8b949e] break-words">
          {request.detail}
        </p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancel}
            type="button"
            onClick={onCancel}
            onKeyDown={onKeyDown}
            className="px-3 py-1.5 rounded-md text-xs text-[#c9d1d9] hover:bg-[#21262d] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
          >
            Cancel
          </button>
          <button
            ref={confirm}
            type="button"
            onKeyDown={onKeyDown}
            onClick={() => {
              onCancel();
              request.onConfirm();
            }}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
