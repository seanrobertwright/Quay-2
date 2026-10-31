import { FC, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Cpu, FileCode2, GitBranch, OctagonAlert, Plus, X } from "lucide-react";
import { SpawnTerminalRequest, TerminalInfo } from "../terminal/types";
import { formatRelative } from "../../lib/dates";
import { FactoryConfigPanel } from "./FactoryConfigPanel";
import { WorkOrderComposer } from "./WorkOrderComposer";
import { RunAction, WorkOrderDetail } from "./WorkOrderDetail";
import { formatUsd, stageBarClass, STATUS_LABEL, statusBadgeClass } from "./format";
import {
  FactoryLoopMode,
  MachinaStatus,
  MachinaWorkOrder,
  ProjectFactoryInfo,
} from "./types";

interface FactoryStationModalProps {
  isOpen: boolean;
  activeProject: string;
  terminals: TerminalInfo[];
  onClose: () => void;
  onSelectTerminal: (id: string) => void;
  onSpawnTerminal: (request: SpawnTerminalRequest) => Promise<unknown> | void;
}

type View = "detail" | "compose" | "config";
type Notice = { kind: "info" | "error"; text: string };

/** The list renders at most this many work orders, newest first. */
const MAX_LISTED = 200;
const REFRESH_MS = 15_000;

