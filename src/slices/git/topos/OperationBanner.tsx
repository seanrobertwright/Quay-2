import React, { useId, useState } from "react";
import { AlertTriangle, GitMerge, Loader2, Play, SkipForward, Square, X } from "lucide-react";
import { MessageInputs, OutputPanel } from "./CommitParts";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";
import { confirmAbort, confirmSkip, type OpStep } from "./operation";
import type { Operation } from "./useOperation";

export interface OperationBannerProps {
  operation: Operation;
  /** Whether a staging operation other than a step of this banner is running. */
  stagingBusy: boolean;
  /** The Continue button, which the composer's pointer moves focus to. */
  continueRef: React.RefObject<HTMLButtonElement | null>;
}

const BUSY_WORD: Record<OpStep, string> = { continue: "Continuing…", skip: "Skipping…", abort: "Aborting…" };

/**
 * The banner pinned over the graph while a merge, rebase, cherry-pick or revert is under way (#352,
 * #389). It names the operation and both sides by role and real ref, as text, with git's "ours" and
 * "theirs" only in the tooltips. Continue commits the message prefilled from git's own file, always
 * shown, and streams hook output with Cancel; Skip, where git allows it, and Abort confirm first,
 * naming what each loses. A conflict with no state file gets resolve-and-stage only.
 */
export const OperationBanner: React.FC<OperationBannerProps> = ({ operation, stagingBusy, continueRef }) => {
  const titleId = useId();
  const blockedId = useId();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const { view, op, fields, setFields, running, output, failure, run, cancel } = operation;
  if (view === null || op === null) return null;

  if (view.kind === "conflictsOnly") {
    return (
      <section aria-labelledby={titleId} className="px-4 py-2 shrink-0 border-b border-[#d29922]/30 bg-[#d29922]/10 text-xs">
        <h3 id={titleId} className="font-semibold text-[#e3b341] flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          {view.title}
        </h3>
        <p className="text-[#c9d1d9]">{view.detail}</p>
      </section>
    );
  }

  const ask = (step: "skip" | "abort") => {
    const request = step === "skip" ? confirmSkip(op) : confirmAbort(op);
    if (request !== null) setConfirm({ ...request, onConfirm: () => run(step) });
  };
  const disabled = running !== null || stagingBusy;
  const continueOff = !view.canContinue || stagingBusy;
  const buttonClass = "inline-flex items-center gap-1 px-2 py-1 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <section aria-labelledby={titleId} aria-busy={running !== null} className="shrink-0 border-b border-[#06B6D4]/40 bg-[#06B6D4]/10 text-xs">
      <div className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 id={titleId} className="font-semibold text-white flex items-center gap-1.5 shrink-0">
          <GitMerge className="w-3.5 h-3.5 text-[#06B6D4]" aria-hidden="true" />
          {view.title}
        </h3>
        {/* Ref names and subjects come from git: rendered as text, never markup. */}
        <span title={view.left.tooltip} className="px-1.5 py-0.5 rounded border border-[#30363d] bg-[#0d1117] text-[#c9d1d9] truncate max-w-[30%]">
          {view.left.text}
        </span>
        <span title={view.right.tooltip} className="px-1.5 py-0.5 rounded border border-[#30363d] bg-[#0d1117] text-[#c9d1d9] truncate max-w-[30%]">
          {view.right.text}
        </span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            ref={continueRef}
            type="button"
            // aria-disabled rather than disabled, so the composer's pointer can still move focus
            // here and a screen reader hears why it is off.
            onClick={() => {
              if (continueOff) return;
              run("continue");
            }}
            aria-disabled={continueOff}
            aria-describedby={view.continueBlockedBy !== null ? blockedId : undefined}
            aria-busy={running === "continue"}
            className={`${buttonClass} bg-[#238636] text-white font-semibold ${continueOff ? "opacity-50 cursor-not-allowed" : "hover:bg-[#2ea043]"}`}
          >
            {running === "continue" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />}
            {running === "continue" ? BUSY_WORD.continue : "Continue"}
          </button>
          {view.canSkip && (
            <button type="button" onClick={() => ask("skip")} disabled={disabled} className={`${buttonClass} border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d]`}>
              {running === "skip" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />}
              {running === "skip" ? BUSY_WORD.skip : "Skip"}
            </button>
          )}
          <button type="button" onClick={() => ask("abort")} disabled={disabled} className={`${buttonClass} border border-[#f85149]/40 text-[#ff7b72] hover:bg-[#f85149]/10`}>
            {running === "abort" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <X className="w-3.5 h-3.5" aria-hidden="true" />}
            {running === "abort" ? BUSY_WORD.abort : "Abort"}
          </button>
          {running !== null && (
            <button
              type="button"
              onClick={cancel}
              aria-label="Cancel the running step and stop its hooks"
              className={`${buttonClass} border border-[#f85149]/40 text-[#ff7b72] hover:bg-[#f85149]/10`}
            >
              <Square className="w-3 h-3" aria-hidden="true" />
              Cancel
            </button>
          )}
        </div>
      </div>
      {view.continueBlockedBy !== null && (
        <p id={blockedId} className="px-4 pb-1.5 text-[11px] text-[#8b949e]">
          {view.continueBlockedBy}
        </p>
      )}
      {/* Continue commits this message, so it is always in view, never behind a disclosure. */}
      {op.message !== null && (
        <div className="px-4 pb-2 flex flex-col gap-1.5 max-w-2xl">
          <MessageInputs fields={fields} setFields={setFields} onSubmit={() => run("continue")} readOnly={running !== null} />
        </div>
      )}
      {failure && (
        <p className="px-4 pb-1.5 text-[11px] text-[#ff7b72] break-words">
          <AlertTriangle className="inline w-3 h-3 mr-1 align-[-2px]" aria-hidden="true" />
          {failure.message}
        </p>
      )}
      <OutputPanel label="Operation output" running={running !== null} output={output} keepOpen={Boolean(failure?.output)} />
      <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />
    </section>
  );
};
