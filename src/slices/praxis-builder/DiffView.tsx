// The diff a "changed since last commit" badge opens (#223): one contract or grant file
// against the last commit, read with `praxis_diff`, so an agent's edits are visible before
// anyone submits them. Escape closes it, through the builder's cascade.
import { useEffect, useId, useRef, useState, type FC, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TriangleAlert, X } from "lucide-react";
import { diffLines, type DiffLine } from "./changes.ts";
import { GRANT_PROPOSAL_NOTE } from "./grant.ts";
import { focusedElement } from "./keyboard.ts";
import { definitionPath } from "./session.ts";
import type { ChangeStatus, DefinitionRef, FileDiff } from "./types.ts";

const STATUS_NOTES: Record<ChangeStatus, string> = {
  modified: "Changed since the last commit.",
  added: "New since the last commit.",
  deleted: "Deleted since the last commit.",
};

const LINE_CLASSES: Record<DiffLine["kind"], string> = {
  header: "text-[#6e7681]",
  hunk: "text-[#79c0ff] bg-[#388bfd]/10",
  added: "text-[#aff5b4] bg-[#2ea043]/15",
  removed: "text-[#ffdcd7] bg-[#f85149]/15",
  context: "text-[#c9d1d9]",
};

const MARKERS: Record<DiffLine["kind"], string> = { header: "", hunk: "", added: "+", removed: "-", context: " " };

type Read = { state: "loading" } | { state: "failed"; error: string } | { state: "done"; diff: FileDiff };

export const DiffView: FC<{
  rootRef: Ref<HTMLDivElement>;
  projectPath: string;
  target: DefinitionRef;
  onClose: () => void;
}> = ({ rootRef, projectPath, target, onClose }) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [read, setRead] = useState<Read>({ state: "loading" });
  const { kind, id } = target;

  // Focus goes to Close while it is shown and back to where it was when it closes.
  useEffect(() => {
    const previous = focusedElement();
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    let stale = false;
    setRead({ state: "loading" });
    invoke<FileDiff>("praxis_diff", { projectPath, kind, id }).then(
      (diff) => {
        if (!stale) setRead({ state: "done", diff });
      },
      (e) => {
        if (!stale) setRead({ state: "failed", error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [projectPath, kind, id]);

  const path = read.state === "done" ? read.diff.path : definitionPath(target);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-w-4xl w-full max-h-full flex flex-col rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-2xl text-[#c9d1d9]"
      >
        <div className="flex items-center gap-2 mb-2">
          <h3 id={titleId} className="text-sm font-semibold text-white min-w-0 break-all">
            Changes to <span className="font-mono">{path}</span>
          </h3>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close the diff"
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {kind === "grants" && (
          <p className="flex items-start gap-1.5 mb-2 text-xs text-[#c9d1d9]">
            <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0 text-[#e3b341]" aria-hidden="true" />
            {GRANT_PROPOSAL_NOTE}
          </p>
        )}
        {read.state === "loading" && <p className="text-xs text-[#6e7681]">Reading the diff…</p>}
        {read.state === "failed" && (
          <p role="alert" className="text-xs text-[#ff7b72] break-words">
            {read.error}
          </p>
        )}
        {read.state === "done" && (
          <>
            <p role="status" className="mb-2 text-xs text-[#8b949e]">
              {read.diff.status ? STATUS_NOTES[read.diff.status] : "No changes since the last commit."}
              {" Compared with the last commit, staged changes included."}
            </p>
            {read.diff.diff && (
              <pre className="min-h-0 overflow-auto rounded-md border border-[#30363d] bg-[#0d1117] py-1 text-[11px] leading-4 font-mono">
                {diffLines(read.diff.diff).map((line, i) => (
                  <div key={i} className={`px-2 whitespace-pre ${LINE_CLASSES[line.kind]}`}>
                    <span aria-hidden="true" className="select-none inline-block w-3">
                      {MARKERS[line.kind]}
                    </span>
                    {line.kind === "added" && <span className="sr-only">Added: </span>}
                    {line.kind === "removed" && <span className="sr-only">Removed: </span>}
                    {line.text}
                  </div>
                ))}
              </pre>
            )}
            {read.diff.truncated && (
              <p className="mt-1 text-[10px] text-[#e3b341]">The diff is longer than Quay shows, so it is cut short.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
