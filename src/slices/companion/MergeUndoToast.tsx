import { mergeMethodLabel } from "./readiness.ts";
import { SECONDARY } from "./buttonStyles.ts";
import type { MergeUndo } from "./useMergeUndo.ts";

const TOAST = "m-2 flex items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-lg";

/**
 * The Merge undo window's toast in the companion: the merge counting down, with Cancel; the merge
 * once it runs; then what came of it, with Dismiss. Nothing while no Merge has started.
 */
export const MergeUndoToast = ({ undo }: { undo: MergeUndo }) => {
  if (undo.pending) {
    const { job, secondsLeft } = undo.pending;
    return (
      <div role="status" data-merge-undo className={`${TOAST} border-[#58a6ff] bg-[#161b22] text-[#c9d1d9]`}>
        <span className="min-w-0 flex-1 break-words">
          {mergeMethodLabel(job.method)} #{job.location.number} in <span className="font-semibold text-white">{secondsLeft} s</span>
        </span>
        <button type="button" onClick={undo.cancel} className={SECONDARY}>
          Cancel
        </button>
      </div>
    );
  }
  if (undo.running) {
    return (
      <div role="status" data-merge-undo className={`${TOAST} border-[#30363d] bg-[#161b22] text-[#c9d1d9]`}>
        Merging #{undo.running.location.number}…
      </div>
    );
  }
  if (!undo.result) return null;
  const { ok, text } = undo.result;
  return (
    <div
      role={ok ? "status" : "alert"}
      data-merge-undo
      className={`${TOAST} bg-[#161b22] ${ok ? "border-[#8957e5] text-[#c9d1d9]" : "border-[#f85149] text-[#f85149]"}`}
    >
      <span className="min-w-0 flex-1 break-words">{text}</span>
      <button type="button" aria-label="Dismiss" onClick={undo.dismiss} className={SECONDARY}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
};
