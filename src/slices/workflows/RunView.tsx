import { useEffect, useId, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
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

const primary =
  "min-h-8 px-3 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold disabled:opacity-50";
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
  const act = async (label: string, command: string, args: Record<string, unknown>) => {
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
      <Decision source={source} row={row} busy={busy} act={act} onOpenInBrowser={onOpenInBrowser} />
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

type Act = (label: string, command: string, args: Record<string, unknown>) => Promise<void>;

const RunHeader = ({ row }: { row: WorkflowRunRow }) => (
  <header className="space-y-1">
    <p className="text-[11px] uppercase tracking-wider text-[#8b949e]">{ENGINE_NAME[row.engine]}</p>
    <h3 className="text-sm font-semibold text-white break-words">{row.name}</h3>
    <p className="text-[#8b949e]">{row.spendUsd === null ? row.status : `${row.status} · ${formatUsd(row.spendUsd)}`}</p>
  </header>
);

/** The decision card, or nothing while nothing waits on the operator. */
const Decision = ({
  source,
  row,
  busy,
  act,
  onOpenInBrowser,
}: {
  source: RunSource;
  row: WorkflowRunRow;
  busy: boolean;
  act: Act;
  onOpenInBrowser: () => void;
}): ReactNode => {
  const decision = row.decision;
  if (decision === null) return <p className="text-[#8b949e]">Nothing waits on you.</p>;
  if (source.engine === "archon") {
    const runId = source.run.id;
    if (decision.kind === "archon-approval") return <ArchonApproval runId={runId} busy={busy} act={act} />;
    return (
      <DecisionCard title="This run failed.">
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => void act("Resume", "archon_run_action", { runId, action: "resume", text: null })} className={primary}>
            Resume
          </button>
          <PressTwice
            label="Abandon"
            armedLabel="Press again to abandon"
            disabled={busy}
            onConfirm={() => void act("Abandon", "archon_run_action", { runId, action: "abandon", text: null })}
          />
        </div>
      </DecisionCard>
    );
  }
  if (source.engine === "factory") {
    const wo = source.workOrder;
    const workOrderId = wo.id;
    if (decision.kind === "factory-hold" && wo.hold) {
      return (
        <DecisionCard title="On hold">
          <p className="text-white">{wo.hold.summary}</p>
          <div className="space-y-1.5">
            {wo.hold.options.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                onClick={() => void act(option.label, "machina_resolve_hold", { request: { workOrderId, optionId: option.id } })}
                className={`w-full text-left p-2 rounded-md border disabled:opacity-50 ${
                  option.variant === "danger"
                    ? "border-[#f85149]/50 hover:bg-[#f85149]/15"
                    : option.variant === "primary"
                      ? "border-[#3fb950]/50 hover:bg-[#3fb950]/15"
                      : "border-[#30363d] hover:bg-[#21262d]"
                }`}
              >
                <span className="block font-semibold text-white">{option.label}</span>
                <span className="block text-[11px] text-[#8b949e]">{option.description}</span>
              </button>
            ))}
          </div>
        </DecisionCard>
      );
    }
    if (decision.kind === "factory-accept") {
      return (
        <DecisionCard title="The gate passed.">
          <button type="button" disabled={busy} onClick={() => void act("Accept", "machina_accept_and_merge", { workOrderId })} className={primary}>
            Accept: squash-merge into {wo.baseBranch}
          </button>
          <p className="text-[11px] text-[#8b949e]">
            The main checkout at {wo.repoPath} must be on {wo.baseBranch} with no uncommitted changes to tracked files.
          </p>
        </DecisionCard>
      );
    }
    return (
      <DecisionCard title={wo.status === "FAILED" ? "This work order failed." : "This work order was interrupted."}>
        <button type="button" disabled={busy} onClick={() => void act("Resume", "machina_resume", { workOrderId })} className={primary}>
          Resume
        </button>
      </DecisionCard>
    );
  }
  return (
    <DecisionCard title="This run waits on you in Praxis.">
      <p className="text-[11px] text-[#8b949e]">Praxis decisions are made on the host&apos;s page, in the browser.</p>
      <button type="button" onClick={onOpenInBrowser} className={primary}>
        Open in browser
      </button>
    </DecisionCard>
  );
};

const DecisionCard = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label="Decision" className="p-3 rounded-lg border border-[#d29922] bg-[#d29922]/10 space-y-2">
    <p className="font-semibold text-[#e3b341]">{title}</p>
    {children}
  </section>
);

/** How long a press-twice button stays armed, in ms. */
const ARMED_MS = 4000;

/** A button that acts only on its second press, for a choice that can't be undone. */
const PressTwice = ({
  label,
  armedLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  armedLabel: string;
  disabled: boolean;
  onConfirm: () => void;
}) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARMED_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      className={armed ? "min-h-8 px-3 rounded-md bg-[#f85149] text-white text-xs font-semibold" : secondary}
    >
      {armed ? armedLabel : label}
    </button>
  );
};

const ArchonApproval = ({ runId, busy, act }: { runId: string; busy: boolean; act: Act }) => {
  const commentId = useId();
  const [comment, setComment] = useState("");
  const decide = (action: "approve" | "reject") =>
    void act(action === "approve" ? "Approve" : "Reject", "archon_run_action", { runId, action, text: comment });
  return (
    <DecisionCard title="This run waits for your approval.">
      <label htmlFor={commentId} className="block text-[11px] text-[#8b949e]">
        Comment (optional)
      </label>
      <textarea
        id={commentId}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-[#30363d] bg-[#0d1117] p-2 text-xs"
      />
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => decide("approve")} className={primary}>
          Approve
        </button>
        <button type="button" disabled={busy} onClick={() => decide("reject")} className={secondary}>
          Reject
        </button>
      </div>
    </DecisionCard>
  );
};
