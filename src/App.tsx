import { useState, useEffect, useMemo, useCallback, useRef, useId } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspace } from "./slices/workspace/useWorkspace";
import { useBridgeEvents } from "./slices/bridge/useBridgeEvents";
import { useAttentionQueue } from "./slices/attention/useAttentionQueue";
import { AttentionSurfaces } from "./slices/attention/AttentionSurfaces";
import { ProjectsPanel } from "./slices/rail/ProjectsPanel";
import { ModuleBar } from "./slices/shell/ModuleBar";
import { TerminalStatusList } from "./slices/shell/TerminalStatusList";
import { askingTerminals, nextWaitingTerminal, prevWaitingTerminal, statusRows } from "./slices/shell/terminalStatus";
import { useOpenPrCount } from "./slices/github/useOpenPrCount";
import { ModulePanel } from "./slices/shell/ModulePanel";
import { ProjectPanel, type ProjectPanelFocus } from "./slices/shell/ProjectPanel";
import { useShellPrefs } from "./slices/shell/useShellPrefs";
import { PieMenuHost } from "./slices/pie/PieMenuHost";
import { pieFolder, pieTerminalId, type PieChoice, type PieTarget, type RecentPaletteCommand } from "./slices/pie/pieRing";
import { pieStrokeLog, type PieStrokeRecord } from "./slices/pie/pieStrokeLog";
import { recentCommands } from "./slices/command-palette/recentCommands";
import { requestTerminal } from "./slices/terminal/terminalRequests";
import { revealFolder } from "./slices/overlay/menuActions";
import { moduleAfterUnfold, type ModuleId } from "./slices/shell/modules";
import { Stage } from "./slices/stage/Stage";
import { Companion, COMPANION_VIEWS, type CompanionInspector, type CompanionShowRequest } from "./slices/companion/Companion";
import { MergeUndoToast } from "./slices/companion/MergeUndoToast";
import { useMergeUndo, type MergeJob } from "./slices/companion/useMergeUndo";
import { useSelectedPullRequest } from "./slices/companion/useSelectedPullRequest";
import { canMerge } from "./slices/companion/readiness";
import type { PullRequestAsk } from "./slices/companion/PullRequestView";
import type { MergeMethod } from "./slices/github/types";
import { SlotLayer } from "./slices/stage/SlotLayer";
import { CanvasHandlesIcon } from "./slices/praxis-builder/CanvasHandlesIcon";
import type { CompanionActivity } from "./slices/companion/ActivityView";
import { messageEntryId } from "./slices/companion/activity";
import { AgentsPanel, type SessionHistoryRequest } from "./slices/agents/AgentsPanel";
import { useTrailMessages } from "./slices/orchestrator/trailMessages";
import { BroadcastDialog } from "./slices/orchestrator/BroadcastDialog";
import type { AttentionItem } from "./slices/attention/attentionQueue";
import type { TicketActions, TicketToStart } from "./slices/companion/TicketView";
import { useDiffLens } from "./slices/companion/useDiffLens";
import { DiffLens } from "./slices/companion/DiffLens";
import { diffLensFor, type DiffLensTarget } from "./slices/companion/diffLensTarget";
import { terminalRepository, worktreeDisplayName } from "./slices/companion/terminalRepository";
import { ReplyStrip } from "./slices/lens/ReplyStrip";
import { latestPermission } from "./slices/attention/attentionQueue";
import { companionPrefs } from "./slices/companion/companionPrefs";
import { useTerminalLinks } from "./slices/companion/useTerminalLinks";
import { NewTerminalModal } from "./slices/terminal/NewTerminalModal";
import { OpenProjectDialog } from "./slices/workspace/OpenProjectDialog";
import { ActionLogDrawer } from "./slices/bridge/ActionLogDrawer";
import { WorkspaceSettingsModal } from "./slices/workspace/WorkspaceSettingsModal";
import { SwarmBuilder } from "./slices/orchestrator/SwarmBuilder";
import { useSavedSwarms } from "./slices/orchestrator/useSavedSwarms";
import { CommandPalette } from "./slices/command-palette/CommandPalette";
import { DiffViewerDrawer } from "./slices/bridge/DiffViewerDrawer";
import { NewWorktreeModal } from "./slices/git/NewWorktreeModal";
import { RemoveWorktreeDialog, WorktreeRemovalPrompt } from "./slices/git/RemoveWorktreeDialog";
import { SourceControlPanel } from "./slices/github/SourceControlPanel";
import { GithubIssue, GithubPullRequest } from "./slices/github/types";
import type { LinkRef, LinkSlotName, RunKind, TerminalInfo } from "./slices/terminal/types";
import { getGlobalTerminalDimensions } from "./slices/terminal/useTerminal";
import { PrePrAuditModal } from "./slices/audit/PrePrAuditModal";
import { AuditViolation } from "./slices/audit/types";
import { TokenSpendModal } from "./slices/metrics/TokenSpendModal";
import { ArchonGraphModal, type ArchonTab } from "./slices/archon/ArchonGraphModal";
import { ArchonWorkflow, type SpecTask } from "./slices/archon/types";
import { workflowTerminalName } from "./slices/archon/workflowName";
import { WorkflowsPanel, type StartActions } from "./slices/workflows/WorkflowsPanel";
import { RunView } from "./slices/workflows/RunView";
import { RunLens } from "./slices/workflows/RunLens";
import { FactoryConfigTab, NewWorkOrderTab } from "./slices/workflows/FactoryTabs";
import { lookupGraphRunPage, useWorkflowsData } from "./slices/workflows/useWorkflowsData";
import { runSources } from "./slices/workflows/workflowsData";
import { rowOf, runTerminalId, type RunSource } from "./slices/workflows/workflowRuns";
import { workflowPrefs } from "./slices/workflows/workflowPrefs";
import { openRunPageOf } from "./slices/praxis-builder/runPage";
import type { MachinaWorkOrder } from "./slices/machina/types";
import type { CompanionViewId } from "./slices/companion/companionViews";
import { BuilderProject, PraxisBuilder, type PraxisBuilderHandle } from "./slices/praxis-builder/PraxisBuilder";
import { Topos, type ToposTarget } from "./slices/git/topos/Topos";
import { ToposLayer, ToposLens, useToposDock } from "./slices/companion/ToposDock";
import type { ToposRequestKind } from "./slices/git/topos/toposPalette";
import { commandLine, shellFor, typeCommand } from "./slices/terminal/typedCommand";
import { NEW_AGENT_RUN_KIND } from "./slices/git/topos/handOff";
import { A2AToast } from "./slices/orchestrator/A2AToast";
import { submitPromptToTerminal } from "./slices/terminal/submitPrompt";
import { UpdateModal } from "./slices/updater/UpdateModal";
import { APP_CURRENT_VERSION, checkForUpdates } from "./slices/updater/updaterService";
import { UpdateInfo } from "./slices/updater/types";
import { isSamePath, resolveRootRepo } from "./utils/paths";
import { AlertCircle, Cpu, FileCode2, X, Zap } from "lucide-react";
import type { StageTool } from "./slices/stage/Stage";

/** What starting work on a ticket needs to know about it. */
type IssueToStart = Pick<GithubIssue, "number" | "title">;

/** The folder a start action works in, and the root repository it belongs to. */
interface WorkPlace {
  rootRepo: string;
  targetDir: string;
  /** Whether `targetDir` is a linked worktree, so Archon stays in it rather than making one. */
  isWorktree: boolean;
}

/** The stage tabs of full-stage tools, by id. */
const SWARM_BUILDER_TOOL = "swarm-builder";
const NEW_WORK_ORDER_TOOL = "new-work-order";
const FACTORY_CONFIG_TOOL = "factory-config";
const PRAXIS_BUILDER_TOOL = "praxis-builder";

