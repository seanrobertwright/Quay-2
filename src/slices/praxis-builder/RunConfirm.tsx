// The Run confirm dialog (#362, #454). It says that the host's installed copy runs, not the file in
// the project, and names that copy's revision and digest. Opening it asks the host catalog for one
// fresh `workflows show`, which also refreshes the template's host state everywhere it is shown,
// and Run waits for that answer. It warns when the saved file differs from the host's copy, when
// the host doesn't have the template or can't run it, and when the template has unsaved or
// uncommitted edits, and offers Install on host… beside the warnings. Focus stays inside it while
// it is shown (the shared `useDialogFocus` trap) and goes back to the Runs view's Run when it
// closes. Escape closes it.
import { useEffect, useId, useRef, type FC, type KeyboardEvent, type RefObject } from "react";
import { Download, Play, TriangleAlert, X } from "lucide-react";
import { HostStatusLine, type TemplateHost } from "./HostStatusLine.tsx";
import { confirmRefusedBy, runWarnings } from "./runStart.ts";
import type { GitChange } from "./types.ts";
import { useDialogFocus } from "../overlay/useOverlay.ts";

export const RunConfirm: FC<{
  name: string;
  host: TemplateHost | null;
  /** The open draft has edits the saved file doesn't. */
  unsaved: boolean;
  /** How the template file differs from the last commit; undefined when it doesn't. */
  changed: GitChange | undefined;
  /** Opens "Install on host…"; absent when the template has no saved file to install. */
  onInstall?: () => void;
  onRun: () => void;
  onClose: () => void;
  /** Where focus goes when the dialog closes: the Runs view's Run. */
  returnFocus: RefObject<HTMLElement | null>;
}> = ({ name, host, unsaved, changed, onInstall, onRun, onClose, returnFocus }) => {
  const titleId = useId();
  const refusalId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const checkAgain = host?.onCheckAgain;
  const checkAgainRef = useRef(checkAgain);
  checkAgainRef.current = checkAgain;

  // One fresh `workflows show` per opening.
  useEffect(() => {
    checkAgainRef.current?.();
  }, []);

  useDialogFocus(true, rootRef, returnFocus);
  // Cancel, not the first control (Close), takes focus on open.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const state = host?.view.state ?? { kind: "unknown", why: "notChecked" };
  const checking = host?.view.checking ?? false;
  const refusal = checking ? null : confirmRefusedBy(state);
  const withheld = checking || refusal !== null;
  const warnings = checking ? [] : runWarnings(state, unsaved, changed);
  const copy = checking ? null : (host?.copy ?? null);

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
        <p className="text-xs">
          The host runs its installed copy of <span className="font-mono">{name}</span>, not the file in this project.
        </p>
        <section aria-label="The host's copy" className="text-xs space-y-1">
          {checking ? (
            <p role="status">Checking the host's copy…</p>
          ) : copy ? (
            <p className="break-all">
              Revision <span className="font-mono">{copy.revision ?? "unknown"}</span>, digest{" "}
              <span className="font-mono">{copy.digest ?? "unknown"}</span>
            </p>
          ) : (
            <p>Quay doesn't know the revision and digest of the host's copy.</p>
          )}
          {host && <HostStatusLine host={host} />}
        </section>
        {warnings.length > 0 && (
          <section aria-label="Warnings" className="space-y-1">
            <ul className="space-y-1">
              {warnings.map((w) => (
                <li key={w.key} className="flex items-start gap-1.5 text-xs text-[#e3b341]">
                  <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
                  <span>
                    <span className="sr-only">Warning: </span>
                    {w.text}
                  </span>
                </li>
              ))}
            </ul>
            {onInstall && (
              <button
                type="button"
                onClick={onInstall}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Install on host…
              </button>
            )}
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
