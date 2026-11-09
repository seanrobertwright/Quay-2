// A Runs view's Run (#454, #466): the header with Run, why Run is disabled, the confirm while it
// is open, and the notice for the last Run's outcome. Run is disabled, with the reason shown and
// described, while a creation is in flight and when `refusedBy` names a reason. Start run in the
// confirm starts a run, or joins the creation in flight. The template and graph Runs views draw
// their Run through here, each with its own confirm.
import { useId, useRef, useState, type FC, type ReactNode, type RefObject } from "react";
import { Play } from "lucide-react";
import { StartedNotice } from "./RunStartedNotice.tsx";
import type { RunStartView } from "./useRunStart.ts";

/** What a Runs view's confirm is given. */
export interface RunConfirmDialog {
  onRun: () => void;
  onClose: () => void;
  /** Where focus goes when the dialog closes: the header's Run. */
  returnFocus: RefObject<HTMLElement | null>;
}

export const RunControl: FC<{
  name: string;
  run: RunStartView;
  /** Why the host can't run `name`, from what it was last read to hold; null when nothing known stops it. */
  refusedBy: string | null;
  /** The view's confirm dialog. */
  confirm: (dialog: RunConfirmDialog) => ReactNode;
  /** Told when Start run starts or joins a creation. */
  onStart: () => void;
  onShowRun: (workOrderId: string) => void;
  onOpen: (label: string, address: string | null, workOrderId: string | null) => void;
}> = ({ name, run, refusedBy, confirm, onStart, onShowRun, onOpen }) => {
  const [confirming, setConfirming] = useState(false);
  const runRef = useRef<HTMLButtonElement | null>(null);
  const runReasonId = useId();
  const { creating, started } = run;
  const withheld = creating !== null || refusedBy !== null;

  return (
    <>
      <header className="flex items-start gap-2">
        <h2 className="text-sm font-semibold text-[#c9d1d9] min-w-0 break-all">
          Runs on the host
          <span className="ml-2 font-mono font-normal text-[#8b949e]">{name}</span>
        </h2>
        <button
          ref={runRef}
          type="button"
          // Not `disabled`, which would drop focus; the reason is shown and described.
          aria-disabled={withheld}
          aria-describedby={withheld ? runReasonId : undefined}
          onClick={() => !withheld && setConfirming(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white shrink-0 aria-disabled:opacity-40"
        >
          <Play className="w-3.5 h-3.5" aria-hidden="true" />
          Run
        </button>
      </header>
      {withheld && (
        <p id={runReasonId} className="text-[11px] text-[#8b949e]">
          {creating !== null ? `Starting a run of ${name}…` : refusedBy}
        </p>
      )}
      {confirming &&
        confirm({
          onRun: () => {
            setConfirming(false);
            onStart();
            run.start();
          },
          onClose: () => setConfirming(false),
          returnFocus: runRef,
        })}
      {started && (
        <StartedNotice started={started} name={name} onShowRun={onShowRun} onOpen={onOpen} onCopy={run.copyRefusal} onDismiss={run.dismiss} />
      )}
    </>
  );
};
