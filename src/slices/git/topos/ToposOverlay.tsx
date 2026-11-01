import React, { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, ExternalLink, FolderPlus, GitBranch, RefreshCw, WifiOff, X } from "lucide-react";
import { useOverlay } from "../../overlay/useOverlay";
import type { RunKind, TerminalInfo } from "../../terminal/types";
import { ToposIcon } from "./ToposIcon";
import { errorMessage, gateView, GIT_DOWNLOAD_URL, type GitVersionStatus } from "./gitVersion";
import { GraphList } from "./GraphList";
import type { FindKeyEvent } from "./graphFind";
import { refsView, type RefBadge } from "./graphRefs";
import { DEFAULT_REF_SET, graphRefSet, NO_AGENTS, showOnly } from "./graphFilters";
import { highlightKinds } from "./agentHighlight";
import { GraphFilterBar } from "./GraphFilterBar";
import { useGraphFilters } from "./useGraphFilters";
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
import { ConfirmDialog } from "./ConfirmDialog";
import { ToposModalScope, useToposModal } from "./ToposModal";
import { checkoutBlockedBy, type RefAction, type RefContext } from "./refActions";
import { ToastQueue } from "./ToastQueue";
import type { ToposRequestKind } from "./toposPalette";
import { useRefActions } from "./useRefActions";
import { RemoteToolbar } from "./RemoteToolbar";
import { useRemoteOps } from "./useRemoteOps";
import { CommitInspector, CompareInspector } from "./CommitInspector";
import { selectCommits, selectionOids, type CommitSelection } from "./commitSelection";
import { CommitFileDiffView } from "./CommitFileDiffView";
import type { CommitFile } from "./commitDetails";
import {
  filesOfPair,
  isPairFile,
  isParentFile,
  useCommitDetails,
  useCommitDiff,
  useCommitFiles,
  useCompare,
  type OpenCommitFile,
} from "./useCommitDetails";

