import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, ExternalLink, FolderPlus, GitBranch, RefreshCw, WifiOff, X } from "lucide-react";
import { useOverlay } from "../../overlay/useOverlay";
import { ToposIcon } from "./ToposIcon";
import { errorMessage, gateView, GIT_DOWNLOAD_URL, type GitVersionStatus } from "./gitVersion";
import { GraphList } from "./GraphList";
import { DEFAULT_COLUMN_WIDTH } from "./graphColumn";
import { refsView } from "./graphRefs";
import { useGraphRefs } from "./useGraphRefs";
import { useGraphSession, type GraphOrder } from "./useGraphSession";
import { useLiveUpdates } from "./useLiveUpdates";

/** The repository or worktree Topos works on: the Rail selection when Topos is shown. */
export interface ToposTarget {
  path: string;
  /** The project's name, or `Project · branch` for a worktree. */
  name: string;
  /** The registered project's root repo, whose graph Topos draws for each of its worktrees. */
  repoPath: string;
}

export interface ToposOverlayProps {
  isOpen: boolean;
  /** The active Rail selection, or null when no project is open. */
  project: ToposTarget | null;
  onClose: () => void;
  onAddProject: () => void;
}

type VersionCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "done"; status: GitVersionStatus }
  | { state: "failed"; message: string };

/**
 * Topos, the visual Git cockpit (#349): a full-window overlay toggled by `Ctrl+Shift+B c`. Closing
 * hides it without unmounting, so its state survives until it is shown again. It targets the Rail
 * selection it was shown with, and checks git's version on its first open (#369).
 */