export function App() {
  const {
    projects,
    activeProject,
    terminals,
    activeTerminalId,
    primaryTerminalId,
    secondaryTerminalId,
    gridTerminalIds,
    layout,
    focusedPane,
    splitRatio,
    zoomedFromLayout,
    bridgePort,
    setActiveTerminalId,
    selectTerminal,
    focusPane,
    switchPaneTerminal,
    setLayout,
    setSplitRatio,
    toggleZoom,
    focusNextPane,
    unsplit,
    splitHorizontal,
    splitVertical,
    splitGrid,
    setActiveProject,
    isNewTerminalOpen,
    setIsNewTerminalOpen,
    isAddProjectOpen,
    setIsAddProjectOpen,
    isActionLogOpen,
    setIsActionLogOpen,
    isWorkspaceSettingsOpen,
    workspaceSettingsTarget,
    openWorkspaceSettings,
    closeWorkspaceSettings,
    updateProjectSettings,
    launchSwarm,
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    isDiffInspectorOpen,
    setIsDiffInspectorOpen,
    projectWorktrees,
    isNewWorktreeOpen,
    setIsNewWorktreeOpen,
    worktreeModalTarget,
    openNewWorktreeModal,
    createWorktree,
    removeWorktree,
    isAuditModalOpen,
    setIsAuditModalOpen,
    isTokenSpendOpen,
    setIsTokenSpendOpen,
    isArchonGraphOpen,
    setIsArchonGraphOpen,
    isUpdateModalOpen,
    setIsUpdateModalOpen,
    claudeStats,
    refreshClaudeStats,
    resumeSession,
    addProject,
    removeProject,
    renameTerminal,
    spawnTerminal,
    killTerminal,
    relaunchTerminal,
    toggleTerminalLiveMode,
    openInVsCode,
    diffLensOpener,
    sourceControlOpener,
    toposOpener,
    praxisBuilderOpener,
    agentOpeners,
    workflowOpeners,
    projectOpeners,
    openRepoDiffs,
    openPrePrAudit,
  } = useWorkspace();

  const { events, activeTools, getTerminalEvents } = useBridgeEvents();
  const attentionQueue = useAttentionQueue(terminals);
  const { items: waitingItems } = attentionQueue;
  // The A2A trail, newest first: the Activity view's messages and the Agents panel's reply previews.
  const trailMessages = useTrailMessages();
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);

  // One instance shared by the swarm builder and the command palette
  const { savedSwarms, saveSwarm, removeSwarm } = useSavedSwarms();

  const [detectedUpdate, setDetectedUpdate] = useState<UpdateInfo | null>(null);
  const [worktreeRemovalPrompt, setWorktreeRemovalPrompt] = useState<WorktreeRemovalPrompt | null>(
    null
  );
  const [vscodeError, setVscodeError] = useState<string | null>(null);
  // The module whose panel shows beside the module bar; null while the panel is folded.
  const [openModule, setOpenModule] = useState<ModuleId | null>("projects");
  const modulePanelId = useId();

  const handleOpenInVsCode = useCallback(
    async (projectPath: string) => {
      try {
        setVscodeError(null);
        await openInVsCode(projectPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setVscodeError(msg);
      }
    },
    [openInVsCode]
  );

  useEffect(() => {
    if (!vscodeError) return;
    const timer = setTimeout(() => setVscodeError(null), 6000);
    return () => clearTimeout(timer);
  }, [vscodeError]);

  // Remove a worktree from the Projects panel. Git's refusal or error opens the Remove anyway dialog.
  const handleRemoveWorktree = async (repoPath: string, worktreePath: string) => {
    try {
      const result = await removeWorktree(repoPath, worktreePath);
      if (result.status === "blocked") {
        setWorktreeRemovalPrompt({ repoPath, worktreePath, message: result.message });
      }
    } catch (err) {
      setWorktreeRemovalPrompt({
        repoPath,
        worktreePath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Background check for Quay software updates on launch (3.5s delay)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const info = await checkForUpdates();
        if (info.available) {
          setDetectedUpdate(info);
          setIsUpdateModalOpen(true);
        }
      } catch (err) {
        console.warn("Background update check error:", err);
      }
    }, 3500);

    return () => clearTimeout(timer);
  }, [setIsUpdateModalOpen]);

  const currentTool = activeTerminalId ? activeTools[activeTerminalId] : null;
  const currentEvents = getTerminalEvents(activeTerminalId);

  const activeProjectObj =
    workspaceSettingsTarget || projects.find((p) => p.path === activeProject) || null;

  // Resolve base repository root if activeProject is a child worktree folder
  const activeRootRepo = useMemo(
    () => resolveRootRepo(activeProject, projects, projectWorktrees),
    [activeProject, projects, projectWorktrees]
  );

  // The open stage tabs, in the order they opened, and the one in front of the terminals.
  const [openToolIds, setOpenToolIds] = useState<readonly string[]>([]);
  const [frontToolId, setFrontToolId] = useState<string | null>(null);

  // The builder works on the active project when it is a registered project or one of its
  // worktrees, the same folders the backend's praxis commands accept. Topos targets the same.
  const builderProject = useMemo<BuilderProject | null>(() => {
    const registered = projects.find((p) => isSamePath(p.path, activeProject));
    if (registered) return { path: registered.path, name: registered.name };
    for (const p of projects) {
      const wt = projectWorktrees[p.path]?.find((w) => isSamePath(w.path, activeProject));
      if (wt) return { path: wt.path, name: worktreeDisplayName(p.name, wt.branch) };
    }
    return null;
  }, [projects, projectWorktrees, activeProject]);
  // The diff lens, the Topos lens and the run lens open over the stage one at a time: opening one
  // closes the others.
  const companionLens = useDiffLens(activeTerminalId);
  const [isRunLensOpen, setIsRunLensOpen] = useState(false);
  // Each open of Topos by a chord, the palette or its Wide toggle moves focus into it.
  const [toposFocus, setToposFocus] = useState(0);
  const toposDock = useToposDock(activeTerminalId, () => {
    companionLens.dismiss();
    setIsRunLensOpen(false);
    setToposFocus((n) => n + 1);
  });
  const dismissTopos = toposDock.dismiss;
  // "Show that worktree" (#393) selects the Projects panel entry for a worktree git names, however its
  // path is spelled, and reports false when the Projects panel lists no such worktree.
  const showToposWorktree = useCallback(
    (path: string) => {
      for (const p of projects) {
        if (isSamePath(p.path, path)) {
          setActiveProject(p.path);
          return true;
        }
        const wt = projectWorktrees[p.path]?.find((w) => isSamePath(w.path, path));
        if (wt) {
          setActiveProject(wt.path);
          return true;
        }
      }
      return false;
    },
    [projects, projectWorktrees, setActiveProject]
  );
  // A conflict Topos can't resolve, such as a submodule's, is resolved by hand in a shell there.
  const openToposTerminal = useCallback(
    (cwd: string) => {
      void spawnTerminal({ project_path: cwd, run_kind: "powershell", name: "conflict" });
      dismissTopos();
    },
    [spawnTerminal, dismissTopos]
  );
  // Types `argv` into a new plain shell terminal in `cwd`, never an agent's, so it gets no commit
  // stamping env, then calls `onOpened` so the modal that asked steps aside. False when the shell
  // can't quote `argv`; throws when the terminal doesn't start.
  const runInShellTerminal = useCallback(
    async (cwd: string, argv: string[], name: string, onOpened: () => void) => {
      const shell = shellFor(navigator.userAgent);
      if (commandLine(argv, shell) === null) return false;
      const terminal = await spawnTerminal({ project_path: cwd, run_kind: "powershell", name });
      if (terminal === null) throw new Error("the terminal didn't start");
      onOpened();
      return typeCommand(terminal.id, argv, shell);
    },
    [spawnTerminal]
  );
  // Run in terminal (#395): the git command typed in for the operator to finish.
  const runInToposTerminal = useCallback(
    (cwd: string, argv: string[]) => runInShellTerminal(cwd, argv, "git", dismissTopos),
    [runInShellTerminal, dismissTopos]
  );
  // The Praxis host chip's actions (#448): `praxis setup`, `serve` or `login` typed in for the
  // operator to answer. The terminals come back in front of the builder's tab so the terminal shows.
  const runInPraxisTerminal = useCallback(
    (cwd: string, argv: string[]) => runInShellTerminal(cwd, argv, "praxis", () => setFrontToolId(null)),
    [runInShellTerminal]
  );
  // A conflict handed to a new agent (#392) starts one in the worktree; Topos stays open on the hand-off.
  const startToposAgent = useCallback(
    (cwd: string) => spawnTerminal({ project_path: cwd, run_kind: NEW_AGENT_RUN_KIND, name: "conflict agent" }),
    [spawnTerminal]
  );
  // Normalized paths of the projects with unsaved Praxis drafts, which the Projects panel marks.
  const [praxisUnsaved, setPraxisUnsaved] = useState<ReadonlySet<string>>(new Set());
  const onPraxisUnsavedChange = useCallback((keys: string[]) => setPraxisUnsaved(new Set(keys)), []);
  const praxisBuilder = useRef<PraxisBuilderHandle | null>(null);

  // Where a start action works unless told otherwise: the active worktree, with Archon told to stay
  // in it, or the active project's root repository.
  const activePlace: WorkPlace = {
    rootRepo: activeRootRepo,
    targetDir: activeProject !== activeRootRepo ? activeProject : activeRootRepo,
    isWorktree: activeProject !== activeRootRepo,
  };

  // 1-Click: Execute real Archon Workflow Run for an issue
  const handleImplementIssue = async (
    issue: IssueToStart,
    workflowOverride?: string,
    place: WorkPlace = activePlace,
  ) => {
    const { targetDir, isWorktree } = place;

    try {
      // 1. Fetch available Archon workflows
      let availableWorkflows: ArchonWorkflow[] = [];
      try {
        availableWorkflows = await invoke<ArchonWorkflow[]>("archon_get_workflows");
      } catch (e) {
        console.warn("Could not query Archon workflows:", e);
      }

      // 2. Select workflow:
      let chosenWorkflow = workflowOverride;
      if (!chosenWorkflow) {
        if (
          availableWorkflows.some(
            (w) =>
              w.name === "seanrobertwright/lril-sdlc:implement" ||
              w.id === "seanrobertwright/lril-sdlc:implement"
          )
        ) {
          chosenWorkflow = "seanrobertwright/lril-sdlc:implement";
        } else if (
          availableWorkflows.some(
            (w) => w.name.endsWith("/lril-sdlc:implement") || w.id.endsWith("/lril-sdlc:implement")
          )
        ) {
          chosenWorkflow = availableWorkflows.find((w) =>
            w.name.endsWith("/lril-sdlc:implement")
          )!.name;
        } else if (
          availableWorkflows.some((w) => w.name === "archon-fix-github-issue" || w.id === "archon-fix-github-issue")
        ) {
          chosenWorkflow = "archon-fix-github-issue";
        } else if (availableWorkflows.some((w) => w.name === "archon-ship" || w.id === "archon-ship")) {
          chosenWorkflow = "archon-ship";
        } else if (availableWorkflows.some((w) => w.name === "archon-implement" || w.id === "archon-implement")) {
          chosenWorkflow = "archon-implement";
        } else {
          chosenWorkflow = "seanrobertwright/lril-sdlc:implement";
        }
      }

      // 3. Build command
      const safeTitle = issue.title.replace(/"/g, "'");
      const wtFlag = isWorktree ? " --no-worktree" : "";
      let cmd = "";
      if (chosenWorkflow.includes("lril-sdlc:implement")) {
        cmd = `archon workflow run "${chosenWorkflow}" --cwd "${targetDir}"${wtFlag} --input ticket="${issue.number}" --input pr="true"`;
      } else if (chosenWorkflow === "archon-ship" || chosenWorkflow === "archon-triage") {
        cmd = `archon workflow run "${chosenWorkflow}" --cwd "${targetDir}"${wtFlag} --input target="${issue.number}"`;
      } else if (chosenWorkflow === "archon-fix-github-issue") {
        cmd = `archon workflow run "${chosenWorkflow}" --cwd "${targetDir}"${wtFlag} "Fix issue #${issue.number}: ${safeTitle}"`;
      } else {
        cmd = `archon workflow run "${chosenWorkflow}" --cwd "${targetDir}"${wtFlag} "Issue #${issue.number}: ${safeTitle}"`;
      }

      // 4. Spawn Archon runner terminal pane
      await spawnTerminal({
        project_path: targetDir,
        run_kind: "archon",
        name: `archon-${issue.number}`,
        command_text: cmd,
      });

    } catch (err) {
      console.error("Failed to run Archon workflow:", err);
      alert(`Failed to run Archon workflow for issue #${issue.number}: ${err}`);
    }
  };

  // 1-Click: Triage issue with Archon workflow
  const handleTriageIssue = async (
    issue: IssueToStart,
    workflowOverride?: string,
    place: WorkPlace = activePlace,
  ) => {
    const { targetDir, isWorktree } = place;

    try {
      let availableWorkflows: ArchonWorkflow[] = [];
      try {
        availableWorkflows = await invoke<ArchonWorkflow[]>("archon_get_workflows");
      } catch (e) {
        console.warn("Could not query Archon workflows:", e);
      }

      let chosenWorkflow = workflowOverride;
      if (!chosenWorkflow) {
        if (
          availableWorkflows.some(
            (w) =>
              w.name === "seanrobertwright/lril-sdlc:triage" ||
              w.id === "seanrobertwright/lril-sdlc:triage"
          )
        ) {
          chosenWorkflow = "seanrobertwright/lril-sdlc:triage";
        } else if (
          availableWorkflows.some(
            (w) => w.name.endsWith("/lril-sdlc:triage") || w.id.endsWith("/lril-sdlc:triage")
          )
        ) {
          chosenWorkflow = availableWorkflows.find((w) =>
            w.name.endsWith("/lril-sdlc:triage")
          )!.name;
        } else if (availableWorkflows.some((w) => w.name === "archon-triage" || w.id === "archon-triage")) {
          chosenWorkflow = "archon-triage";
        } else if (availableWorkflows.some((w) => w.name.includes("wayfinder"))) {
          chosenWorkflow = availableWorkflows.find((w) => w.name.includes("wayfinder"))!.name;
        } else {
          chosenWorkflow = "seanrobertwright/lril-sdlc:triage";
        }
      }

      const safeTitle = issue.title.replace(/"/g, "'");
      const wtFlag = isWorktree ? " --no-worktree" : "";
      let cmd = "";
      if (chosenWorkflow.includes("lril-sdlc:triage") || chosenWorkflow === "archon-triage") {
        cmd = `archon workflow run "${chosenWorkflow}" --cwd "${targetDir}"${wtFlag} --input target="${issue.number}"`;
      } else {
        cmd = `archon workflow run "${chosenWorkflow}" --cwd "${targetDir}"${wtFlag} "Triage issue #${issue.number}: ${safeTitle}"`;
      }

      await spawnTerminal({
        project_path: targetDir,
        run_kind: "archon",
        name: `triage-${issue.number}`,
        command_text: cmd,
      });

    } catch (err) {
      console.error("Failed to run Archon triage workflow:", err);
      alert(`Failed to run Archon triage for issue #${issue.number}: ${err}`);
    }
  };

  // 1-Click: Resolve merge conflicts in PR with Archon workflow
  const handleResolvePrConflicts = async (pr: GithubPullRequest) => {
    const rootRepo = activeRootRepo;
    const targetDir = activeProject !== activeRootRepo ? activeProject : rootRepo;
    const isWorktree = activeProject !== activeRootRepo;

    try {
      const safeTitle = pr.title.replace(/"/g, "'");
      const wtFlag = isWorktree ? " --no-worktree" : "";
      const cmd = `archon workflow run "archon-resolve-conflicts" --cwd "${targetDir}"${wtFlag} "Resolve merge conflicts in PR #${pr.number}: ${safeTitle}"`;

      await spawnTerminal({
        project_path: targetDir,
        run_kind: "archon",
        name: `conflict-pr-${pr.number}`,
        command_text: cmd,
      });

    } catch (err) {
      console.error("Failed to resolve PR conflicts with Archon:", err);
      alert(`Failed to resolve PR conflicts for PR #${pr.number}: ${err}`);
    }
  };

  // 1-Click: Create worktree modal targeting specific issue
  const handleCreateWorktreeForIssue = (issue: IssueToStart, place: WorkPlace = activePlace) => {
    openNewWorktreeModal(place.rootRepo, issue.number);
  };

  // The Ticket view's Implement split button starts work through the handlers above, in the
  // repository of the terminal the ticket belongs to rather than the active project. The handlers
  // change on every render, so the companion gets one stable object that calls the latest of them.
  const ticketHandlers = useRef({ handleImplementIssue, handleTriageIssue, handleCreateWorktreeForIssue });
  ticketHandlers.current = { handleImplementIssue, handleTriageIssue, handleCreateWorktreeForIssue };
  const ticketActions = useMemo<TicketActions>(() => {
    const placeOf = (ticket: TicketToStart): WorkPlace => ({
      rootRepo: ticket.repoPath,
      targetDir: ticket.repoPath,
      isWorktree: false,
    });
    return {
      implement: (ticket) => void ticketHandlers.current.handleImplementIssue(ticket, undefined, placeOf(ticket)),
      triage: (ticket) => void ticketHandlers.current.handleTriageIssue(ticket, undefined, placeOf(ticket)),
      newWorktree: (ticket) => ticketHandlers.current.handleCreateWorktreeForIssue(ticket, placeOf(ticket)),
    };
  }, []);

  // 1-Click: Auto-fix Pre-PR Audit Violations with Claude
  const handleFixAuditWithClaude = async (violations: AuditViolation[]) => {
    const summary = violations
      .map(
        (v) =>
          `- [${v.severity.toUpperCase()}] ${v.category} in ${v.file_path}${
            v.line_number ? `:${v.line_number}` : ""
          }: ${v.message}${v.snippet ? `\n  Match: "${v.snippet.trim()}"` : ""}`
      )
      .join("\n");

    const prompt = `Please fix the following pre-PR audit violations in our git repository:\n\n${summary}\n\nPlease sanitize or clean up these files so they pass the pre-PR audit gate.`;

    try {
      if (activeTerminalId) {
        await submitPromptToTerminal(activeTerminalId, prompt);
      } else {
        const dims = getGlobalTerminalDimensions();
        const spawned = await invoke<TerminalInfo>("spawn_terminal", {
          request: {
            project_path: activeProject,
            run_kind: "claude",
            name: "audit-fixer",
            cols: dims.cols,
            rows: dims.rows,
          },
        });
        selectTerminal(spawned.id);
        submitPromptToTerminal(spawned.id, prompt, { awaitStartup: true }).catch(console.error);
      }
      setIsAuditModalOpen(false);
    } catch (err) {
      console.error("Failed to fix audit with Claude:", err);
    }
  };

  // A terminal with a permission request waiting shows the amber waiting dot.
  const asking = useMemo(() => askingTerminals(waitingItems), [waitingItems]);
  const terminalStatusRows = useMemo(
    () => statusRows(terminals, projects, projectWorktrees, asking),
    [terminals, projects, projectWorktrees, asking]
  );
  const openPrCount = useOpenPrCount(activeRootRepo);
  const spendTodayUsd = claudeStats?.windows?.find((w) => w.key === "today")?.cost_usd ?? null;

  const selectedTerminal = useMemo(
    () => terminals.find((t) => t.id === activeTerminalId) ?? null,
    [terminals, activeTerminalId]
  );
  // localStorage is the WebView's, so the companion's width is kept per machine.
  const companionStore = useMemo(() => companionPrefs(window.localStorage), []);
  // The Project panel's Quay · every project settings, kept per machine in the same storage.
  const { prefs: shellPrefs, setPref: setShellPref } = useShellPrefs(window.localStorage);
  const { linking, recordLaunch } = useTerminalLinks(terminals, projects, projectWorktrees);

  const diffLens = companionLens.shown;
  const diffLensControl = useMemo(
    () => ({
      ...companionLens,
      openDiff: (target: DiffLensTarget) => {
        dismissTopos();
        setIsRunLensOpen(false);
        companionLens.openDiff(target);
      },
    }),
    [companionLens, dismissTopos]
  );
  // Chord `d`: the diff lens for the selected terminal's pull request; false leaves it to the
  // workspace to open the Diff Inspector.
  diffLensOpener.current = () => {
    const target =
      selectedTerminal &&
      diffLensFor(
        selectedTerminal.id,
        terminalRepository(selectedTerminal, projects, projectWorktrees).path,
        linking.linkOf(selectedTerminal)
      );
    if (!target) return false;
    diffLensControl.openDiff(target);
    return true;
  };

  // Chords `i` and `a`, and `d` with no pull request to show, open the Source control panel.
  const openSourceControl = () => setOpenModule("source-control");
  sourceControlOpener.current = openSourceControl;

  // A pick in the Source control panel pins it to the selected terminal and shows it in the companion.
  const [companionRequest, setCompanionRequest] = useState<CompanionShowRequest | null>(null);
  const pickForCompanion = (slot: LinkSlotName, ref: LinkRef) => {
    if (!selectedTerminal) return;
    const terminalId = selectedTerminal.id;
    linking.pin(terminalId, slot, ref);
    setCompanionRequest((prev) => ({
      terminalId,
      view: slot === "ticket" ? "ticket" : "pull-request",
      seq: (prev?.seq ?? 0) + 1,
    }));
  };

  // A pie stroke's ask of the companion's pull request view: show the view for the selected
  // terminal and act on the ask there (#650).
  const askPullRequestView = (pullRequest: PullRequestAsk) => {
    if (!selectedTerminal) return;
    const terminalId = selectedTerminal.id;
    setCompanionRequest((prev) => ({ terminalId, view: "pull-request", pullRequest, seq: (prev?.seq ?? 0) + 1 }));
  };

  // The reply strip at the foot of every lens: the selected terminal's last question.
  const replyStrip = selectedTerminal && (
    <ReplyStrip
      terminalName={selectedTerminal.name}
      permission={latestPermission(waitingItems, selectedTerminal.id)}
      onAnswer={attentionQueue.answerPermission}
    />
  );

  // Topos works on the selected terminal's folder, and draws the graph of its repository's root.
  const selectedRepository = useMemo(
    () => (selectedTerminal ? terminalRepository(selectedTerminal, projects, projectWorktrees) : null),
    [selectedTerminal, projects, projectWorktrees]
  );
  const toposTarget = useMemo<ToposTarget | null>(
    () =>
      selectedTerminal && selectedRepository
        ? {
            path: selectedTerminal.project_path,
            name: selectedRepository.worktree
              ? worktreeDisplayName(selectedRepository.name, selectedRepository.branch)
              : selectedRepository.name,
            repoPath: selectedRepository.path,
          }
        : null,
    [selectedTerminal, selectedRepository]
  );
  // The selected terminal's pull request, read so the pie's Merge shows only while it can merge.
  const selectedPrSlot = selectedTerminal ? linking.linkOf(selectedTerminal)?.pull_request : null;
  const { selected: selectedPr, reload: reloadSelectedPr } = useSelectedPullRequest(
    selectedPrSlot && selectedRepository ? { repoPath: selectedRepository.path, repo: selectedPrSlot.repo, number: selectedPrSlot.number } : null
  );
  const selectedPrMergeable = !!selectedPr && canMerge(selectedPr.pr);
  // The Merge undo window (#650), started by the pie's Merge stroke: a countdown toast in the
  // companion, then the merge. With the window Off, the pull request view's confirm step opens.
  const mergeUndo = useMergeUndo(shellPrefs.mergeUndoSeconds, {
    onConfirm: (job: MergeJob) => askPullRequestView({ kind: "confirm-merge", method: job.method }),
    onMerged: () => {
      reloadSelectedPr();
      askPullRequestView({ kind: "reload" });
    },
  });
  const startMerge = (method: MergeMethod) => {
    if (selectedPr && canMerge(selectedPr.pr)) mergeUndo.start({ location: selectedPr.location, pr: selectedPr.pr, method });
  };

  // Chord `c`, the palette and the panels' Topos buttons show the Topos view in the companion for
  // the selected terminal; with none selected there is no repository to show.
  const openToposView = () => {
    if (!selectedTerminal) return;
    const terminalId = selectedTerminal.id;
    setCompanionRequest((prev) => ({ terminalId, view: "topos", seq: (prev?.seq ?? 0) + 1 }));
    setToposFocus((n) => n + 1);
  };
  toposOpener.current = openToposView;
  // A Topos palette entry (#393) opens the Topos view on its dialog; the count makes a repeat run again.
  const [toposRequest, setToposRequest] = useState<{ kind: ToposRequestKind; seq: number } | null>(null);
  const requestTopos = (kind: ToposRequestKind) => {
    setToposRequest((prev) => ({ kind, seq: (prev?.seq ?? 0) + 1 }));
    openToposView();
  };

  // Picking a terminal anywhere brings the terminals back in front of a stage tab; a tab stays open
  // until closed.
  const openTool = (id: string) => {
    setOpenToolIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setFrontToolId(id);
  };
  const closeTool = useCallback((id: string) => {
    setOpenToolIds((ids) => ids.filter((open) => open !== id));
    setFrontToolId((front) => (front === id ? null : front));
  }, []);
  const openSwarmBuilder = () => openTool(SWARM_BUILDER_TOOL);
  // The Praxis Builder's stage tab (chord `p`). The builder is drawn once and never unmounted, so
  // its drafts and undo histories last while its tab is closed; it lays over its tab's slot.
  const openPraxisBuilder = () => openTool(PRAXIS_BUILDER_TOOL);
  praxisBuilderOpener.current = openPraxisBuilder;
  const closePraxisBuilder = useCallback(() => closeTool(PRAXIS_BUILDER_TOOL), [closeTool]);
  const [builderSlot, setBuilderSlot] = useState<HTMLElement | null>(null);
  const [inspectorSlot, setInspectorSlot] = useState<HTMLElement | null>(null);
  const builderInFront = frontToolId === PRAXIS_BUILDER_TOOL;
  const companionInspector = useMemo<CompanionInspector | null>(
    () => (builderInFront ? { slot: setInspectorSlot } : null),
    [builderInFront]
  );
  // While the builder's tab is in front the panel folds, so the canvas has the stage's width; an
  // icon on the module bar still opens a panel on demand. Leaving the tab brings back the panel it
  // folded, and the companion its view from before.
  const [fold, setFold] = useState<{ inFront: boolean; folded: ModuleId | null }>({ inFront: false, folded: null });
  if (builderInFront !== fold.inFront) {
    setFold({ inFront: builderInFront, folded: builderInFront ? openModule : null });
    setOpenModule(builderInFront ? null : moduleAfterUnfold(fold.folded, openModule));
  }
  const closeSwarmBuilder = useCallback(() => closeTool(SWARM_BUILDER_TOOL), [closeTool]);
  // `select` with the terminals brought back in front of any tool tab
  const inFront = (select: (id: string) => void) => (id: string) => {
    setFrontToolId(null);
    select(id);
  };
  const showTerminal = inFront(selectTerminal);

  // A companion view for a terminal, once it is the selected one: selecting a terminal in another
  // project lands a moment later, and the companion takes a request only for the selected terminal.
  const [pendingView, setPendingView] = useState<{ terminalId: string; view: CompanionViewId; entryId?: string } | null>(null);
  useEffect(() => {
    if (!pendingView || pendingView.terminalId !== activeTerminalId) return;
    const { terminalId, view, entryId } = pendingView;
    setPendingView(null);
    setCompanionRequest((prev) => ({ terminalId, view, entryId, seq: (prev?.seq ?? 0) + 1 }));
  }, [pendingView, activeTerminalId]);
  const showCompanionView = (terminalId: string, view: CompanionViewId, entryId?: string) => {
    if (terminalId !== activeTerminalId) showTerminal(terminalId);
    setPendingView({ terminalId, view, entryId });
  };
  const openActivity = (terminalId: string, entryId?: string) => showCompanionView(terminalId, "activity", entryId);
  // A Waiting on you row selects its terminal; a permission request opens in Activity to answer.
  const openWaiting = (item: AttentionItem) => {
    if (!item.terminalId) return;
    if (item.kind === "permission") openActivity(item.terminalId);
    else showTerminal(item.terminalId);
  };
  const [sessionHistoryRequest, setSessionHistoryRequest] = useState<SessionHistoryRequest | null>(null);
  const openSessionHistory = () => {
    setOpenModule("agents");
    setSessionHistoryRequest((prev) => ({ seq: (prev?.seq ?? 0) + 1 }));
  };
  const selectNextWaiting = () => {
    const next = nextWaitingTerminal(terminalStatusRows, activeTerminalId);
    if (next) showTerminal(next);
  };
  const selectPrevWaiting = () => {
    const prev = prevWaitingTerminal(terminalStatusRows, activeTerminalId);
    if (prev) showTerminal(prev);
  };
  const openSelectedActivity = () => {
    if (activeTerminalId) openActivity(activeTerminalId);
  };
  agentOpeners.current = { openSwarmBuilder, openSessionHistory, selectNextWaiting, openActivity: openSelectedActivity };

  // The Workflows panel, and the run or work order picked in it, which the companion's Run view and
  // the run lens show. The engines are read while either the panel or a picked run is on screen.
  const workflowStore = useMemo(() => workflowPrefs(window.localStorage), []);
  const [pinnedWorkflows, setPinnedWorkflows] = useState<string[]>(() => workflowStore.readPins());
  const builderPath = builderProject?.path ?? null;
  const [recentGraphIds, setRecentGraphIds] = useState<string[]>([]);
  useEffect(() => setRecentGraphIds(builderPath ? workflowStore.readRecentGraphs(builderPath) : []), [builderPath, workflowStore]);
  const onGraphOpened = useCallback(
    (projectPath: string, id: string) => {
      workflowStore.graphOpened(projectPath, id);
      if (builderPath && isSamePath(projectPath, builderPath)) setRecentGraphIds(workflowStore.readRecentGraphs(builderPath));
    },
    [workflowStore, builderPath],
  );
  const [picked, setPicked] = useState<{ key: string; source: RunSource } | null>(null);
  const workflows = useWorkflowsData({
    active: openModule === "workflows" || picked !== null,
    project: activeProject,
    praxisProject: builderPath,
    recentGraphs: recentGraphIds,
  });
  // The picked run as last read, or as it was picked until the engines are read again.
  const pickedSource = picked
    ? (runSources(workflows.data).find((source) => rowOf(source, workflows.now).key === picked.key) ?? picked.source)
    : null;
  // Picking a run shows it in the Run view; a run with its own terminal selects that terminal too.
  const pickRun = (source: RunSource) => {
    setPicked({ key: rowOf(source, workflows.now).key, source });
    const terminalId = runTerminalId(source, terminals) ?? activeTerminalId;
    if (terminalId) showCompanionView(terminalId, "run");
  };
  const openRunInBrowser = (source: RunSource) => {
    if (source.engine !== "praxis" || !builderPath) return;
    const projectPath = builderPath;
    void openRunPageOf(source.workflow, source.run.runPageAddress, () => lookupGraphRunPage(projectPath, source.run.workOrderId)).then(
      (problem) => {
        if (problem) alert(problem);
      },
    );
  };
  const openRunLens = () => {
    companionLens.dismiss();
    dismissTopos();
    setIsRunLensOpen(true);
  };
  const [engineFocus, setEngineFocus] = useState<{ seq: number } | null>(null);
  const openWorkflows = () => setOpenModule("workflows");
  workflowOpeners.current = {
    openWorkflows,
    openEngineStrip: () => {
      setOpenModule("workflows");
      setEngineFocus((prev) => ({ seq: (prev?.seq ?? 0) + 1 }));
    },
  };
  const [archonOpenOn, setArchonOpenOn] = useState<ArchonTab>("dag");
  const openArchonGraph = (tab: ArchonTab = "dag") => {
    setArchonOpenOn(tab);
    setIsArchonGraphOpen(true);
  };
  // A pinned workflow's chip types its `archon workflow run` into a new shell terminal without
  // pressing Enter, so the operator adds the message or inputs the workflow takes.
  const typeArchonWorkflow = async (name: string) => {
    const { targetDir, isWorktree } = activePlace;
    const argv = ["archon", "workflow", "run", name, "--cwd", targetDir, ...(isWorktree ? ["--no-worktree"] : [])];
    const line = commandLine(argv, shellFor(navigator.userAgent));
    if (line === null) return;
    const terminal = await spawnTerminal({ project_path: targetDir, run_kind: "powershell", name: workflowTerminalName(name) });
    if (terminal) await invoke("write_pty", { terminalId: terminal.id, data: `${line} ` });
  };
  // A spec task's Agent button hands the task to a new Claude Code terminal.
  const startSpecTask = async (task: SpecTask) => {
    const terminal = await spawnTerminal({ project_path: activeProject, run_kind: "claude", name: `task-${task.id}`.slice(0, 24) });
    if (!terminal) return;
    const prompt = `Implement task from ${task.file_name}:${task.line_number}: "${task.title}" using test-driven development.`;
    submitPromptToTerminal(terminal.id, prompt, { awaitStartup: true }).catch(console.error);
  };
  const startActions: StartActions = {
    pinned: pinnedWorkflows,
    onRunWorkflow: (name) => void typeArchonWorkflow(name).catch((err) => alert(`Couldn't start ${name}: ${err}`)),
    onPin: (name) => {
      workflowStore.pin(name);
      setPinnedWorkflows(workflowStore.readPins());
    },
    onUnpin: (name) => {
      workflowStore.unpin(name);
      setPinnedWorkflows(workflowStore.readPins());
    },
    onAgentTask: (task) => void startSpecTask(task).catch(console.error),
    onAllTasks: () => openArchonGraph("sdd"),
    onOpenGraph: (id) => {
      openPraxisBuilder();
      praxisBuilder.current?.openGraph(id);
    },
    onNewWorkOrder: () => openTool(NEW_WORK_ORDER_TOOL),
    onFactoryConfig: () => openTool(FACTORY_CONFIG_TOOL),
  };
  const workOrderCreated = (wo: MachinaWorkOrder) => {
    closeTool(NEW_WORK_ORDER_TOOL);
    setOpenModule("workflows");
    void workflows.refresh();
    pickRun({ engine: "factory", workOrder: wo });
  };
  const companionRun = pickedSource && picked
    ? {
        key: picked.key,
        content: (
          <RunView
            key={picked.key}
            source={pickedSource}
            now={workflows.now}
            onChanged={() => void workflows.refresh()}
            onOpenLens={openRunLens}
            onOpenInBrowser={() => openRunInBrowser(pickedSource)}
          />
        ),
      }
    : null;

  const STAGE_TOOLS: Record<string, Omit<StageTool, "id">> = {
    [SWARM_BUILDER_TOOL]: {
      label: "Swarm builder",
      icon: <Zap className="w-3.5 h-3.5 text-[#d29922]" />,
      content: (
        <SwarmBuilder
          activeProject={activeProject}
          onClose={closeSwarmBuilder}
          onLaunchSwarm={launchSwarm}
          savedSwarms={savedSwarms}
          onSaveSwarm={saveSwarm}
          onRemoveSwarm={removeSwarm}
        />
      ),
    },
    [NEW_WORK_ORDER_TOOL]: {
      label: "New work order",
      icon: <Cpu className="w-3.5 h-3.5 text-[#58a6ff]" />,
      content: (
        <NewWorkOrderTab
          activeProject={activeProject}
          workOrders={workflows.data.factory.workOrders}
          onCreated={workOrderCreated}
          onClose={() => closeTool(NEW_WORK_ORDER_TOOL)}
          onOpenConfig={() => openTool(FACTORY_CONFIG_TOOL)}
        />
      ),
    },
    [PRAXIS_BUILDER_TOOL]: {
      label: "Praxis Builder",
      icon: <CanvasHandlesIcon className="w-3.5 h-3.5" />,
      // The slot the builder lays over; the builder itself is drawn below, never unmounted.
      content: <div ref={setBuilderSlot} data-praxis-builder-slot className="flex-1 min-h-0" />,
    },
    [FACTORY_CONFIG_TOOL]: {
      label: "Factory config",
      icon: <FileCode2 className="w-3.5 h-3.5 text-[#58a6ff]" />,
      content: <FactoryConfigTab activeProject={activeProject} />,
    },
  };
  const stageTools: StageTool[] = openToolIds.flatMap((id) => (STAGE_TOOLS[id] ? [{ id, ...STAGE_TOOLS[id] }] : []));

  const companionActivity = useMemo<CompanionActivity>(
    () => ({ events, messages: trailMessages, waiting: waitingItems, answer: attentionQueue.answerPermission }),
    [events, trailMessages, waitingItems, attentionQueue.answerPermission]
  );

  // Chords `t` and `$` open the Project panel on This project, `u` on Check for updates.
  const [projectFocus, setProjectFocus] = useState<ProjectPanelFocus | null>(null);
  const openProjectPanel = (target: ProjectPanelFocus["target"]) => {
    setOpenModule("project");
    setProjectFocus((prev) => ({ target, seq: (prev?.seq ?? 0) + 1 }));
  };
  projectOpeners.current = {
    openThisProject: () => openProjectPanel("this-project"),
    openCheckForUpdates: () => openProjectPanel("check-for-updates"),
  };
  const openUpdateModal = () => setIsUpdateModalOpen(true);

  // The palette's three most recent commands, which the pie's Palette slices copy and run (#649).
  const recentCommandStore = useMemo(() => recentCommands(window.localStorage), []);
  const [recentPaletteCommands, setRecentPaletteCommands] = useState<RecentPaletteCommand[]>(() => recentCommandStore.read());
  const paletteRunner = useRef<((id: string) => boolean) | null>(null);
  // Every pie stroke chosen with the pointer, kept so overshoot between neighbouring parents can be
  // checked in use; a second-ring pick near a neighbouring parent is also written to the console.
  const strokeLog = useMemo(() => pieStrokeLog(window.localStorage), []);
  const logPieStroke = (record: PieStrokeRecord) => {
    strokeLog.add(record);
    if (record.neighbour) console.info("[pie] second-ring pick near a neighbouring parent", record);
  };
  const newTerminalOf = (runKind: RunKind) => spawnTerminal({ project_path: activeProject, run_kind: runKind, name: runKind });

  // A pie stroke (#648, #649, #650). N, NE, E, S and W and their second-ring slices act on the
  // selected terminal and its pull request; the diagonals on the terminal, row or companion pull
  // request the pie opened over.
  const runPieStroke = (choice: PieChoice, target: PieTarget) => {
    const terminalId = pieTerminalId(target);
    switch (choice.action) {
      case "next-wait":
        return selectNextWaiting();
      case "prev-wait":
        return selectPrevWaiting();
      case "waiting-list":
        // The Agents panel opens on Waiting on you, which lists every terminal waiting on the operator.
        return setOpenModule("agents");
      case "split-side":
        return void splitHorizontal();
      case "split-stack":
        return void splitVertical();
      case "split-grid":
        return void splitGrid();
      case "palette-command":
        paletteRunner.current?.(choice.commandId);
        return;
      case "new-claude":
        return void newTerminalOf("claude");
      case "new-codex":
        return void newTerminalOf("codex");
      case "new-pwsh":
        return void newTerminalOf("powershell");
      case "split":
        return void splitHorizontal();
      case "palette":
        return setIsCommandPaletteOpen(true);
      case "new-term":
        return setIsNewTerminalOpen(true);
      case "zoom":
        if (!terminalId) return;
        showTerminal(terminalId);
        return toggleZoom();
      case "find":
        if (terminalId) requestTerminal(terminalId, "find");
        return;
      case "rename":
        if (!terminalId) return;
        // Over a row, its own rename box; a module bar row, or a row of a collapsed project, has none, so the pane header's opens.
        if (target.surface === "panel" && requestTerminal(terminalId, "rename", "row")) return;
        showTerminal(terminalId);
        requestTerminal(terminalId, "rename");
        return;
      case "show-in-pane":
        if (terminalId) showTerminal(terminalId);
        return;
      case "open-folder": {
        const folder = pieFolder(target);
        if (folder) revealFolder(folder);
        return;
      }
      case "agents-panel":
        return setOpenModule("agents");
      case "merge":
      case "merge-squash":
        return startMerge("squash");
      case "merge-commit":
        return startMerge("merge");
      case "merge-rebase":
        return startMerge("rebase");
      case "diff-lens":
        diffLensOpener.current?.();
        return;
      case "comment":
        return askPullRequestView({ kind: "comment" });
      case "checks":
        return askPullRequestView({ kind: "checks" });
    }
  };

  const openLogsFolder = () => {
    invoke("open_logs_folder").catch((err) => alert(`Failed to open the logs folder: ${err}`));
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d1117] text-[#c9d1d9]">
      <ModuleBar
        openModule={openModule}
        onOpenModule={setOpenModule}
        panelId={modulePanelId}
        onOpenPalette={() => setIsCommandPaletteOpen(true)}
        renderTerminalList={(maxHeight) => (
          <TerminalStatusList
            rows={terminalStatusRows}
            maxHeight={maxHeight}
            selectedTerminalId={activeTerminalId}
            onSelectTerminal={showTerminal}
            onOpenProjects={() => setOpenModule("projects")}
          />
        )}
        waitingCount={waitingItems.length}
        openPrCount={openPrCount}
        spendTodayUsd={spendTodayUsd}
        onOpenSpend={() => setIsTokenSpendOpen(true)}
      />
      <ModulePanel
        id={modulePanelId}
        openModule={openModule}
        panels={{
          projects: (
            <ProjectsPanel
              projects={projects}
              activeProject={activeProject}
              unsavedPraxisProjects={praxisUnsaved}
              terminals={terminals}
              activeTerminalId={activeTerminalId}
              bridgePort={bridgePort}
              projectWorktrees={projectWorktrees}
              claudeStats={claudeStats}
              onSelectTerminal={inFront(setActiveTerminalId)}
              onCloseTerminal={(id) => killTerminal(id)}
              onNewTerminal={(projPath) => {
                if (projPath) setActiveProject(projPath);
                setIsNewTerminalOpen(true);
              }}
              onSelectProject={(path) => setActiveProject(path)}
              onAddProject={() => setIsAddProjectOpen(true)}
              onRemoveProject={(path) => {
                const worktrees = projectWorktrees[path]?.map((w) => w.path) ?? [];
                void removeProject(path).then((removed) => {
                  // Removing a project drops the builder's undo histories for it and its worktrees (#248).
                  if (removed) praxisBuilder.current?.forgetProjects([path, ...worktrees]);
                });
              }}
              onRenameTerminal={renameTerminal}
              onOpenSettings={(proj) => openWorkspaceSettings(proj)}
              onOpenSwarm={openSwarmBuilder}
              onOpenNewWorktree={(repoPath) => openNewWorktreeModal(repoPath)}
              onRemoveWorktree={handleRemoveWorktree}
              onOpenTopos={openToposView}
              onOpenInVsCode={handleOpenInVsCode}
              onRelaunchTerminal={relaunchTerminal}
              onToggleTerminalAsk={toggleTerminalLiveMode}
            />
          ),
          "source-control": (
            <SourceControlPanel
              isOpen={openModule === "source-control"}
              repoPath={activeRootRepo}
              pickTarget={selectedTerminal?.name ?? null}
              onPick={pickForCompanion}
              onOpenTopos={openToposView}
              onOpenDiffs={openRepoDiffs}
              onOpenPrePrAudit={openPrePrAudit}
              onResolveConflicts={handleResolvePrConflicts}
            />
          ),
          agents: (
            <AgentsPanel
              isOpen={openModule === "agents"}
              project={activeProject}
              terminals={terminals}
              messages={trailMessages}
              waiting={waitingItems}
              droppedPermissionCount={attentionQueue.droppedPermissionCount}
              selectedTerminalId={activeTerminalId}
              sessionHistoryRequest={sessionHistoryRequest}
              onSelectTerminal={showTerminal}
              onOpenWaiting={openWaiting}
              onOpenReply={(terminalId, messageId) => openActivity(terminalId, messageEntryId(messageId))}
              savedSwarms={savedSwarms}
              onLaunchSwarm={(preset) => void launchSwarm(preset)}
              onOpenSwarmBuilder={openSwarmBuilder}
              onResumeSession={(sessionId, projectPath) => void resumeSession(sessionId, projectPath)}
            />
          ),
          workflows: (
            <WorkflowsPanel
              data={workflows.data}
              now={workflows.now}
              pickedKey={picked?.key ?? null}
              engineFocus={engineFocus}
              onPickRun={pickRun}
              onRefresh={() => void workflows.refresh()}
              onOpenInBrowser={openRunInBrowser}
              start={startActions}
            />
          ),
          project: (
            <ProjectPanel
              projectName={activeProjectObj?.name ?? null}
              hasProject={activeProject !== ""}
              spendTodayUsd={spendTodayUsd}
              appVersion={APP_CURRENT_VERSION}
              prefs={shellPrefs}
              focusRequest={projectFocus}
              // A worktree's settings are its project's, so the selected worktree resolves to its root repo.
              onOpenWorkspaceSettings={() => openWorkspaceSettings(activeRootRepo)}
              onOpenInVsCode={() => void handleOpenInVsCode(activeProject)}
              onOpenTokenSpend={() => setIsTokenSpendOpen(true)}
              onOpenLogsFolder={openLogsFolder}
              onCheckForUpdates={openUpdateModal}
              onSetPref={setShellPref}
            />
          ),
        }}
      />

      {/* Main Workspace Stage, with a lens over it when one is open */}
      <div className="relative flex-1 min-w-0 h-full flex">
      <Stage
        terminals={terminals}
        activeProject={activeProject}
        activeTerminalId={activeTerminalId}
        primaryTerminalId={primaryTerminalId}
        secondaryTerminalId={secondaryTerminalId}
        gridTerminalIds={gridTerminalIds}
        layout={layout}
        focusedPane={focusedPane}
        splitRatio={splitRatio}
        zoomedFromLayout={zoomedFromLayout}
        activeTool={currentTool}
        onSelectTerminal={showTerminal}
        onSelectPane={focusPane}
        onSwitchPaneTerminal={switchPaneTerminal}
        onSetLayout={setLayout}
        onSetSplitRatio={setSplitRatio}
        onToggleZoom={toggleZoom}
        onUnsplit={unsplit}
        onSplitHorizontal={splitHorizontal}
        onSplitVertical={splitVertical}
        onSplitGrid={splitGrid}
        onNewTerminal={() => setIsNewTerminalOpen(true)}
        onToggleLiveMode={toggleTerminalLiveMode}
        onRelaunchTerminal={relaunchTerminal}
        onRenameTerminal={renameTerminal}
        onCloseTerminal={(id) => killTerminal(id)}
        tools={stageTools}
        frontToolId={frontToolId}
        onSelectTool={setFrontToolId}
        onCloseTool={closeTool}
      />
      {diffLens && selectedTerminal && (
        <DiffLens
          key={`${diffLens.repoPath}|${diffLens.repo ?? ""}#${diffLens.number}`}
          target={diffLens}
          onClose={companionLens.dismiss}
          replyStrip={replyStrip}
        />
      )}
      {isRunLensOpen && picked && pickedSource && (
        <RunLens
          key={picked.key}
          source={pickedSource}
          now={workflows.now}
          terminalId={activeTerminalId ?? ""}
          projectPath={builderPath ?? activeProject}
          archonOnline={workflows.data.archon.online === true}
          workflows={workflows.data.archon.workflows}
          terminals={terminals}
          onChanged={() => void workflows.refresh()}
          onSelectTerminal={showTerminal}
          onSpawnTerminal={spawnTerminal}
          replyStrip={replyStrip}
          onClose={() => setIsRunLensOpen(false)}
        />
      )}
      {toposDock.wide && selectedTerminal && (
        <ToposLens
          dock={toposDock}
          terminalId={selectedTerminal.id}
          title={toposTarget ? `Topos · ${toposTarget.name}` : "Topos"}
          replyStrip={replyStrip}
        />
      )}
      </div>

      <Companion
        selectedTerminal={selectedTerminal}
        projects={projects}
        projectWorktrees={projectWorktrees}
        views={COMPANION_VIEWS}
        prefs={companionStore}
        linking={linking}
        lens={diffLensControl}
        ticketActions={ticketActions}
        topos={toposDock.companion}
        activity={companionActivity}
        showRequest={companionRequest}
        run={companionRun}
        inspector={companionInspector}
        toast={<MergeUndoToast undo={mergeUndo} />}
      />

      {/* The pie menu, opened at the pointer per surface: middle-click, Alt+Right-click, and plain right-click on the companion, empty stage and module bar */}
      <PieMenuHost
        palette={shellPrefs.piePalette}
        labelOutline={shellPrefs.pieLabelOutline}
        displayDelayMs={shellPrefs.pieDisplayDelayMs}
        recentCommands={recentPaletteCommands}
        mergeable={selectedPrMergeable}
        onChoose={runPieStroke}
        onStroke={logPieStroke}
      />

      {/* Global Command Palette (Ctrl+Shift+P anywhere, Ctrl+K outside a terminal) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        projects={projects}
        activeProject={activeProject}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        projectWorktrees={projectWorktrees}
        onSelectProject={(p) => setActiveProject(p)}
        onSelectTerminal={(id, projPath) => {
          if (projPath && projPath !== activeProject) {
            setActiveProject(projPath);
          }
          showTerminal(id);
        }}
        onSetLayout={setLayout}
        onToggleZoom={toggleZoom}
        onFocusNextPane={focusNextPane}
        onNewTerminal={(runKind) => {
          if (runKind) {
            spawnTerminal({
              project_path: activeProject,
              run_kind: runKind,
              name: runKind,
            });
          } else {
            setIsNewTerminalOpen(true);
          }
        }}
        onOpenWorkspaceSettings={() => openWorkspaceSettings(activeProject)}
        onOpenSwarmBuilder={openSwarmBuilder}
        onLaunchSwarmPreset={launchSwarm}
        savedSwarms={savedSwarms}
        onOpenActionLog={() => setIsActionLogOpen(true)}
        onBroadcast={() => setIsBroadcastOpen(true)}
        onOpenActivity={openSelectedActivity}
        onOpenDiffInspector={openRepoDiffs}
        onOpenNewWorktree={() => openNewWorktreeModal(activeRootRepo)}
        onOpenSourceControl={openSourceControl}
        onOpenPrePrAudit={openPrePrAudit}
        onOpenSessionHistory={openSessionHistory}
        onOpenAttentionQueue={() => setOpenModule("agents")}
        onSelectNextWaiting={selectNextWaiting}
        onOpenTokenSpend={() => setIsTokenSpendOpen(true)}
        onOpenArchonGraph={() => openArchonGraph()}
        onOpenWorkflows={openWorkflows}
        onNewWorkOrder={() => openTool(NEW_WORK_ORDER_TOOL)}
        onOpenFactoryConfig={() => openTool(FACTORY_CONFIG_TOOL)}
        onOpenPraxisBuilder={openPraxisBuilder}
        onOpenTopos={openToposView}
        onOpenLogsFolder={openLogsFolder}
        onOpenInVsCode={handleOpenInVsCode}
        toposTarget={toposTarget}
        onToposRequest={requestTopos}
        onCheckForUpdates={openUpdateModal}
        shellPrefs={shellPrefs}
        onSetShellPref={setShellPref}
        onToggleLiveMode={
          activeTerminalId
            ? () => {
                const term = terminals.find((t) => t.id === activeTerminalId);
                if (term) toggleTerminalLiveMode(term.id, term.live_mode);
              }
            : undefined
        }
        onAddProject={() => setIsAddProjectOpen(true)}
        onRanCommand={(command) => setRecentPaletteCommands(recentCommandStore.ran(command))}
        runnerRef={paletteRunner}
      />

      {/* Workspace Settings Modal (Env Vars & Default Launch Flags) */}
      <WorkspaceSettingsModal
        isOpen={isWorkspaceSettingsOpen}
        project={activeProjectObj}
        onClose={closeWorkspaceSettings}
        onSave={async (path, envVars, defaultFlags) => {
          await updateProjectSettings(path, envVars, defaultFlags);
        }}
      />

      {/* Visual Diff & File Change Inspector Drawer */}
      <DiffViewerDrawer
        isOpen={isDiffInspectorOpen}
        onClose={() => setIsDiffInspectorOpen(false)}
        events={events}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
      />

      {/* The notice for a permission answer that reached no agent */}
      <AttentionSurfaces queue={attentionQueue} terminals={terminals} />

      {/* Broadcast to all agents, from the palette */}
      <BroadcastDialog isOpen={isBroadcastOpen} project={activeProject} onClose={() => setIsBroadcastOpen(false)} />

      {/* Open Project Dialog */}
      <OpenProjectDialog
        isOpen={isAddProjectOpen}
        onClose={() => setIsAddProjectOpen(false)}
        projects={projects}
        onAddProject={addProject}
        onSelectProject={(path) => setActiveProject(path)}
      />

      {/* New Terminal Dialog (Ctrl+Shift+B n) */}
      <NewTerminalModal
        isOpen={isNewTerminalOpen}
        projectPath={activeProject}
        onClose={() => setIsNewTerminalOpen(false)}
        onSpawn={spawnTerminal}
      />

      {/* Action Log Drawer */}
      <ActionLogDrawer
        isOpen={isActionLogOpen}
        terminalId={activeTerminalId}
        events={currentEvents}
        allEvents={events}
        onClose={() => setIsActionLogOpen(false)}
      />

      {/* Worktree removal refused by git: show its error and offer Remove anyway */}
      <RemoveWorktreeDialog
        prompt={worktreeRemovalPrompt}
        onCancel={() => setWorktreeRemovalPrompt(null)}
        onRemoveAnyway={async ({ repoPath, worktreePath }) => {
          await removeWorktree(repoPath, worktreePath, true);
          setWorktreeRemovalPrompt(null);
        }}
      />

      {/* Git Worktree Creation Modal (Ctrl+Shift+B w) */}
      <NewWorktreeModal
        isOpen={isNewWorktreeOpen}
        repoPath={worktreeModalTarget?.repoPath || activeRootRepo}
        projectName={worktreeModalTarget?.projectName || activeProjectObj?.name || "Repo"}
        suggestedIssueNumber={worktreeModalTarget?.suggestedIssueNumber}
        onClose={() => setIsNewWorktreeOpen(false)}
        onCreate={async (branch, newBranch, baseBranch, launchClaude) => {
          const fromIssue = worktreeModalTarget?.suggestedIssueNumber;
          const { terminal } = await createWorktree(
            worktreeModalTarget?.repoPath || activeRootRepo,
            branch,
            newBranch,
            baseBranch,
            launchClaude
          );
          // A worktree created from an issue launches its terminal with that ticket as a launch fact
          if (terminal && fromIssue) recordLaunch(terminal, fromIssue);
        }}
      />

      {/* Pre-PR Audit Gate Modal (Ctrl+Shift+B a) */}
      <PrePrAuditModal
        isOpen={isAuditModalOpen}
        projectPath={activeRootRepo}
        projectName={activeProjectObj?.name || "Repo"}
        onClose={() => setIsAuditModalOpen(false)}
        onFixWithClaude={handleFixAuditWithClaude}
      />

      {/* Token spend window, from the Project panel, the module bar's spend ticker and the palette */}
      <TokenSpendModal
        isOpen={isTokenSpendOpen}
        stats={claudeStats}
        onRefresh={refreshClaudeStats}
        onClose={() => setIsTokenSpendOpen(false)}
      />

      {/* Archon & SDD Spec Graph Inspector Modal, from the palette and Start's All tasks and ADRs */}
      <ArchonGraphModal
        isOpen={isArchonGraphOpen}
        openOn={archonOpenOn}
        activeProject={activeProject}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        onClose={() => setIsArchonGraphOpen(false)}
        onSelectTerminal={selectTerminal}
        onSpawnTerminal={spawnTerminal}
        onWritePty={(terminalId, data) => invoke("write_pty", { terminalId, data })}
      />

      {/* Praxis Builder (Ctrl+Shift+B p), over its stage tab's slot while the tab is in front:
          hidden, never unmounted, otherwise. Its inspector draws in the companion's Inspector view. */}
      <SlotLayer slot={builderInFront ? builderSlot : null} layerClass="z-30 flex" data={{ "data-praxis-builder-layer": true }}>
      <PraxisBuilder
        ref={praxisBuilder}
        isOpen={builderInFront}
        inspectorSlot={builderInFront ? inspectorSlot : undefined}
        project={builderProject}
        onClose={closePraxisBuilder}
        onAddProject={() => setIsAddProjectOpen(true)}
        onUnsavedProjectsChange={onPraxisUnsavedChange}
        onRunInTerminal={runInPraxisTerminal}
        onGraphOpened={onGraphOpened}
      />
      </SlotLayer>

      {/* Topos git cockpit (Ctrl+Shift+B c), over the companion's Topos view or in the Topos lens:
          hidden, never unmounted, when neither shows */}
      <ToposLayer dock={toposDock}>
        <Topos
          isOpen={toposDock.placement !== null}
          wide={toposDock.placement === "lens"}
          focusKey={toposFocus}
          project={toposTarget}
          terminals={terminals}
          onOpenTerminal={openToposTerminal}
          onNewAgent={startToposAgent}
          onShowWorktree={showToposWorktree}
          onRunInTerminal={runInToposTerminal}
          request={toposRequest}
        />
      </ToposLayer>

      {/* Global Live A2A Dispatch HUD & Swarm Broadcast Toasts */}
      <A2AToast
        terminals={terminals}
        onSelectTerminal={selectTerminal}
      />

      {/* Software Update Checker & Installer Modal, from the Project panel's Check for updates and the palette */}
      <UpdateModal
        isOpen={isUpdateModalOpen}
        onClose={() => setIsUpdateModalOpen(false)}
        initialUpdate={detectedUpdate}
      />

      {/* VS Code Launch/Focus Error Toast */}
      {vscodeError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 max-w-md bg-[#161b22] border border-[#f85149] text-white p-3 rounded-lg shadow-xl z-50 flex items-start gap-2.5 animate-in fade-in slide-in-from-bottom-2"
        >
          <AlertCircle className="w-5 h-5 text-[#f85149] shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <div className="font-semibold text-[#f85149]">VS Code Error</div>
            <div className="text-[#c9d1d9] mt-0.5">{vscodeError}</div>
          </div>
          <button
            onClick={() => setVscodeError(null)}
            className="text-[#8b949e] hover:text-white p-0.5"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
