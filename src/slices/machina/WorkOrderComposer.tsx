import { FC, FormEvent, useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RunKind } from "../terminal/types";
import { AGENT_OPTIONS, agentName, splitList } from "./format";
import { MachinaWorkOrder, ProjectFactoryInfo } from "./types";

interface WorkOrderComposerProps {
  activeProject: string;
  projectInfo: ProjectFactoryInfo | null;
  projectError: string | null;
  workOrders: MachinaWorkOrder[];
  onCreated: (wo: MachinaWorkOrder) => void;
  onCancel: () => void;
  onOpenConfig: () => void;
}

const field =
  "w-full px-2.5 py-1.5 rounded-md bg-[#0d1117] border border-[#30363d] text-xs text-white focus:border-[#58a6ff] focus:outline-none";
const label = "block text-[11px] font-semibold text-[#c9d1d9] mb-1";
const hint = "mt-1 text-[11px] text-[#8b949e]";

export const WorkOrderComposer: FC<WorkOrderComposerProps> = ({
  activeProject,
  projectInfo,
  projectError,
  workOrders,
  onCreated,
  onCancel,
  onOpenConfig,
}) => {
  const ids = {
    title: useId(),
    objective: useId(),
    paths: useId(),
    base: useId(),
    agent: useId(),
    corrections: useId(),
    budget: useId(),
    deps: useId(),
  };
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [paths, setPaths] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [agent, setAgent] = useState<RunKind>("claude");
  const [maxCorrections, setMaxCorrections] = useState("3");
  const [budget, setBudget] = useState("5");
  const [deps, setDeps] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openWorkOrders = workOrders.filter((w) => w.status !== "COMPLETED" && w.status !== "ABORTED");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // The backend validates everything again; these checks only give faster feedback.
    const corrections = Number(maxCorrections);
    const budgetUsd = Number(budget);
    if (maxCorrections.trim() === "" || !Number.isInteger(corrections) || corrections < 0 || corrections > 10) {
      setError("Max corrections must be a whole number from 0 to 10.");
      return;
    }
    if (budget.trim() === "" || !Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      setError("Budget must be a number above 0.");
      return;
    }
    const allowed = splitList(paths);
    if (allowed.length === 0) {
      setError("Give at least one allowed output path.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await invoke<MachinaWorkOrder>("machina_submit_work_order", {
        request: {
          projectPath: activeProject,
          title,
          objective,
          allowedOutputPaths: allowed,
          baseBranch: baseBranch.trim() || null,
          authorAgent: agent,
          maxCorrections: corrections,
          budgetUsd,
          dependsOn: deps,
        },
      });
      onCreated(created);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4" aria-label="New work order">
      <div>
        <h3 className="text-base font-bold text-white">New work order</h3>
        {projectInfo ? (
          <p className="text-xs text-[#8b949e]">
            Repository <span className="font-mono text-[#c9d1d9]">{projectInfo.repoPath}</span>
            {projectInfo.currentBranch && (
              <>
                {" "}
                on <span className="font-mono text-[#c9d1d9]">{projectInfo.currentBranch}</span>
              </>
            )}
            . The work order gets its own branch and worktree under .machina/worktrees/.
          </p>
        ) : (
          <p className="text-xs text-[#ff7b72]">{projectError ?? "Loading the active project…"}</p>
        )}
      </div>

      {projectInfo &&
        (projectInfo.configError ||
          projectInfo.config.tier1.length === 0 ||
          (projectInfo.configExists && !projectInfo.configApproved)) && (
        <div role="alert" className="p-2.5 rounded-lg border border-[#d29922]/50 bg-[#d29922]/10 text-xs text-[#d29922]">
          {projectInfo.configError
            ? `.machina/factory.json is invalid: ${projectInfo.configError}`
            : projectInfo.configExists && !projectInfo.configApproved
              ? "This repository's factory.json is not approved, so its setup and gate commands will not run."
              : "No Tier 1 checks are configured, so every gate will be inconclusive."}{" "}
          <button type="button" onClick={onOpenConfig} className="underline">
            Open the factory config
          </button>
        </div>
      )}

      <div>
        <label htmlFor={ids.title} className={label}>
          Title
        </label>
        <input
          id={ids.title}
          className={field}
          value={title}
          maxLength={200}
          required
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add token refresh to the auth client"
        />
      </div>

      <div>
        <label htmlFor={ids.objective} className={label}>
          Objective
        </label>
        <textarea
          id={ids.objective}
          className={`${field} min-h-28`}
          value={objective}
          required
          onChange={(e) => setObjective(e.target.value)}
          placeholder="What the author agent must do, and how you will judge it."
        />
        <p className={hint}>Sent to the author agent as part of the brief.</p>
      </div>

      <div>
        <label htmlFor={ids.paths} className={label}>
          Allowed output paths
        </label>
        <input
          id={ids.paths}
          className={`${field} font-mono`}
          value={paths}
          onChange={(e) => setPaths(e.target.value)}
          placeholder="src/slices/auth/**, src-tauri/src/slices/auth/**"
          aria-describedby={`${ids.paths}-hint`}
        />
        <p id={`${ids.paths}-hint`} className={hint}>
          Comma-separated, relative to the repository. The gate fails any change outside them.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label htmlFor={ids.agent} className={label}>
            Author agent
          </label>
          <select
            id={ids.agent}
            className={field}
            value={agent}
            onChange={(e) => setAgent(e.target.value as RunKind)}
          >
            {AGENT_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {agentName(k)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.base} className={label}>
            Base branch
          </label>
          <input
            id={ids.base}
            className={`${field} font-mono`}
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            placeholder={projectInfo?.currentBranch ?? "current branch"}
          />
        </div>
        <div>
          <label htmlFor={ids.corrections} className={label}>
            Max corrections
          </label>
          <input
            id={ids.corrections}
            className={field}
            type="number"
            min={0}
            max={10}
            step={1}
            value={maxCorrections}
            onChange={(e) => setMaxCorrections(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={ids.budget} className={label}>
            Budget (USD)
          </label>
          <input
            id={ids.budget}
            className={field}
            type="number"
            min={0.01}
            step={0.5}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
      </div>
      {agent !== "claude" && (
        <p className="text-[11px] text-[#d29922]">
          Spend is measured only for Claude Code, so the budget cannot stop a {agentName(agent)} run.
        </p>
      )}

      {openWorkOrders.length > 0 && (
        <fieldset>
          <legend className={label}>Depends on</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {openWorkOrders.map((w) => {
              const id = `${ids.deps}-${w.id}`;
              return (
                <label key={w.id} htmlFor={id} className="flex items-center gap-1.5 text-xs text-[#c9d1d9]">
                  <input
                    id={id}
                    type="checkbox"
                    checked={deps.includes(w.id)}
                    onChange={(e) =>
                      setDeps((prev) =>
                        e.target.checked ? [...prev, w.id] : prev.filter((d) => d !== w.id)
                      )
                    }
                  />
                  <span className="font-mono">{w.id}</span>
                  <span className="text-[#8b949e] truncate max-w-48">{w.title}</span>
                </label>
              );
            })}
          </div>
          <p className={hint}>It waits in the queue until these are merged.</p>
        </fieldset>
      )}

      {error && (
        <div role="alert" className="p-2.5 rounded-lg border border-[#f85149]/50 bg-[#f85149]/10 text-xs text-[#ff7b72]">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !projectInfo}
          className="px-4 py-2 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-bold disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit work order"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-xs font-semibold text-[#c9d1d9]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
