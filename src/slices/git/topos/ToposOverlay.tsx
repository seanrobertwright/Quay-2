import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, ExternalLink, FolderPlus, GitBranch, RefreshCw, WifiOff, X } from "lucide-react";
import { useOverlay } from "../../overlay/useOverlay";
import type { RunKind, TerminalInfo } from "../../terminal/types";
import { ToposIcon } from "./ToposIcon";
import { errorMessage, gateView, GIT_DOWNLOAD_URL, type GitVersionStatus } from "./gitVersion";
import { GraphList } from "./GraphList";
import { refsView } from "./graphRefs";
import { liveAgentsAt } from "./provenance";
import { useGraphRefs } from "./useGraphRefs";
import { useGraphSession, type GraphOrder } from "./useGraphSession";
import { useLiveUpdates } from "./useLiveUpdates";
import { FileDiffView, type DiffMode } from "./FileDiffView";
import { StagingInspector } from "./StagingInspector";
import { wipLabel } from "./stagingKeys";
import { otherSide, splitStatus, type ListMode } from "./stagingLists";
import { useFileDiff, type OpenFile } from "./useFileDiff";
import { useCommit } from "./useCommit";
import { useOperation } from "./useOperation";
import { OperationBanner } from "./OperationBanner";
import { ConflictResolver } from "./ConflictResolver";
import { HandToAgentDialog } from "./HandToAgentDialog";
import { useHandToAgent } from "./useHandToAgent";
import { useStaging } from "./useStaging";
import { useToposSettings } from "./useToposSettings";
import { offerSpeedup } from "./speedup";
import { SpeedupBanner, SpeedupDialog } from "./SpeedupDialog";
import { useSpeedup } from "./useSpeedup";
import { isSamePath } from "../../../utils/paths";

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
  /** Quay's terminals, whose live agents show on their worktree's HEAD marker (#381). */
  terminals: TerminalInfo[];
  /** Opens a shell terminal in `cwd` and shows it, for a conflict resolved by hand (#391). */
  onOpenTerminal?: (cwd: string) => void;
  /** Starts an agent terminal in `cwd` for a conflict handed to a new agent (#392). */
  onNewAgent?: (cwd: string) => Promise<TerminalInfo | null>;
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
export const ToposOverlay: React.FC<ToposOverlayProps> = ({ isOpen, project, onClose, onAddProject, terminals, onOpenTerminal, onNewAgent }) => {
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
  // The column and inspector widths, the diff mode and the list mode live in topos.json (#384), so
  // they outlive the views they size and Quay's restarts.
  const { prefs, setPref, recordOpen } = useToposSettings();
  const setColumnWidth = useCallback((width: number) => setPref("graphColumnWidth", width), [setPref]);
  const setInspectorWidth = useCallback((width: number) => setPref("inspectorWidth", width), [setPref]);
  const setDiffMode = useCallback((mode: DiffMode) => setPref("diffMode", mode), [setPref]);
  const setListMode = useCallback((mode: ListMode) => setPref("fileListMode", mode), [setPref]);
  // The graph belongs to the root repo, so moving between its worktrees keeps the session.
  const graphRepo = target && view?.kind === "open" ? target.repoPath : null;
  // Each show of a repo is an open, which keeps its entry among the 200 the store keeps.
  useEffect(() => {
    if (isOpen && graphRepo !== null) recordOpen(graphRepo);
  }, [isOpen, graphRepo, shown, recordOpen]);
  const graph = useGraphSession(graphRepo, order);
  // Refs are per repo too, so a move between its worktrees moves only the HEAD marker (#378).
  const refsReader = useGraphRefs(graphRepo, shown);
  const refs = refsReader.refs;
  const selectedPath = target?.path ?? null;
  const refsShown = useMemo(() => refsView(refs, selectedPath), [refs, selectedPath]);
  // Terminal statuses change often; the map, and so the rows, change only when the agents per
  // worktree do.
  const agentsKey = JSON.stringify(
    refs.state === "done" ? refs.refs.worktrees.map((w) => [w.path, liveAgentsAt(terminals, w.path)]) : []
  );
  const worktreeAgents = useMemo(
    () => new Map((JSON.parse(agentsKey) as [string, RunKind[]][]).filter(([, kinds]) => kinds.length > 0)),
    [agentsKey]
  );
  // The watch follows the selected worktree; its files are watched only while Topos shows (#379).
  const liveTarget = useMemo(
    () => (graphRepo !== null && selectedPath !== null ? { repoPath: graphRepo, worktreePath: selectedPath } : null),
    [graphRepo, selectedPath]
  );
  // The inspector works on the selected worktree's own index (#349, #382).
  const staging = useStaging(graphRepo !== null ? selectedPath : null, shown);
  // A file's diff in place of the graph (#383). It closes when the worktree changes.
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  useEffect(() => setOpenFile(null), [selectedPath]);
  const fileDiff = useFileDiff(graphRepo !== null ? selectedPath : null, openFile, staging);
  const liveUpdates = useLiveUpdates(liveTarget, isOpen, graph, refsReader, staging, openFile ? fileDiff : null);
  // The composer commits on the selected worktree, and hands its new HEAD to the refresh table (#388).
  const commit = useCommit(graphRepo !== null ? selectedPath : null, staging, liveUpdates.committed);
  // The operation under way and its banner (#389), whose steps hand HEAD to the refresh table too.
  const operation = useOperation(graphRepo !== null ? selectedPath : null, staging, liveUpdates.committed);
  // Conflicts handed to an agent terminal (#392), held per worktree and read with each operation read.
  const handToAgent = useHandToAgent({
    worktreePath: graphRepo !== null ? selectedPath : null,
    op: operation.op,
    terminals,
    onNewAgent,
    announce: staging.announce,
  });
  // The conflicted file open in the three-pane resolver (#390), in place of the graph and inspector.
  const [resolving, setResolving] = useState<string | null>(null);
  useEffect(() => setResolving(null), [selectedPath]);
  const closeResolver = useCallback(() => setResolving(null), []);
  const continueRef = useRef<HTMLButtonElement>(null);
  const goToContinue = useCallback(() => continueRef.current?.focus(), []);
  const otherSideHasChanges = useMemo(() => {
    if (openFile === null || staging.status.state !== "done") return false;
    return splitStatus(staging.status.status.entries)[otherSide(openFile.side)].some((c) => c.path === openFile.path);
  }, [openFile, staging.status]);
  const inspectorId = useId();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const changed = staging.status.state === "done" ? staging.status.status.total : 0;
  const headOid =
    refs.state === "done" && selectedPath !== null
      ? (refs.refs.worktrees.find((w) => isSamePath(w.path, selectedPath))?.oid ?? null)
      : null;
  const wip = useMemo(
    () =>
      changed > 0 && target !== null
        ? {
            label: wipLabel(changed),
            headOid,
            worktreeName: target.name,
            open: inspectorOpen,
            onToggle: () => setInspectorOpen((open) => !open),
            controls: inspectorId,
          }
        : null,
    [changed, headOid, target, inspectorOpen, inspectorId]
  );
  const watch = graph.feed?.watch ?? null;
  // The speed-up banner (#385): after slow first rows, or past 50k commits with no commit-graph.
  const speedup = useSpeedup(graphRepo);
  const [speedupOpen, setSpeedupOpen] = useState(false);
  useEffect(() => setSpeedupOpen(false), [graphRepo]);
  const feed = graph.feed;
  const showSpeedup =
    feed !== null &&
    offerSpeedup(speedup.check, { ...feed.load(), dismissed: speedup.dismissed });

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
                onClick={liveUpdates.retry}
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
            {watch?.state !== "gone" && (
              <OperationBanner
                operation={operation}
                stagingBusy={staging.busy !== null && staging.busy.action !== "operation"}
                continueRef={continueRef}
              />
            )}
            {showSpeedup && watch?.state !== "gone" && (
              <SpeedupBanner speedup={speedup} onOpen={() => setSpeedupOpen(true)} />
            )}
            {watch?.state === "gone" ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6" role="status">
                <p className="text-sm text-white">This worktree or repository is gone.</p>
                <p className="text-xs text-[#8b949e] max-w-md break-words">
                  {target.path} was moved or removed. Pick another project or worktree in the Rail.
                </p>
              </div>
            ) : graph.feed ? (
              <div className="relative flex-1 flex min-h-0">
                {resolving !== null && operation.op !== null && (
                  <ConflictResolver
                    key={target.path}
                    worktreePath={target.path}
                    op={operation.op}
                    path={resolving}
                    onPath={setResolving}
                    onClose={closeResolver}
                    staging={staging}
                    onOpenTerminal={onOpenTerminal}
                    handToAgent={handToAgent}
                  />
                )}
                <div className="relative flex-1 min-w-0 flex flex-col" inert={resolving !== null}>
                  {/* The graph stays mounted under an open diff, keeping its scroll and selection. Its own
                      stacking context keeps its raised parts, such as the column handle, under the diff. */}
                  <div className="isolate flex-1 min-h-0 flex flex-col" inert={openFile !== null}>
                    <GraphList
                      key={`${order}:${target.repoPath}`}
                      feed={graph.feed}
                      version={graph.version}
                      onReachedRow={graph.reachedRow}
                      columnWidth={prefs.graphColumnWidth}
                      onColumnWidth={setColumnWidth}
                      refs={refsShown}
                      worktreeAgents={worktreeAgents}
                      wip={wip}
                    />
                  </div>
                  {openFile && (
                    <FileDiffView
                      key={`${openFile.side}:${openFile.path}`}
                      worktreePath={target.path}
                      file={openFile}
                      reader={fileDiff}
                      busy={staging.busy}
                      mode={prefs.diffMode}
                      onMode={setDiffMode}
                      otherSideHasChanges={otherSideHasChanges}
                      onOpenOtherSide={() => setOpenFile({ path: openFile.path, side: otherSide(openFile.side) })}
                      onBack={() => setOpenFile(null)}
                      visible={isOpen}
                      announce={staging.announce}
                    />
                  )}
                </div>
                {inspectorOpen && (
                  // Under the resolver, the inspector keeps its state but takes no focus.
                  <div className="contents" inert={resolving !== null}>
                  <StagingInspector
                    id={inspectorId}
                    staging={staging}
                    worktreeName={target.name}
                    width={prefs.inspectorWidth}
                    onWidth={setInspectorWidth}
                    listMode={prefs.fileListMode}
                    onListMode={setListMode}
                    onClose={() => setInspectorOpen(false)}
                    openFile={openFile}
                    onOpenFile={setOpenFile}
                    commit={commit}
                    conflicts={operation.op}
                    onGoToContinue={goToContinue}
                    onResolve={setResolving}
                    handOffs={handToAgent}
                  />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-[#8b949e]" role="status">
                Loading commits…
              </div>
            )}
          </div>
        )}
        <SpeedupDialog
          open={speedupOpen && graphRepo !== null}
          speedup={speedup}
          onClose={() => setSpeedupOpen(false)}
          fallbackFocus={panelProps.ref}
        />
        <HandToAgentDialog picker={handToAgent.picker} onChoose={handToAgent.choose} onCancel={handToAgent.closePicker} />
        {/* The staging inspector's, the commit composer's and the diff view's one live region, here so it stays while
            either is shown. Keyed by the count, so the same sentence twice in a row is announced twice. */}
        <div role="status" aria-live="polite" className="sr-only">
          <span key={staging.announcement.seq}>{staging.announcement.text}</span>
        </div>
      </div>
    </div>
  );
};
