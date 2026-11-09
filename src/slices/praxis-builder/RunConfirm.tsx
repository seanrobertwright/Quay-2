// The Run confirm dialog (#362, #454). It says that the host's installed copy runs, not the file in
// the project, and names that copy's revision and digest. Opening it asks the host catalog for one
// fresh `workflows show`, which also refreshes the template's host state everywhere it is shown,
// and Run waits for that answer. It warns when the saved file differs from the host's copy, when
// the host doesn't have the template or can't run it, and when the template has unsaved or
// uncommitted edits, and offers Install on host… beside the warnings. It is a `ConfirmDialog`, so
// focus stays inside it while it is shown and goes back to the Runs view's Run when it closes.
// Escape closes it.
import { useEffect, useId, useRef, type FC, type RefObject } from "react";
import { Download, Play, TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { HostStatusLine, type TemplateHost } from "./HostStatusLine.tsx";
import { confirmRefusedBy, runWarnings } from "./runStart.ts";
import type { GitChange } from "./types.ts";

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
  const refusalId = useId();
  const checkAgain = host?.onCheckAgain;
  const checkAgainRef = useRef(checkAgain);
  checkAgainRef.current = checkAgain;

  // One fresh `workflows show` per opening.
  useEffect(() => {
    checkAgainRef.current?.();
  }, []);

  const state = host?.view.state ?? { kind: "unknown", why: "notChecked" };
  const checking = host?.view.checking ?? false;
  const refusal = checking ? null : confirmRefusedBy(state);
  const withheld = checking || refusal !== null;
  const warnings = checking ? [] : runWarnings(state, unsaved, changed);
  const copy = checking ? null : (host?.copy ?? null);

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
    </ConfirmDialog>
  );
};
