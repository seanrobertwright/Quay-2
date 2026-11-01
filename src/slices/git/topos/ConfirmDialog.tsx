import React, { useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus, usePopupLayer } from "../../overlay/useOverlay";
import { ToposModalContext } from "./ToposModal";
import { confirmButtonClass, type ConfirmPrompt } from "./confirmStyle";

/** What a dialog with a text field or a choice collects. */
export interface DialogValues {
  checked: boolean;
  /** The text field's value, or "" when there is none. */
  text: string;
  /** The chosen option's value, or "" when there is no choice. */
  choice: string;
  /** The message field's value, or "" when there is none. */
  message: string;
}

export interface ConfirmRequest extends ConfirmPrompt {
  /** A checkbox that widens what the confirm does; it starts as `initial`. */
  checkbox?: { label: string; initial: boolean };
  /** A text field, such as a new branch's name. Focus starts in it rather than on Cancel. */
  field?: { label: string; initial: string };
  /** A multi-line field under the text field, such as a tag's optional message. */
  message?: { label: string };
  /** A choice among `options`, such as the branch to check out. Focus starts on it. */
  choice?: { label: string; options: { value: string; label: string }[] };
  /** Runs on confirm, after the dialog closes, with the checkbox's state (false when there is none). */
  onConfirm?: (checked: boolean) => void;
  /**
   * Runs on confirm in place of `onConfirm` while the dialog stays open. It resolves to null to
   * close the dialog, or to a reason shown inline, such as git refusing a branch name.
   */
  onSubmit?: (values: DialogValues) => Promise<string | null>;
}

/**
 * Topos's own dialog (#366, #393, #394), since Quay has no shared one: `role="alertdialog"` with focus
 * trapped inside it and starting on Cancel, the safe choice, or in its text field or choice when
 * it asks for one. Inside Topos it is modal across the whole panel (#421): it draws in the modal
 * layer's host and the rest of Topos is inert while it is open. Escape cancels it before it closes
 * Topos, and on close focus goes back to what opened it.
 */
export const ConfirmDialog: React.FC<{ request: ConfirmRequest | null; onCancel: () => void }> = ({ request, onCancel }) => {
  const titleId = useId();
  const detailId = useId();
  const checkboxId = useId();
  const fieldId = useId();
  const choiceId = useId();
  const messageId = useId();
  const errorId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const open = request !== null;
  const [checked, setChecked] = useState(false);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // While a submit runs, Cancel and Escape wait for it, so its refusal has somewhere to show.
  const cancelUnlessPending = () => {
    if (!pending) onCancel();
  };
  // First of the dialog's effects, so it notes the opener before the inert content can blur it, and
  // on close makes the content live again before focus goes back to it.
  const modal = useContext(ToposModalContext);
  const layer = modal?.layer ?? null;
  useEffect(() => {
    if (!open || layer === null) return;
    return layer.open(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }, [open, layer]);
  usePopupLayer(open, cancelUnlessPending, panel);
  useDialogFocus(open, panel);
  // A checkbox comes before the buttons, so focus is moved to Cancel once the dialog opens, or into
  // the field or choice it asks for. The buttons are only aria-disabled while a submit runs, so
  // focus stays on them.
  useEffect(() => {
    if (!open) return;
    if (input.current) input.current.select();
    else if (select.current) select.current.focus();
    else cancel.current?.focus();
  }, [open, request]);
  const initial = request?.checkbox?.initial ?? false;
  useEffect(() => setChecked(initial), [request, initial]);
  useEffect(() => {
    setText(request?.field?.initial ?? "");
    setChoice(request?.choice?.options[0]?.value ?? "");
    setMessage("");
    setError(null);
    setPending(false);
  }, [request]);

  if (request === null) return null;

  const confirm = () => {
    const confirmed = request.checkbox ? checked : false;
    if (request.onSubmit) {
      if (pending) return;
      setPending(true);
      setError(null);
      void request.onSubmit({ checked: confirmed, text, choice, message }).then(
        (reason) => {
          setPending(false);
          if (reason === null) onCancel();
          else setError(reason);
        },
        (e: unknown) => {
          setPending(false);
          setError(String(e));
        }
      );
      return;
    }
    onCancel();
    request.onConfirm?.(confirmed);
  };

  const dialog = (
    // A press on the dimmed backdrop keeps focus in the dialog rather than moving it to Topos's panel.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only guard; keys stay in the dialog's trap
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        aria-busy={pending}
        className="w-full max-w-md bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-4 flex flex-col gap-3"
      >
        <h3 id={titleId} className="text-sm font-semibold text-white">
          {request.title}
        </h3>
        <p id={detailId} className="text-xs text-[#8b949e] break-words">
          {request.detail}
        </p>
        {request.field && (
          <div className="flex flex-col gap-1">
            <label htmlFor={fieldId} className="text-xs text-[#c9d1d9]">
              {request.field.label}
            </label>
            <input
              ref={input}
              id={fieldId}
              type="text"
              value={text}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={error !== null}
              aria-describedby={error === null ? undefined : errorId}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                confirm();
              }}
              className="px-2 py-1 rounded border border-[#30363d] bg-[#0d1117] text-xs text-white font-mono focus:outline-none focus:border-[#06B6D4]"
            />
          </div>
        )}
        {request.message && (
          <div className="flex flex-col gap-1">
            <label htmlFor={messageId} className="text-xs text-[#c9d1d9]">
              {request.message.label}
            </label>
            <textarea
              id={messageId}
              value={message}
              rows={4}
              spellCheck={false}
              onChange={(e) => setMessage(e.target.value)}
              className="px-2 py-1 rounded border border-[#30363d] bg-[#0d1117] text-xs text-white font-mono resize-y focus:outline-none focus:border-[#06B6D4]"
            />
          </div>
        )}
        {request.choice && (
          <div className="flex flex-col gap-1">
            <label htmlFor={choiceId} className="text-xs text-[#c9d1d9]">
              {request.choice.label}
            </label>
            <select
              ref={select}
              id={choiceId}
              value={choice}
              aria-invalid={error !== null}
              aria-describedby={error === null ? undefined : errorId}
              onChange={(e) => setChoice(e.target.value)}
              className="px-2 py-1 rounded border border-[#30363d] bg-[#0d1117] text-xs text-white focus:outline-none focus:border-[#06B6D4]"
            >
              {request.choice.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {request.checkbox && (
          <div className="flex items-center gap-2 text-xs text-[#c9d1d9]">
            <input id={checkboxId} type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="accent-[#f85149]" />
            <label htmlFor={checkboxId}>{request.checkbox.label}</label>
          </div>
        )}
        {error !== null && (
          <p id={errorId} role="alert" className="text-xs text-[#f85149] break-words">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            ref={cancel}
            type="button"
            onClick={cancelUnlessPending}
            aria-disabled={pending}
            className="px-3 py-1.5 rounded-md text-xs text-[#c9d1d9] hover:bg-[#21262d] aria-disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            aria-disabled={pending}
            className={confirmButtonClass(request.destructive === true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
  return modal?.host ? createPortal(dialog, modal.host) : dialog;
};
