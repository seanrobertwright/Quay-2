// The notice for a Run's outcome in a Runs view (#454, #466): a toast for a created run, with
// Open in browser, or what stopped it. A blocking held or awaiting run gets Show run and Open in
// browser, and a refusal in praxis's own words gets Copy.
import type { FC } from "react";
import { Check, Copy, ExternalLink, TriangleAlert, X } from "lucide-react";
import type { Started } from "./useRunStart.ts";

/** The notice for a Run's outcome: a toast for a created run, otherwise what stopped it. */
export const StartedNotice: FC<{
  started: Started;
  name: string;
  onShowRun: (workOrderId: string) => void;
  onOpen: (label: string, address: string | null, workOrderId: string | null) => void;
  onCopy: (message: string) => void;
  onDismiss: () => void;
}> = ({ started, name, onShowRun, onOpen, onCopy, onDismiss }) => {
  const { start, copied } = started;
  const buttonClass = "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#30363d] hover:bg-[#21262d] text-[#c9d1d9]";
  const dismiss = (
    <button type="button" aria-label="Dismiss" onClick={onDismiss} className="ml-auto p-0.5 rounded text-[#8b949e] hover:text-white">
      <X className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
  if (start.kind === "created") {
    return (
      <div role="status" aria-label="Run started" className="flex flex-wrap items-center gap-2 px-2 py-1.5 rounded-md border border-[#238636]/60 bg-[#0d1117] text-xs">
        <Check className="w-3.5 h-3.5 text-[#3fb950]" aria-hidden="true" />
        <span>
          Started <span className="font-mono">{start.runId}</span> of {name}.
        </span>
        <button type="button" onClick={() => onOpen(start.runId, start.runPageAddress, start.workOrderId)} className={buttonClass}>
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          Open in browser
        </button>
        {dismiss}
      </div>
    );
  }
  const blocking = start.kind === "blocked" ? start.blockingWorkOrderId : null;
  return (
    <div role="alert" aria-label="Run not started" className="space-y-1.5 px-2 py-1.5 rounded-md border border-[#f85149]/60 bg-[#0d1117] text-xs">
      <div className="flex items-start gap-1.5">
        <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0 text-[#f85149]" aria-hidden="true" />
        <p className="min-w-0 break-words whitespace-pre-wrap">
          {start.kind === "refused" ? (
            <>
              praxis refused the run: <span className="font-mono">{start.message}</span>
            </>
          ) : (
            start.message
          )}
        </p>
        {dismiss}
      </div>
      {start.kind === "blocked" && (
        <div className="flex flex-wrap gap-2">
          {blocking !== null && (
            <button type="button" onClick={() => onShowRun(blocking)} className={buttonClass}>
              Show run
            </button>
          )}
          <button type="button" onClick={() => onOpen("the blocking run", start.blockingRunAddress, blocking)} className={buttonClass}>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
            Open in browser
          </button>
        </div>
      )}
      {start.kind === "refused" && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onCopy(start.message)} className={buttonClass}>
            <Copy className="w-3 h-3" aria-hidden="true" />
            Copy
          </button>
          <span role="status" className="text-[11px] text-[#8b949e]">
            {copied}
          </span>
        </div>
      )}
    </div>
  );
};