export const FactoryStationModal: FC<FactoryStationModalProps> = ({
  isOpen,
  activeProject,
  terminals,
  onClose,
  onSelectTerminal,
  onSpawnTerminal,
}) => {
  const titleId = useId();
  const loopName = useId();
  const [status, setStatus] = useState<MachinaStatus | null>(null);
  const [workOrders, setWorkOrders] = useState<MachinaWorkOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("detail");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [haltArmed, setHaltArmed] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectFactoryInfo | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listSeq = useRef(0);
  const projectSeq = useRef(0);

  // Only the newest response is applied, so a slow reply never overwrites a fresh one.
  const refresh = useCallback(async () => {
    const seq = ++listSeq.current;
    try {
      const [st, list] = await Promise.all([
        invoke<MachinaStatus>("machina_get_status"),
        invoke<MachinaWorkOrder[]>("machina_list_work_orders"),
      ]);
      if (seq !== listSeq.current) return;
      setStatus(st);
      setWorkOrders(list);
      setLoadError(null);
    } catch (e) {
      if (seq === listSeq.current) setLoadError(String(e));
    }
  }, []);

  const loadProject = useCallback(async () => {
    const seq = ++projectSeq.current;
    if (!activeProject) {
      setProjectInfo(null);
      setProjectError("Open a project first.");
      return;
    }
    try {
      const info = await invoke<ProjectFactoryInfo>("machina_get_project_info", {
        projectPath: activeProject,
      });
      if (seq !== projectSeq.current) return;
      setProjectInfo(info);
      setProjectError(null);
    } catch (e) {
      if (seq !== projectSeq.current) return;
      setProjectInfo(null);
      setProjectError(String(e));
    }
  }, [activeProject]);

  const cancelListRefresh = useCallback(() => {
    listSeq.current++;
  }, []);

  const cancelProjectLoad = useCallback(() => {
    projectSeq.current++;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    const unlisten = listen<MachinaStatus>("machina-state-updated", () => {
      void refresh();
    });
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      void unlisten.then((stop) => stop());
      cancelListRefresh();
    };
  }, [isOpen, refresh, cancelListRefresh]);

  useEffect(() => {
    if (!isOpen) return;
    void loadProject();
    return () => {
      cancelProjectLoad();
    };
  }, [isOpen, loadProject, cancelProjectLoad]);

  // A ticking clock for live durations, only while something is running.
  const anyRunning = (status?.runningJobs ?? 0) > 0;
  useEffect(() => {
    if (!isOpen) return;
    setNow(Date.now());
    if (!anyRunning) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isOpen, anyRunning, workOrders]);

  // Info notices fade; errors stay until dismissed.
  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!haltArmed) return;
    const t = window.setTimeout(() => setHaltArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [haltArmed]);

  const selected = useMemo(
    () => workOrders.find((w) => w.id === selectedId) ?? workOrders[0] ?? null,
    [workOrders, selectedId]
  );

  if (!isOpen) return null;

  const run: RunAction = async (label, fn, success) => {
    setBusy(label);
    try {
      await fn();
      if (success) setNotice({ kind: "info", text: success });
      await refresh();
    } catch (e) {
      setNotice({ kind: "error", text: `${label} failed: ${String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const setLoopMode = (mode: FactoryLoopMode) =>
    run(
      "Set loop mode",
      () => invoke("machina_set_loop_mode", { mode }),
      mode === "HALTED"
        ? "HALTED: running scaffolds and gates were cancelled and Ctrl+C was sent to author terminals."
        : `Loop ${mode}.`
    );

  const launchAuthor = (wo: MachinaWorkOrder) =>
    run(
      "Launch author",
      async () => {
        const terminalId = `machina-${wo.id.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
        await onSpawnTerminal({
          id: terminalId,
          project_path: wo.worktreePath,
          run_kind: wo.authorAgent,
          name: `${wo.id} author`,
        });
        await invoke("machina_bind_author_terminal", { workOrderId: wo.id, terminalId });
      },
      `Launched the author for ${wo.id}. Once the agent is ready, send it the brief.`
    );

  const openTerminal = (terminalId: string) => {
    onSelectTerminal(terminalId);
    onClose();
  };

  const loopMode = status?.loopMode ?? "ACTIVE";
  const listed = workOrders.slice(0, MAX_LISTED);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[1420px] h-[91vh] bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#c9d1d9]"
      >
        <header className="h-14 px-5 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#58a6ff]/15 border border-[#58a6ff]/40 flex items-center justify-center">
              <Cpu className="w-4 h-4 text-[#58a6ff]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id={titleId} className="text-sm font-bold text-white tracking-wide">
                  MACHINA
                </h2>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#bc8cff] font-mono border border-[#30363d]">
                  Ctrl+Shift+B F
                </span>
                {status && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#58a6ff] font-mono border border-[#30363d]"
                    title="Counts Quay starts. Work cut off by a restart is marked INTERRUPTED with the epoch that found it."
                  >
                    Epoch {status.epoch}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#8b949e] truncate">
                Agent work in isolated git worktrees, gated by your project's own checks, merged by a human
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {loopMode === "HALTED" ? (
              <span className="text-[11px] font-mono font-bold px-2 py-1 rounded bg-[#f85149] text-white">
                HALTED
              </span>
            ) : null}
            <div
              role="radiogroup"
              aria-label="Factory loop"
              className="flex items-center rounded-md bg-[#0d1117] border border-[#30363d] p-0.5 text-[11px] font-mono"
            >
              {(["ACTIVE", "PAUSED"] as const).map((mode) => (
                <label
                  key={mode}
                  className={`px-2 py-1 rounded cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#58a6ff] ${
                    loopMode === mode
                      ? mode === "ACTIVE"
                        ? "bg-[#238636] text-white font-bold"
                        : "bg-[#d29922] text-[#0d1117] font-bold"
                      : "text-[#8b949e] hover:text-white"
                  }`}
                  title={
                    mode === "ACTIVE"
                      ? "Queued work orders start when their dependencies merge"
                      : "Queued work orders wait; running work continues"
                  }
                >
                  <input
                    type="radio"
                    name={loopName}
                    value={mode}
                    checked={loopMode === mode}
                    disabled={busy !== null}
                    onChange={() => void setLoopMode(mode)}
                    className="sr-only"
                  />
                  {mode}
                </label>
              ))}
            </div>
            {loopMode !== "HALTED" && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (haltArmed) {
                    setHaltArmed(false);
                    void setLoopMode("HALTED");
                  } else {
                    setHaltArmed(true);
                  }
                }}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md border text-[11px] font-mono font-bold transition-colors ${
                  haltArmed
                    ? "bg-[#f85149] border-[#f85149] text-white"
                    : "bg-[#21262d] border-[#30363d] text-[#ff7b72] hover:bg-[#f85149]/20"
                }`}
                title="Cancels running scaffolds and gates, sends Ctrl+C to author terminals, and refuses new work orders"
              >
                <OctagonAlert className="w-3 h-3" aria-hidden="true" />
                {haltArmed ? "Click again to halt" : "HALT"}
              </button>
            )}

            <button
              type="button"
              aria-pressed={view === "config"}
              onClick={() => setView((v) => (v === "config" ? "detail" : "config"))}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
                view === "config"
                  ? "bg-[#58a6ff]/20 border-[#58a6ff] text-[#58a6ff]"
                  : "bg-[#21262d] hover:bg-[#30363d] border-[#30363d] text-[#c9d1d9]"
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
              Factory config
            </button>
            <button
              type="button"
              aria-pressed={view === "compose"}
              onClick={() => setView((v) => (v === "compose" ? "detail" : "compose"))}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                view === "compose" ? "bg-[#58a6ff] text-[#0d1117]" : "bg-[#238636] hover:bg-[#2ea043] text-white"
              }`}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              New work order
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Machina"
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {(notice || loadError) && (
          <div
            role={notice?.kind === "error" || loadError ? "alert" : "status"}
            className={`px-5 py-2 border-b flex items-center justify-between gap-4 text-xs ${
              notice?.kind === "error" || loadError
                ? "bg-[#f85149]/10 border-[#f85149]/40 text-[#ff7b72]"
                : "bg-[#1f6feb]/15 border-[#58a6ff]/40 text-[#58a6ff]"
            }`}
          >
            <span className="break-words">{loadError ? `Could not load Machina: ${loadError}` : notice?.text}</span>
            {notice && (
              <button type="button" onClick={() => setNotice(null)} className="text-[11px] hover:underline shrink-0">
                Dismiss
              </button>
            )}
          </div>
        )}

        <div className="flex-1 flex min-h-0 overflow-hidden">
          <aside aria-label="Work orders" className="w-80 border-r border-[#30363d] bg-[#161b22]/60 flex flex-col shrink-0">
            <div className="p-3.5 border-b border-[#30363d] bg-[#161b22] grid grid-cols-3 gap-1.5 text-[10px] font-mono">
              <div className="px-2 py-1 rounded bg-[#0d1117] border border-[#30363d]" title="Measured Claude Code and PiG spend of open work orders, against their budgets">
                <div className="text-[#8b949e]">SPEND</div>
                <div className="font-bold text-xs text-[#e3b341]">
                  {status ? formatUsd(status.measuredSpendUsd) : "—"}
                </div>
                <div className="text-[#8b949e]">of {status ? formatUsd(status.budgetUsd) : "—"}</div>
              </div>
              <div className="px-2 py-1 rounded bg-[#0d1117] border border-[#30363d]">
                <div className="text-[#8b949e]">HOLDS</div>
                <div className={`font-bold text-xs ${status && status.activeHolds > 0 ? "text-[#d29922]" : "text-[#3fb950]"}`}>
                  {status?.activeHolds ?? "—"}
                </div>
              </div>
              <div className="px-2 py-1 rounded bg-[#0d1117] border border-[#30363d]">
                <div className="text-[#8b949e]">RUNNING</div>
                <div className="font-bold text-xs text-[#58a6ff]">{status?.runningJobs ?? "—"}</div>
              </div>
            </div>

            <div className="px-3.5 py-2 border-b border-[#30363d] flex items-center justify-between text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
              <span>Work orders ({workOrders.length})</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {workOrders.length === 0 && (
                <p className="p-3 text-xs text-[#8b949e]">
                  No work orders yet. Set up the factory config for this project, then create one with "New work
                  order".
                </p>
              )}
              {listed.map((wo) => {
                const isSelected = view === "detail" && selected?.id === wo.id;
                return (
                  <button
                    key={wo.id}
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => {
                      setSelectedId(wo.id);
                      setView("detail");
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? "bg-[#21262d] border-[#58a6ff] shadow-md"
                        : "bg-[#0d1117]/80 border-[#30363d] hover:border-[#8b949e]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <span className="font-mono text-xs font-bold text-[#58a6ff]">{wo.id}</span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-semibold ${statusBadgeClass(wo.status)}`}
                      >
                        {STATUS_LABEL[wo.status]}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-white line-clamp-1 mb-1">{wo.title}</div>
                    <div className="flex items-center justify-between text-[11px] text-[#8b949e] font-mono">
                      <span className="flex items-center gap-1 truncate max-w-[150px]">
                        <GitBranch className="w-3 h-3 text-[#58a6ff] shrink-0" aria-hidden="true" />
                        <span className="truncate">{wo.branchName}</span>
                      </span>
                      <span>{formatRelative(wo.updatedAtMs, now)}</span>
                    </div>
                    <div className="grid grid-cols-6 gap-1 mt-2.5" aria-hidden="true">
                      {wo.stages.map((st) => (
                        <div key={st.id} className={`h-1.5 rounded-full ${stageBarClass(st.status)}`} />
                      ))}
                    </div>
                  </button>
                );
              })}
              {workOrders.length > MAX_LISTED && (
                <p className="px-1 text-[11px] text-[#8b949e]">
                  Showing the newest {MAX_LISTED} of {workOrders.length}.
                </p>
              )}
            </div>
          </aside>

          <main className="flex-1 min-w-0 overflow-y-auto p-5">
            {view === "config" ? (
              <FactoryConfigPanel
                activeProject={activeProject}
                projectInfo={projectInfo}
                projectError={projectError}
                onSaved={(info) => {
                  setProjectInfo(info);
                  setNotice({ kind: "info", text: "Saved .machina/factory.json." });
                }}
              />
            ) : view === "compose" ? (
              <WorkOrderComposer
                activeProject={activeProject}
                projectInfo={projectInfo}
                projectError={projectError}
                workOrders={workOrders}
                onCancel={() => setView("detail")}
                onOpenConfig={() => setView("config")}
                onCreated={(wo) => {
                  setSelectedId(wo.id);
                  setView("detail");
                  setNotice({
                    kind: "info",
                    text:
                      wo.status === "ON_HOLD"
                        ? `${wo.id} is on hold; see the decision card.`
                        : wo.status === "QUEUED"
                          ? `${wo.id} is queued.`
                          : `${wo.id} submitted; creating its worktree.`,
                  });
                  void refresh();
                }}
              />
            ) : selected ? (
              <WorkOrderDetail
                wo={selected}
                now={now}
                terminals={terminals}
                busy={busy}
                run={run}
                onLaunchAuthor={(wo) => void launchAuthor(wo)}
                onOpenTerminal={openTerminal}
              />
            ) : (
              <div className="max-w-xl space-y-2 text-xs text-[#8b949e]">
                <p className="text-sm font-bold text-white">How Machina works</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Describe the gate in Factory config: setup, Tier 1 checks, and Tier 2 holdback commands.</li>
                  <li>
                    Put blind tests in .machina/holdbacks/ (untracked). Each work order vaults a pinned copy and keeps
                    them out of the author's worktree.
                  </li>
                  <li>Submit a work order. Machina creates a branch and a worktree under .machina/worktrees/.</li>
                  <li>Launch the author agent in that worktree and send it the brief.</li>
                  <li>Run the gate. Failures go back to the author until the corrections run out.</li>
                  <li>When the gate passes, squash-merge into the base branch.</li>
                </ol>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};
