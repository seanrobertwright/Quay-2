import { useState, useEffect, useMemo, useCallback, useRef, useId } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspace } from "./slices/workspace/useWorkspace";
import { useBridgeEvents } from "./slices/bridge/useBridgeEvents";
import { useAttentionQueue } from "./slices/attention/useAttentionQueue";
import { AttentionSurfaces } from "./slices/attention/AttentionSurfaces";
import { ProjectsPanel } from "./slices/rail/ProjectsPanel";
import { ModuleBar } from "./slices/shell/ModuleBar";
import { TerminalStatusList } from "./slices/shell/TerminalStatusList";
import { askingTerminals, nextWaitingTerminal, statusRows } from "./slices/shell/terminalStatus";
import { useOpenPrCount } from "./slices/github/useOpenPrCount";
import { LauncherPanel, ModulePanel } from "./slices/shell/ModulePanel";
import { placeholderLaunchers, type PlaceholderModule } from "./slices/shell/placeholderPanels";
import { MODULE_NAMES, type ModuleId } from "./slices/shell/modules";
import { Stage } from "./slices/stage/Stage";
import { Companion, COMPANION_VIEWS, type CompanionShowRequest } from "./slices/companion/Companion";
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
import type { LinkRef, LinkSlotName, TerminalInfo } from "./slices/terminal/types";
import { getGlobalTerminalDimensions } from "./slices/terminal/useTerminal";
import { PrePrAuditModal } from "./slices/audit/PrePrAuditModal";
import { AuditViolation } from "./slices/audit/types";
import { TokenSpendModal } from "./slices/metrics/TokenSpendModal";
import { ArchonGraphModal } from "./slices/archon/ArchonGraphModal";
import { ArchonWorkflow } from "./slices/archon/types";
import { FactoryStationModal } from "./slices/machina/FactoryStationModal";
import { BuilderProject, PraxisBuilderModal, type PraxisBuilderHandle } from "./slices/praxis-builder/PraxisBuilderModal";
import { Topos, type ToposTarget } from "./slices/git/topos/Topos";
import { ToposLayer, ToposLens, useToposDock } from "./slices/companion/ToposDock";
import type { ToposRequestKind } from "./slices/git/topos/toposPalette";
import { commandLine, shellFor, typeCommand } from "./slices/terminal/typedCommand";
import { NEW_AGENT_RUN_KIND } from "./slices/git/topos/handOff";
import { A2AToast } from "./slices/orchestrator/A2AToast";
import { submitPromptToTerminal } from "./slices/terminal/submitPrompt";
import { UpdateModal } from "./slices/updater/UpdateModal";
import { checkForUpdates } from "./slices/updater/updaterService";
import { UpdateInfo } from "./slices/updater/types";
import { isSamePath, resolveRootRepo } from "./utils/paths";
import { AlertCircle, X, Zap } from "lucide-react";
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

