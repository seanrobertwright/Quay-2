import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RunDecisionCard, type DecisionAct } from "../cards/RunDecisionCard.tsx";
import { formatUsd } from "../machina/format.ts";
import { rowOf, type RunSource, type WorkflowRunRow } from "./workflowRuns.ts";

interface RunViewProps {
  /** The picked run or work order, as its engine last reported it. */
  source: RunSource;
  /** The clock the row is read against, in ms since the epoch. */
  now: number;
  /** Called after a decision went through, so the engines are read again. */
  onChanged: () => void;
  /** Opens the run lens on this run. */
  onOpenLens: () => void;
  /** Opens a Praxis run's page, where its decisions are made. */
  onOpenInBrowser: () => void;
}

const ENGINE_NAME = { archon: "Archon", factory: "Factory", praxis: "Praxis" } as const;

const secondary =
  "min-h-8 px-3 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] text-xs disabled:opacity-50";

/**
 * The companion's Run view: the picked run or work order, and the decision waiting on the
 * operator: Approve or Reject, Resume or Abandon, the hold's options, or Accept: squash-merge.
 * A Praxis decision opens in the browser. Keyed by the run where it is shown, so another run
 * starts with an empty comment.
 */
export const RunView = ({ source, now, onChanged, onOpenLens, onOpenInBrowser }: RunViewProps) => {
  const row = rowOf(source, now);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const act: DecisionAct = async (label, command, args) => {
    setBusy(true);
    setProblem(null);
    try {
      await invoke(command, args);
      onChanged();
    } catch (e) {
      setProblem(`${label} failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-3 space-y-3 text-xs text-[#c9d1d9]">
      <RunHeader row={row} />
      {row.decision === null ? (
        <p className="text-[#8b949e]">Nothing waits on you.</p>
      ) : (
        <RunDecisionCard decision={row.decision} busy={busy} act={act} onOpenLens={onOpenLens} onOpenInBrowser={onOpenInBrowser} />
      )}
      {problem && (
        <p role="alert" className="text-[#ff7b72] break-words">
          {problem}
        </p>
      )}
      <button type="button" onClick={onOpenLens} className={secondary}>
        Graph and log
      </button>
    </div>
  );
};

const RunHeader = ({ row }: { row: WorkflowRunRow }) => (
  <header className="space-y-1">
    <p className="text-[11px] uppercase tracking-wider text-[#8b949e]">{ENGINE_NAME[row.engine]}</p>
    <h3 className="text-sm font-semibold text-white break-words">{row.name}</h3>
    <p className="text-[#8b949e]">{row.spendUsd === null ? row.status : `${row.status} · ${formatUsd(row.spendUsd)}`}</p>
  </header>
);
