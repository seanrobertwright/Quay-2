// The graph run confirm dialog (#444, #466). It says that the host runs its admitted revision of
// the graph workflow, not the files in the project, names that revision and its review digest,
// and says the run waits for approval in the browser. Opening it asks the graph host model for
// one fresh `graphs show`, which also refreshes the graph workflow's host state everywhere it is
// shown, and reads which of the bundle's files aren't committed; Start run waits for both. It
// warns when the saved files differ from the admitted revision, and about unsaved or uncommitted
// edits to the bundle's files, which never stop a run. Focus stays inside it while it is shown
// (the shared `useDialogFocus` trap) and goes back to the Runs header's Run when it closes.
// Escape closes it.
import { useEffect, useId, useRef, useState, type FC, type KeyboardEvent, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, TriangleAlert, X } from "lucide-react";
import type { GraphWorkflowHost } from "./GraphHostPanel.tsx";
import { graphConfirmRefusedBy, graphRunWarnings, type BundleChanges, type BundleFileChange } from "./graphRunStart.ts";
import type { DefinitionRef } from "./types.ts";
import { useDialogFocus } from "../overlay/useOverlay.ts";

export const GraphRunConfirm: FC<{
  projectPath: string;
  name: string;
  host: GraphWorkflowHost | null;
  /** The bundle's records whose drafts have edits their saved files don't. */
  unsaved: readonly DefinitionRef[];
  onRun: () => void;
  onClose: () => void;
  /** Where focus goes when the dialog closes: the Runs header's Run. */
  returnFocus: RefObject<HTMLElement | null>;
}> = ({ projectPath, name, host, unsaved, onRun, onClose, returnFocus }) => {
  const titleId = useId();
  const refusalId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const checkAgainRef = useRef(host?.onCheckAgain);
  checkAgainRef.current = host?.onCheckAgain;
  const [changes, setChanges] = useState<BundleChanges | null>(null);

  // One fresh `graphs show` and one git status read per opening.
  useEffect(() => {
    checkAgainRef.current?.();
    let stale = false;
    invoke<{ files: BundleFileChange[] }>("praxis_graph_workflow_changes", { projectPath, name }).then(
      ({ files }) => !stale && setChanges({ files }),
      (e) => !stale && setChanges({ error: String(e) }),
    );
    return () => {
      stale = true;
    };
  }, [projectPath, name]);

  useDialogFocus(true, rootRef, returnFocus);
  // Cancel, not the first control (Close), takes focus on open.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const view = host?.view ?? null;
  const checking = (view?.checking ?? false) || changes === null;
  const refusal = checking
    ? null
    : view && host
      ? graphConfirmRefusedBy(name, view, host.condition)
      : `Quay can't tell which revision of ${name} would run.`;
  const withheld = checking || refusal !== null;
  const warnings = checking || !view ? [] : graphRunWarnings(view, unsaved, changes);
  const current = checking ? null : (view?.current ?? null);

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
          The host runs its admitted revision of <span className="font-mono">{name}</span>, not the files in this project.
        </p>
        <section aria-label="The admitted revision" className="text-xs space-y-1">
          {checking ? (
            <p role="status">Checking the host&apos;s admitted revision…</p>
          ) : current ? (
            <p className="break-all">
              Admitted revision <span className="font-mono">{current.revision}</span>, review digest{" "}
              <span className="font-mono">{view?.reviewDigest ?? "not given by the host"}</span>
            </p>
          ) : (
            <p>Quay doesn&apos;t know which revision the host has admitted.</p>
          )}
        </section>
        <p className="text-xs">The run waits for approval in the browser before it does anything.</p>
        {warnings.length > 0 && (
          <section aria-label="Warnings">
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