/** The swarm builder's stage tab id. */
const SWARM_BUILDER_TOOL = "swarm-builder";

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
    isFactoryStationOpen,
    setIsFactoryStationOpen,
    isPraxisBuilderOpen,
    setIsPraxisBuilderOpen,
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
    agentOpeners,
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
  const closePraxisBuilder = useCallback(() => setIsPraxisBuilderOpen(false), [setIsPraxisBuilderOpen]);
  // The diff lens and the Topos lens open over the stage one at a time: opening one closes the other.
  const companionLens = useDiffLens(activeTerminalId);
  // Each open of Topos by a chord, the palette or its Wide toggle moves focus into it.
  const [toposFocus, setToposFocus] = useState(0);
  const toposDock = useToposDock(activeTerminalId, () => {
    companionLens.dismiss();
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
  // operator to answer. The builder hides so the terminal shows.
  const runInPraxisTerminal = useCallback(
    (cwd: string, argv: string[]) => runInShellTerminal(cwd, argv, "praxis", () => setIsPraxisBuilderOpen(false)),
    [runInShellTerminal, setIsPraxisBuilderOpen]
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
  const { linking, recordLaunch } = useTerminalLinks(terminals, projects, projectWorktrees);

  const diffLens = companionLens.shown;
  const diffLensControl = useMemo(
    () => ({
      ...companionLens,
      openDiff: (target: DiffLensTarget) => {
        dismissTopos();
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

  // The swarm builder's stage tab, open or not, and whether it is in front of the terminals. Picking
  // a terminal anywhere brings the terminals back in front; the tab stays open until closed.
  const [isSwarmBuilderOpen, setIsSwarmBuilderOpen] = useState(false);
  const [frontToolId, setFrontToolId] = useState<string | null>(null);
  const openSwarmBuilder = () => {
    setIsSwarmBuilderOpen(true);
    setFrontToolId(SWARM_BUILDER_TOOL);
  };
  const closeSwarmBuilder = useCallback(() => {
    setIsSwarmBuilderOpen(false);
    setFrontToolId((front) => (front === SWARM_BUILDER_TOOL ? null : front));
  }, []);
  // `select` with the terminals brought back in front of any tool tab
  const inFront = (select: (id: string) => void) => (id: string) => {
    setFrontToolId(null);
    select(id);
  };
  const showTerminal = inFront(selectTerminal);
  const stageTools: StageTool[] = isSwarmBuilderOpen
    ? [
        {
          id: SWARM_BUILDER_TOOL,
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
      ]
    : [];

  // The Activity view for a terminal, once it is the selected one: selecting a terminal in another
  // project lands a moment later, and the companion takes a request only for the selected terminal.
  const [pendingActivity, setPendingActivity] = useState<{ terminalId: string; entryId?: string } | null>(null);
  useEffect(() => {
    if (!pendingActivity || pendingActivity.terminalId !== activeTerminalId) return;
    const { terminalId, entryId } = pendingActivity;
    setPendingActivity(null);
    setCompanionRequest((prev) => ({ terminalId, view: "activity", entryId, seq: (prev?.seq ?? 0) + 1 }));
  }, [pendingActivity, activeTerminalId]);
  const openActivity = (terminalId: string, entryId?: string) => {
    if (terminalId !== activeTerminalId) showTerminal(terminalId);
    setPendingActivity({ terminalId, entryId });
  };
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
  const openSelectedActivity = () => {
    if (activeTerminalId) openActivity(activeTerminalId);
  };
  agentOpeners.current = { openSwarmBuilder, openSessionHistory, selectNextWaiting, openActivity: openSelectedActivity };
  const companionActivity = useMemo<CompanionActivity>(
    () => ({ events, messages: trailMessages, waiting: waitingItems, answer: attentionQueue.answerPermission }),
    [events, trailMessages, waitingItems, attentionQueue.answerPermission]
  );

  const launchers = placeholderLaunchers({
    openArchon: () => setIsArchonGraphOpen(true),
    openFactory: () => setIsFactoryStationOpen(true),
    openPraxisBuilder: () => setIsPraxisBuilderOpen(true),
    // A worktree's settings are its project's, so the selected worktree resolves to its root repo.
    openWorkspaceSettings: () => openWorkspaceSettings(activeRootRepo),
    openInVsCode: () => void handleOpenInVsCode(activeProject),
    openTokenSpend: () => setIsTokenSpendOpen(true),
    hasProject: activeProject !== "",
  });
  const launcherPanel = (module: PlaceholderModule) => (
    <LauncherPanel title={MODULE_NAMES[module]} launchers={launchers[module]} />
  );

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
              onOpenTokenSpend={() => setIsTokenSpendOpen(true)}
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
          workflows: launcherPanel("workflows"),
          project: launcherPanel("project"),
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
        onCloseTool={(id) => {
          if (id === SWARM_BUILDER_TOOL) closeSwarmBuilder();
        }}
      />
      {diffLens && selectedTerminal && (
        <DiffLens
          key={`${diffLens.repoPath}|${diffLens.repo ?? ""}#${diffLens.number}`}
          target={diffLens}
          onClose={companionLens.dismiss}
          replyStrip={replyStrip}
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
        onOpenArchonGraph={() => setIsArchonGraphOpen(true)}
        onOpenFactoryStation={() => setIsFactoryStationOpen(true)}
        onOpenPraxisBuilder={() => setIsPraxisBuilderOpen(true)}
        onOpenTopos={openToposView}
        onOpenLogsFolder={() => {
          invoke("open_logs_folder").catch((err) => alert(`Failed to open the logs folder: ${err}`));
        }}
        onOpenInVsCode={handleOpenInVsCode}
        toposTarget={toposTarget}
        onToposRequest={requestTopos}
        onCheckForUpdates={() => setIsUpdateModalOpen(true)}
        onToggleLiveMode={
          activeTerminalId
            ? () => {
                const term = terminals.find((t) => t.id === activeTerminalId);
                if (term) toggleTerminalLiveMode(term.id, term.live_mode);
              }
            : undefined
        }
        onAddProject={() => setIsAddProjectOpen(true)}
      />

      {/* Workspace Settings Modal (Env Vars & Default Launch Flags) */}
      <WorkspaceSettingsModal
        isOpen={isWorkspaceSettingsOpen}
        project={activeProjectObj}
        onClose={closeWorkspaceSettings}
        onSave={async (path, envVars, defaultFlags) => {
          await updateProjectSettings(path, envVars, defaultFlags);
        }}
        onOpenUpdater={() => {
          closeWorkspaceSettings();
          setIsUpdateModalOpen(true);
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

      {/* Claude Live Token Spend & Background Turn Chime Modal (Ctrl+Shift+B t) */}
      <TokenSpendModal
        isOpen={isTokenSpendOpen}
        stats={claudeStats}
        onRefresh={refreshClaudeStats}
        onClose={() => setIsTokenSpendOpen(false)}
      />

      {/* Archon & SDD Spec Graph Inspector Modal (Ctrl+Shift+B r) */}
      <ArchonGraphModal
        isOpen={isArchonGraphOpen}
        activeProject={activeProject}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        onClose={() => setIsArchonGraphOpen(false)}
        onSelectTerminal={selectTerminal}
        onSpawnTerminal={spawnTerminal}
        onWritePty={(terminalId, data) => invoke("write_pty", { terminalId, data })}
      />

      {/* Machina software factory (Ctrl+Shift+B f) */}
      <FactoryStationModal
        isOpen={isFactoryStationOpen}
        activeProject={activeProject}
        terminals={terminals}
        onClose={() => setIsFactoryStationOpen(false)}
        onSelectTerminal={selectTerminal}
        onSpawnTerminal={spawnTerminal}
      />

      {/* Praxis Builder (Ctrl+Shift+B p): hidden, never unmounted, when closed */}
      <PraxisBuilderModal
        ref={praxisBuilder}
        isOpen={isPraxisBuilderOpen}
        project={builderProject}
        onClose={closePraxisBuilder}
        onAddProject={() => setIsAddProjectOpen(true)}
        onUnsavedProjectsChange={onPraxisUnsavedChange}
        onRunInTerminal={runInPraxisTerminal}
      />

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

      {/* Software Update Checker & Installer Modal (Ctrl+Shift+B u) */}
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
