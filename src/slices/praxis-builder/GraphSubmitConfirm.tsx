// The Submit confirm dialog of a graph workflow (#444, #462) or a graph trigger (#476). It opens
// only after the host's check passed. Its body, which the caller gives, says what is sent and that
// the submission becomes a candidate the owner must admit in the browser: a graph workflow's lists
// each bundle file with its digest and an Uncommitted badge, read when it opened (`BundleFiles`).
// Once the host stores it, the dialog names the new revision and offers Open in
// browser for its admission page, through the loopback-only opener, when the host gave one. An
// unknown outcome offers Submit again, which resends the same submission by its request id.
// Focus stays inside it while it is shown (the shared `useDialogFocus` trap) and goes back to the
// form's Submit when it closes. Escape closes it.
import { useEffect, useId, useRef, useState, type FC, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ExternalLink, Send, X } from "lucide-react";
import type { Submission } from "./graphSubmit.ts";
import { openRunPage } from "./runPage.ts";
import type { GraphWorkflowBundle } from "./types.ts";
import { useDialogFocus } from "../overlay/useOverlay.ts";

const plainButton =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white";

/** A graph workflow confirm's body: what the submission becomes, and the bundle files it sends. */
export const BundleFiles: FC<{
  /** The saved bundle, read when the confirm opened. */
  bundle: GraphWorkflowBundle;
}> = ({ bundle }) => (
  <>
    <p className="text-xs">The submission becomes a candidate. Nothing runs until the owner admits it in the browser.</p>
    <section aria-label="Bundle files" className="text-xs space-y-1">
      <p className="text-[#8b949e]">Quay sends these saved files, as they are on disk:</p>
      <ul className="space-y-1">
        {bundle.files.map((f) => (
          <li key={f.file} className="space-y-0.5">
            <span className="font-mono text-[#c9d1d9] break-all">{f.path}</span>
            {f.change !== undefined && <UncommittedBadge />}
            <span className="block font-mono text-[10px] text-[#8b949e] break-all">{f.digest ?? "No digest: Quay can't read this file."}</span>
          </li>
        ))}
      </ul>
    </section>
  </>
);

/** The badge on a file the confirm lists that has changes that aren't committed. */
export const UncommittedBadge: FC = () => <span className="ml-2 px-1 rounded border border-[#9e6a03] text-[10px] text-[#e3b341]">Uncommitted</span>;

export const SubmitConfirm: FC<{
  name: string;
  /** What is sent and what the submission becomes, under the title. */
  children: ReactNode;
  /** Sends the submission, resending the one with `requestId` when given. */
  onSend: (requestId: string | null) => Promise<Submission<unknown>>;
  onClose: () => void;
  /** Where focus goes when the dialog closes: the form's Submit. */
  returnFocus: RefObject<HTMLElement | null>;
}> = ({ name, children, onSend, onClose, returnFocus }) => {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Submission<unknown> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useDialogFocus(true, rootRef, returnFocus);
  // Cancel, not the first control (Close), takes focus on open.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const send = async (requestId: string | null) => {
    if (sending) return;
    setSending(true);
    setNotice(null);
    const answer = await onSend(requestId);
    setSending(false);
    setResult(answer);
  };

  const openAdmission = async (address: string) => {
    setNotice(null);
    try {
      if (!(await openRunPage(address))) setNotice(`Quay opens only pages on this machine's Praxis host. praxis gave ${address} for ${name}.`);
    } catch (e) {
      setNotice(`Couldn't open ${name}'s admission page: ${String(e)}`);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const submitted = result?.kind === "submitted" ? result : null;
  const resend = result?.kind === "unknown" ? result.requestId : null;

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
            Submit <span className="font-mono">{name}</span> to the host
          </h3>
          <button
            type="button"
            aria-label="Close submit"
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {children}
        {sending && <p role="status" className="text-xs">Submitting…</p>}
        {submitted && (
          <p role="status" className="text-xs text-[#3fb950]">
            Submitted revision {submitted.revision} as a candidate. The owner admits or rejects it in the browser.
          </p>
        )}
        {(result?.kind === "unknown" || result?.kind === "refused") && (
          <p role="alert" className="text-xs text-[#ff7b72] break-words">
            {result.message}
          </p>
        )}
        {notice && (
          <p role="alert" className="text-xs text-[#ff7b72] break-words">
            {notice}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button ref={cancelRef} type="button" onClick={onClose} className={plainButton}>
            {submitted ? "Close" : "Cancel"}
          </button>
          {submitted?.admissionPageAddress && (
            <button type="button" onClick={() => void openAdmission(submitted.admissionPageAddress as string)} className={plainButton}>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              Open in browser
            </button>
          )}
          {!submitted && (
            <button
              type="button"
              // Not `disabled`, which would drop focus while it sends.
              aria-disabled={sending}
              onClick={() => void send(resend)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#238636] bg-[#238636] hover:bg-[#2ea043] text-xs text-white aria-disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              {result?.kind === "unknown" || result?.kind === "refused" ? "Submit again" : "Submit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