const NO_SELECTION: CommitSelection = { kind: "none" };
const NO_REF_BADGES: RefBadge[] = [];

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
  /**
   * Retargets the Rail selection to the worktree at `path`, for "Show that worktree" (#393).
   * Resolves to false when the Rail doesn't list that worktree.
   */
  onShowWorktree?: (path: string) => boolean;
  /**
   * Opens a plain shell terminal in `cwd`, types `argv` into it quoted for its shell, then Enter,
   * for Run in terminal (#395). Resolves to false when the command can't be typed safely.
   */
  onRunInTerminal?: (cwd: string, argv: string[]) => Promise<boolean>;
  /** A palette entry's request (#393, #395), with a count so the same request twice runs twice. */
  request?: { kind: ToposRequestKind; seq: number } | null;
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
export const ToposOverlay: React.FC<ToposOverlayProps> = ({
  isOpen,
  project,
  onClose,
  onAddProject,
  terminals,
  onOpenTerminal,
  onNewAgent,
  onShowWorktree,
  onRunInTerminal,
  request = null,
}) => {
  const titleId = useId();
  // One modal layer for every confirm in Topos (#421): while one is open everything else in the panel
  // is inert. A click on the backdrop waits for it too.
  const modal = useToposModal();
  const modalLayer = modal.layer;
  const closeUnlessModal = useCallback(() => {
    if (!modalLayer.isOpen()) onClose();
  }, [modalLayer, onClose]);
  const { backdropProps, panelProps } = useOverlay({ isOpen, onClose: closeUnlessModal });

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
  // Refs are per repo too, so a move between its worktrees moves only the HEAD marker (#378).
  const refsReader = useGraphRefs(graphRepo, shown);
  const refs = refsReader.refs;
  const selectedPath = target?.path ?? null;
  // The branch filter and toggles (#401), remembered per repo, and the agent highlights. They last
  // while Topos is hidden, as the session does.
  const graphFilters = useGraphFilters(graphRepo, refs);
  const filterState = graphFilters.state;
  const setFilterState = graphFilters.set;
  const filters = filterState?.filters ?? null;
  // A filter names the selected worktree, whose HEAD it always walks; with none, moving between
  // worktrees keeps the session.
  const refSet = useMemo(() => (filters === null ? null : graphRefSet(filters, selectedPath)), [filters, selectedPath]);
  const graph = useGraphSession(graphRepo, order, refSet);
  const tagsWalked = filters?.tags ?? false;
  const refsShown = useMemo(() => {
    const view = refsView(refs, selectedPath);
    // With tags walked, no tagged commit is left out, so the footer has nothing to say.
    return tagsWalked ? { ...view, tagOnlyNote: null } : view;
  }, [refs, selectedPath, tagsWalked]);
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
  const [openFile, setStagingFile] = useState<OpenFile | null>(null);
  useEffect(() => setStagingFile(null), [selectedPath]);
  // A commit file's read-only diff in its place (#397); one diff shows at a time.
  const [commitFile, setCommitFile] = useState<OpenCommitFile | null>(null);
  const setOpenFile = useCallback((file: OpenFile | null) => {
    setStagingFile(file);
    if (file !== null) setCommitFile(null);
  }, []);
  // The selected commits (#397, #398): one puts the inspector in details mode, two compare them.
  // The graph belongs to the root repo, so the selection and its open diff last until the repo changes.
  const [selection, dispatchSelection] = useReducer(selectCommits, NO_SELECTION);
  const { selectedOid, comparedOid } = selectionOids(selection);
  useEffect(() => {
    dispatchSelection({ kind: "clear" });
    setCommitFile(null);
  }, [graphRepo]);
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
  // The inspector shows the staging lists or, once a commit is selected, its details (#397).
  const [inspectorMode, setInspectorMode] = useState<"staging" | "details">("staging");
  const stagingShown = inspectorOpen && inspectorMode === "staging";
  const details = useCommitDetails(graphRepo, selection.kind === "one" ? selection.oid : null);
  const compare = useCompare(graphRepo, selectedOid, comparedOid, selection.kind === "two" && selection.swapped);
  const shownOid = details.pending ? null : (details.shown?.oid ?? null);
  // A merge's files diff against parent 1 unless the picker chose another for that commit.
  const [parentPick, setParentPick] = useState<{ oid: string | null; index: number }>({ oid: null, index: 1 });
  const parentIndex = parentPick.oid !== null && parentPick.oid === shownOid ? parentPick.index : 1;
  const onParentIndex = useCallback((oid: string, index: number) => setParentPick({ oid, index }), []);
  const commitFiles = useCommitFiles(graphRepo, shownOid, parentIndex);
  const commitDiff = useCommitDiff(graphRepo, commitFile);
  const graphFocus = useRef<(() => void) | null>(null);
  const findKeys = useRef<((e: FindKeyEvent) => boolean) | null>(null);
  const inspectorFocus = useRef<HTMLElement | null>(null);
  const [inspectRequest, setInspectRequest] = useState(0);
  useEffect(() => {
    if (inspectRequest > 0) inspectorFocus.current?.focus();
  }, [inspectRequest]);
  const selectCommit = useCallback((oid: string) => {
    dispatchSelection({ kind: "pick", oid });
    setInspectorMode("details");
    setInspectorOpen(true);
  }, []);
  const addCommit = useCallback((oid: string) => {
    dispatchSelection({ kind: "add", oid });
    setInspectorMode("details");
    setInspectorOpen(true);
  }, []);
  const swapCompare = useCallback(() => dispatchSelection({ kind: "swap" }), []);
  const inspect = useCallback(() => {
    setInspectorMode("details");
    setInspectorOpen(true);
    setInspectRequest((n) => n + 1);
  }, []);
  const focusGraph = useCallback(() => graphFocus.current?.(), []);
  const openCommitFile = useCallback(
    (file: CommitFile) => {
      const shown = details.shown;
      if (shown === null) return;
      setStagingFile(null);
      setCommitFile({
        oid: shown.oid,
        against: { kind: "parent", index: parentIndex, oid: shown.parents[parentIndex - 1] ?? null },
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
      });
    },
    [details.shown, parentIndex]
  );
  // A compared pair's file opens the diff from the pair's `from` to its `to` (#398).
  const comparePair = compare.pair;
  const compareFiles = filesOfPair(compare.files, comparePair)?.files ?? null;
  const openCompareFile = useCallback(
    (file: CommitFile) => {
      if (comparePair === null) return;
      setStagingFile(null);
      setCommitFile({
        oid: comparePair.to.oid,
        against: { kind: "commit", oid: comparePair.from.oid },
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
      });
    },
    [comparePair]
  );
  // The list the open commit file belongs to, for ↑/↓ in the diff: the compared pair's or the commit's.
  const comparing = selection.kind === "two";
  const openIsCompared = isPairFile(commitFile, comparePair);
  const openIsCommits = commitFiles.state === "done" && isParentFile(commitFile, shownOid, parentIndex);
  const stepFiles: CommitFile[] | null = comparing
    ? openIsCompared
      ? compareFiles
      : null
    : openIsCommits && commitFiles.state === "done"
      ? commitFiles.files.files
      : null;
  const commitFileIndex = stepFiles === null || commitFile === null ? -1 : stepFiles.findIndex((f) => f.path === commitFile.path);
  const openStepped = comparing ? openCompareFile : openCommitFile;
  const stepCommitFile = useCallback(
    (direction: -1 | 1) => {
      if (stepFiles === null || commitFileIndex === -1) return;
      const next = stepFiles[commitFileIndex + direction];
      if (next) openStepped(next);
    },
    [stepFiles, commitFileIndex, openStepped]
  );
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
            open: stagingShown,
            onToggle: () => {
              setInspectorMode("staging");
              setInspectorOpen(!stagingShown);
            },
            controls: inspectorId,
          }
        : null,
    [changed, headOid, target, stagingShown, inspectorId]
  );
  // Checkout and create branch from badges, rows, keys and the palette (#393).
  const showWorktree = useCallback((path: string) => onShowWorktree?.(path) ?? false, [onShowWorktree]);
  const openInspector = useCallback(() => {
    setInspectorMode("staging");
    setInspectorOpen(true);
  }, []);
  const opKind = operation.op?.kind ?? null;
  const slotBusy = staging.busy !== null;
  const checkoutBusy = checkoutBlockedBy(opKind, slotBusy);
  const refActions = useRefActions({
    worktreePath: graphRepo !== null ? selectedPath : null,
    repoPath: graphRepo,
    busy: checkoutBusy,
    staging,
    refs: refsReader,
    onLanded: liveUpdates.committed,
    onShowWorktree: showWorktree,
    onOpenInspector: openInspector,
  });
  // Fetch, pull and push from the toolbar and the palette (#395), sharing the toasts and dialog.
  const remote = useRemoteOps({
    worktreePath: graphRepo !== null ? selectedPath : null,
    repoPath: graphRepo,
    staging,
    refs: refsReader,
    onLanded: liveUpdates.committed,
    toast: refActions.toast,
    openDialog: refActions.openDialog,
    onRunInTerminal,
  });
  // The menus push tags to and delete branches from the repo's remotes (#396). Joined into one
  // string so a new sync read with the same remotes keeps the same list.
  const remotesKey = (remote.sync?.remotes ?? []).join("\n");
  const remoteNames = useMemo(() => (remotesKey === "" ? [] : remotesKey.split("\n")), [remotesKey]);
  const refWorktrees = refs.state === "done" ? refs.refs.worktrees : null;
  const refContext = useMemo<RefContext | null>(
    () => (refWorktrees === null ? null : { selectedPath, worktrees: refWorktrees, busy: checkoutBusy, remotes: remoteNames }),
    [refWorktrees, selectedPath, checkoutBusy, remoteNames]
  );
  const { run: runRefAction, deleteTagNow } = refActions;
  const { pushTag, deleteRemoteBranch, deleteTag } = remote;
  const onRefAction = useCallback(
    (action: RefAction) => {
      switch (action.kind) {
        case "pushTag":
          return pushTag(action.remote, action.name);
        case "deleteRemoteBranch":
          return deleteRemoteBranch(action.remote, action.branch);
        case "deleteTag":
          return deleteTag(action.name, deleteTagNow);
        case "showOnly":
          if (filterState !== null) setFilterState({ ...filterState, filters: showOnly(filterState.filters, action.ref) });
          return;
        default:
          return runRefAction(action);
      }
    },
    [pushTag, deleteRemoteBranch, deleteTag, deleteTagNow, runRefAction, filterState, setFilterState]
  );
  // A palette request runs once Topos shows a repo whose refs are read.
  const handledRequest = useRef(0);
  const { newBranch, pickCheckout } = refActions;
  const { fetch: fetchRemote, pull: pullRemote, push: pushRemote } = remote;
  useEffect(() => {
    if (!isOpen || request === null || request.seq === handledRequest.current || refContext === null) return;
    handledRequest.current = request.seq;
    switch (request.kind) {
      case "newBranch":
        return newBranch("HEAD");
      case "checkout":
        return pickCheckout();
      case "fetch":
        return fetchRemote();
      case "pull":
        return pullRemote();
      case "push":
        return pushRemote();
    }
  }, [isOpen, request, refContext, newBranch, pickCheckout, fetchRemote, pullRemote, pushRemote]);
  const newBranchAtHead = useCallback(() => newBranch("HEAD"), [newBranch]);
  const watch = graph.feed?.watch ?? null;
  // The speed-up banner (#385): after slow first rows, or past 50k commits with no commit-graph.
  const speedup = useSpeedup(graphRepo);
  const [speedupOpen, setSpeedupOpen] = useState(false);
  useEffect(() => setSpeedupOpen(false), [graphRepo]);
  const feed = graph.feed;
  const showSpeedup =
    feed !== null &&
    offerSpeedup(speedup.check, { ...feed.load(), dismissed: speedup.dismissed });

  // Find's keys work anywhere in Topos while the graph shows (#399), but not in a dialog drawn over
  // it, nor while a diff or the conflict resolver covers the graph and its find field.
  const graphCovered = openFile !== null || commitFile !== null || resolving !== null;
  const panel = panelProps.ref;
  useEffect(() => {
    const el = panel.current;
    if (!el || graphCovered) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const surface = e.target instanceof Element ? e.target.closest('[role="dialog"], [role="alertdialog"]') : null;
      if (surface !== el) return;
      if (findKeys.current?.(e)) e.preventDefault();
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [panel, graphCovered]);

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
        {/* Everything a confirm blocks while it is open; the confirms draw beside it, over the whole panel. */}
        <ToposModalScope modal={modal}>
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
            {watch?.state !== "gone" && <RemoteToolbar remote={remote} onNewBranch={newBranchAtHead} />}
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
            {filterState !== null && watch?.state !== "gone" && (
              <GraphFilterBar
                state={filterState}
                onChange={setFilterState}
                refs={refs.state === "done" ? refs.refs.refs : NO_REF_BADGES}
                kinds={highlightKinds([null, ...(graph.feed?.store?.agentsSeen() ?? [])])}
              />
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
                  <div className="isolate flex-1 min-h-0 flex flex-col" inert={openFile !== null || commitFile !== null}>
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
                      refContext={refContext}
                      onRefAction={onRefAction}
                      onPrimary={refActions.runPrimary}
                      announce={staging.announce}
                      selectedOid={selectedOid}
                      onSelect={selectCommit}
                      comparedOid={comparedOid}
                      onAddSelection={addCommit}
                      onInspect={inspect}
                      focusRef={graphFocus}
                      visible={isOpen}
                      findKeysRef={findKeys}
                      repoPath={graphRepo}
                      refSet={refSet ?? DEFAULT_REF_SET}
                      agentKinds={filterState?.agents ?? NO_AGENTS}
                    />
                  </div>
                  {commitFile && (
                    <CommitFileDiffView
                      key={`${commitFile.oid}:${commitFile.against.kind}:${commitFile.against.oid ?? ""}:${commitFile.path}`}
                      file={commitFile}
                      reader={commitDiff}
                      mode={prefs.diffMode}
                      onMode={setDiffMode}
                      onStep={commitFileIndex === -1 ? null : stepCommitFile}
                      canStep={{
                        previous: commitFileIndex > 0,
                        next: stepFiles !== null && commitFileIndex !== -1 && commitFileIndex < stepFiles.length - 1,
                      }}
                      onBack={() => setCommitFile(null)}
                      visible={isOpen}
                    />
                  )}
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
                {inspectorOpen && inspectorMode === "details" && graphRepo !== null && comparing && (
                  <div className="contents" inert={resolving !== null}>
                    <CompareInspector
                      id={inspectorId}
                      compare={compare}
                      width={prefs.inspectorWidth}
                      onWidth={setInspectorWidth}
                      onClose={() => setInspectorOpen(false)}
                      onSwap={swapCompare}
                      openFile={commitFile}
                      onOpenFile={openCompareFile}
                      onEscape={focusGraph}
                      focusRef={inspectorFocus}
                    />
                  </div>
                )}
                {inspectorOpen && inspectorMode === "details" && graphRepo !== null && !comparing && (
                  <div className="contents" inert={resolving !== null}>
                    <CommitInspector
                      id={inspectorId}
                      repoPath={graphRepo}
                      details={details}
                      width={prefs.inspectorWidth}
                      onWidth={setInspectorWidth}
                      onClose={() => setInspectorOpen(false)}
                      badgesOf={(oid) => refsShown.badges.get(oid) ?? []}
                      onCopy={(sha) => runRefAction({ kind: "copySha", oid: sha })}
                      onSelectCommit={selectCommit}
                      files={commitFiles}
                      parentIndex={parentIndex}
                      onParentIndex={onParentIndex}
                      openFile={commitFile}
                      onOpenFile={openCommitFile}
                      onEscape={focusGraph}
                      focusRef={inspectorFocus}
                    />
                  </div>
                )}
                {stagingShown && (
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
        <ToastQueue toasts={refActions.toasts} onDismiss={refActions.dismiss} />
        <ConfirmDialog request={refActions.dialog} onCancel={refActions.closeDialog} />
        </ToposModalScope>
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