export const ToposOverlay: React.FC<ToposOverlayProps> = ({ isOpen, project, onClose, onAddProject }) => {
  const titleId = useId();
  const { backdropProps, panelProps } = useOverlay({ isOpen, onClose });

  // Retarget each time Topos is shown; while hidden it keeps the target it last showed.
  const [target, setTarget] = useState<ToposTarget | null>(project);
  useEffect(() => {
    if (isOpen) setTarget(project);
  }, [isOpen, project]);
  // Counts the times Topos has been shown, so each show reads the refs again.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (isOpen) setShown((n) => n + 1);
  }, [isOpen]);

  const [check, setCheck] = useState<VersionCheck>({ state: "idle" });
  // Only the newest check may set the result, so a slow first check can't overwrite a Retry.
  const checkId = useRef(0);
  const runCheck = useCallback((retry: boolean) => {
    const id = ++checkId.current;
    setCheck({ state: "checking" });
    invoke<GitVersionStatus>("git_version_check", { retry })
      .then((status) => {
        if (id === checkId.current) setCheck({ state: "done", status });
      })
      .catch((e: unknown) => {
        if (id === checkId.current) setCheck({ state: "failed", message: errorMessage(e) });
      });
  }, []);
  useEffect(() => {
    if (isOpen && check.state === "idle") runCheck(false);
  }, [isOpen, check.state, runCheck]);

  const view =
    check.state === "done"
      ? gateView(check.status)
      : check.state === "failed"
        ? ({ kind: "blocked", title: "Couldn't run git", detail: check.message } as const)
        : null;

  // Date order by default; the toggle reopens the session in topo order. Not persisted (#369).
  const [order, setOrder] = useState<GraphOrder>("date");
  // Outlives the list, which remounts for each order and target. Persisting it is the settings ticket's.
  const [columnWidth, setColumnWidth] = useState(DEFAULT_COLUMN_WIDTH);
  // The graph belongs to the root repo, so moving between its worktrees keeps the session.
  const graphRepo = target && view?.kind === "open" ? target.repoPath : null;
  const graph = useGraphSession(graphRepo, order);
  // Refs are per repo too, so a move between its worktrees moves only the HEAD marker (#378).
  const refsReader = useGraphRefs(graphRepo, shown);
  const refs = refsReader.refs;
  const selectedPath = target?.path ?? null;
  const refsShown = useMemo(() => refsView(refs, selectedPath), [refs, selectedPath]);
  // The watch follows the selected worktree; its files are watched only while Topos shows (#379).
  const liveTarget = useMemo(
    () => (graphRepo !== null && selectedPath !== null ? { repoPath: graphRepo, worktreePath: selectedPath } : null),
    [graphRepo, selectedPath]
  );
  const retryLiveUpdates = useLiveUpdates(liveTarget, isOpen, graph, refsReader);
  const watch = graph.feed?.watch ?? null;

  return (
    <div
      {...backdropProps}
      className={isOpen ? "fixed inset-0 z-40 flex bg-black/75 backdrop-blur-xs p-3" : "hidden"}
    >
      <div
        {...panelProps}
        aria-labelledby={titleId}
        className="relative flex flex-col w-full h-full bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden text-[#c9d1d9] outline-none"
      >
        <header className="h-12 px-4 bg-[#161b22] border-b border-[#30363d] flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/40 flex items-center justify-center shrink-0">
            <ToposIcon className="w-5 h-5" />
          </div>
          <h2 id={titleId} className="text-sm font-bold text-white shrink-0">
            Topos
          </h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#bc8cff] font-mono border border-[#30363d] shrink-0">
            Ctrl+Shift+B C
          </span>
          {target && (
            <span className="text-xs text-[#8b949e] truncate min-w-0" title={target.path}>
              {target.name}
            </span>
          )}
          {watch?.state === "off" && (
            <span
              role="status"
              className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-[#d29922]/40 bg-[#d29922]/10 text-xs text-[#d29922] shrink-0"
              title={`${watch.reason}. Topos checks for changes when its window regains focus.`}
            >
              <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
              Live updates off; the view may be stale
              <button
                type="button"
                onClick={retryLiveUpdates}
                className="ml-1 inline-flex items-center gap-1 px-1.5 rounded border border-[#d29922]/40 hover:bg-[#d29922]/20 text-[#e3b341]"
              >
                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                Retry
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={() => setOrder((o) => (o === "topo" ? "date" : "topo"))}
            aria-pressed={order === "topo"}
            title="Show each branch's commits together (git log --topo-order)"
            className={`${watch?.state === "off" ? "" : "ml-auto "}inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs ${
              order === "topo"
                ? "border-[#06B6D4]/60 bg-[#06B6D4]/10 text-white"
                : "border-[#30363d] text-[#8b949e] hover:text-white hover:bg-[#21262d]"
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
            Topo order
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Topos"
            title="Close (Esc)"
            className="p-1.5 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        {!target ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
            <p className="text-sm text-[#8b949e]">Open a project to see its commits in Topos.</p>
            <button
              type="button"
              onClick={onAddProject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold"
            >
              <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
              Add project
            </button>
          </div>
        ) : view === null ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#8b949e]" role="status">
            Checking git…
          </div>
        ) : view.kind === "blocked" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6" role="alert">
            <AlertTriangle className="w-6 h-6 text-[#d29922]" aria-hidden="true" />
            <p className="text-sm font-semibold text-white">{view.title}</p>
            <p className="text-xs text-[#8b949e] max-w-md break-words">{view.detail}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openUrl(GIT_DOWNLOAD_URL).catch(console.error)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-[#c9d1d9]"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                Get git from git-scm.com
              </button>
              <button
                type="button"
                onClick={() => runCheck(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {view.warning && (
              <p
                role="status"
                className="px-4 py-1.5 text-xs text-[#d29922] bg-[#d29922]/10 border-b border-[#d29922]/30 truncate"
                title={view.warning}
              >
                {view.warning}
              </p>
            )}
            {watch?.state === "gone" ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6" role="status">
                <p className="text-sm text-white">This worktree or repository is gone.</p>
                <p className="text-xs text-[#8b949e] max-w-md break-words">
                  {target.path} was moved or removed. Pick another project or worktree in the Rail.
                </p>
              </div>
            ) : graph.feed ? (
              <GraphList
                key={`${order}:${target.repoPath}`}
                feed={graph.feed}
                version={graph.version}
                onReachedRow={graph.reachedRow}
                columnWidth={columnWidth}
                onColumnWidth={setColumnWidth}
                refs={refsShown}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-[#8b949e]" role="status">
                Loading commits…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
