import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspace } from "./slices/workspace/useWorkspace";
import { useBridgeEvents } from "./slices/bridge/useBridgeEvents";
import { Rail } from "./slices/rail/Rail";
import { Stage } from "./slices/stage/Stage";
import { NewTerminalModal } from "./slices/terminal/NewTerminalModal";
import { AddProjectModal } from "./slices/workspace/AddProjectModal";
import { ActionLogDrawer } from "./slices/bridge/ActionLogDrawer";
import { A2APanel } from "./slices/orchestrator/A2APanel";
import { PermissionModal } from "./slices/bridge/PermissionModal";
import { WorkspaceSettingsModal } from "./slices/workspace/WorkspaceSettingsModal";
import { SwarmModal } from "./slices/orchestrator/SwarmModal";
import { useSavedSwarms } from "./slices/orchestrator/useSavedSwarms";
import { CommandPalette } from "./slices/command-palette/CommandPalette";
import { DiffViewerDrawer } from "./slices/bridge/DiffViewerDrawer";
import { NewWorktreeModal } from "./slices/git/NewWorktreeModal";
import { GithubCompanionDrawer } from "./slices/github/GithubCompanionDrawer";
import { GithubIssue, GithubPullRequest } from "./slices/github/types";
import { TerminalInfo } from "./slices/terminal/types";
import { getGlobalTerminalDimensions } from "./slices/terminal/useTerminal";
import { PrePrAuditModal } from "./slices/audit/PrePrAuditModal";
import { AuditViolation } from "./slices/audit/types";
import { SessionHistoryDrawer } from "./slices/sessions/SessionHistoryDrawer";
import { TokenSpendModal } from "./slices/metrics/TokenSpendModal";
import { ArchonGraphModal } from "./slices/archon/ArchonGraphModal";
import { ArchonWorkflow } from "./slices/archon/types";
import { FactoryStationModal } from "./slices/machina/FactoryStationModal";
import { A2AToast } from "./slices/orchestrator/A2AToast";
import { submitPromptToTerminal } from "./slices/terminal/submitPrompt";
import { UpdateModal } from "./slices/updater/UpdateModal";
import { checkForUpdates } from "./slices/updater/updaterService";
import { UpdateInfo } from "./slices/updater/types";

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
    isA2AOpen,
    setIsA2AOpen,
    isActionLogOpen,
    setIsActionLogOpen,
    isWorkspaceSettingsOpen,
    workspaceSettingsTarget,
    openWorkspaceSettings,
    closeWorkspaceSettings,
    updateProjectSettings,
    isSwarmModalOpen,
    setIsSwarmModalOpen,
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
    isGithubDrawerOpen,
    setIsGithubDrawerOpen,
    isAuditModalOpen,
    setIsAuditModalOpen,
    isSessionHistoryOpen,
    setIsSessionHistoryOpen,
    isTokenSpendOpen,
    setIsTokenSpendOpen,
    isArchonGraphOpen,
    setIsArchonGraphOpen,
    isFactoryStationOpen,
    setIsFactoryStationOpen,
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
  } = useWorkspace();

  const { events, activeTools, pendingPermissions, resolvePermission, getTerminalEvents } =
    useBridgeEvents();

  // One instance shared by the swarm builder and the command palette
  const { savedSwarms, saveSwarm, removeSwarm } = useSavedSwarms();

  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);
  const [detectedUpdate, setDetectedUpdate] = useState<UpdateInfo | null>(null);

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

  // Auto-surface permission approval modal when a tool requests approval
  useEffect(() => {
    if (pendingPermissions.length > 0) {
      setIsPermissionModalOpen(true);
    }
  }, [pendingPermissions.length]);

  const currentTool = activeTerminalId ? activeTools[activeTerminalId] : null;
  const currentEvents = getTerminalEvents(activeTerminalId);

  // Calculate total file modifications recorded across events
  const diffCount = useMemo(() => {
    let count = 0;
    events.forEach((e) => {
      const tool = (e.data?.tool || "").toLowerCase();
      const input = e.data?.input;
      if (input && typeof input === "object") {
        if (
          tool === "edit" ||
          tool.includes("edit") ||
          tool === "write" ||
          tool.includes("write") ||
          input.old_string !== undefined ||
          input.content !== undefined
        ) {
          count++;
        }
      }
    });
    return count;
  }, [events]);

  const activeProjectObj =
    workspaceSettingsTarget || projects.find((p) => p.path === activeProject) || null;

  // Resolve base repository root if activeProject is a child worktree folder
  const activeRootRepo = useMemo(() => {
    const matched = projects.find(
      (p) =>
        activeProject === p.path ||
        activeProject.startsWith(p.path + "\\") ||
        activeProject.startsWith(p.path + "/")
    );
    return matched ? matched.path : activeProject;
  }, [activeProject, projects]);

  // 1-Click: Execute real Archon Workflow Run for an issue
  const handleImplementIssue = async (issue: GithubIssue, workflowOverride?: string) => {
    const rootRepo = activeRootRepo;
    const targetDir = activeProject !== activeRootRepo ? activeProject : rootRepo;
    const isWorktree = activeProject !== activeRootRepo;

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

      setIsGithubDrawerOpen(false);
    } catch (err) {
      console.error("Failed to run Archon workflow:", err);
      alert(`Failed to run Archon workflow for issue #${issue.number}: ${err}`);
    }
  };

  // 1-Click: Triage issue with Archon workflow
  const handleTriageIssue = async (issue: GithubIssue, workflowOverride?: string) => {
    const rootRepo = activeRootRepo;
    const targetDir = activeProject !== activeRootRepo ? activeProject : rootRepo;
    const isWorktree = activeProject !== activeRootRepo;

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

      setIsGithubDrawerOpen(false);
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

      setIsGithubDrawerOpen(false);
    } catch (err) {
      console.error("Failed to resolve PR conflicts with Archon:", err);
      alert(`Failed to resolve PR conflicts for PR #${pr.number}: ${err}`);
    }
  };

  // 1-Click: Create worktree modal targeting specific issue
  const handleCreateWorktreeForIssue = (issue: GithubIssue) => {
    openNewWorktreeModal(activeRootRepo, issue.number);
  };

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d1117] text-[#c9d1d9]">
      {/* Left Navigation Rail */}
      <Rail
        projects={projects}
        activeProject={activeProject}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        bridgePort={bridgePort}
        projectWorktrees={projectWorktrees}
        claudeStats={claudeStats}
        onSelectTerminal={(id) => setActiveTerminalId(id)}
        onCloseTerminal={(id) => killTerminal(id)}
        onNewTerminal={(projPath) => {
          if (projPath) setActiveProject(projPath);
          setIsNewTerminalOpen(true);
        }}
        onSelectProject={(path) => setActiveProject(path)}
        onAddProject={() => setIsAddProjectOpen(true)}
        onRemoveProject={(path) => removeProject(path)}
        onRenameTerminal={renameTerminal}
        onOpenA2APanel={() => setIsA2AOpen(true)}
        onOpenSettings={(proj) => openWorkspaceSettings(proj)}
        onOpenSwarm={() => setIsSwarmModalOpen(true)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenNewWorktree={(repoPath) => openNewWorktreeModal(repoPath)}
        onRemoveWorktree={(repoPath, wtPath) => removeWorktree(repoPath, wtPath)}
        onOpenGithubDrawer={() => setIsGithubDrawerOpen(true)}
        onOpenPrePrAudit={() => setIsAuditModalOpen(true)}
        onOpenSessionHistory={() => setIsSessionHistoryOpen(true)}
        onOpenTokenSpend={() => setIsTokenSpendOpen(true)}
        onOpenArchonGraph={() => setIsArchonGraphOpen(true)}
        onOpenFactoryStation={() => setIsFactoryStationOpen(true)}
        onRelaunchTerminal={relaunchTerminal}
      />

      {/* Main Workspace Stage */}
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
        pendingPermissionsCount={pendingPermissions.length}
        diffCount={diffCount}
        claudeStats={claudeStats}
        onSelectTerminal={selectTerminal}
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
        onOpenActionLog={() => setIsActionLogOpen(true)}
        onOpenPermissionModal={() => setIsPermissionModalOpen(true)}
        onOpenWorkspaceSettings={() => openWorkspaceSettings(activeProject)}
        onOpenSwarm={() => setIsSwarmModalOpen(true)}
        onOpenDiffInspector={() => setIsDiffInspectorOpen(true)}
        onOpenNewWorktree={() => openNewWorktreeModal(activeRootRepo)}
        onOpenGithubDrawer={() => setIsGithubDrawerOpen(true)}
        onOpenAuditModal={() => setIsAuditModalOpen(true)}
        onOpenSessionHistory={() => setIsSessionHistoryOpen(true)}
        onOpenTokenSpend={() => setIsTokenSpendOpen(true)}
        onOpenFactoryStation={() => setIsFactoryStationOpen(true)}
        onToggleLiveMode={toggleTerminalLiveMode}
        onRelaunchTerminal={relaunchTerminal}
      />

      {/* Global Command Palette (Ctrl+K / Cmd+K) */}
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
          selectTerminal(id);
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
        onOpenSwarmModal={() => setIsSwarmModalOpen(true)}
        onLaunchSwarmPreset={launchSwarm}
        savedSwarms={savedSwarms}
        onOpenActionLog={() => setIsActionLogOpen(true)}
        onOpenA2A={() => setIsA2AOpen(true)}
        onOpenDiffInspector={() => setIsDiffInspectorOpen(true)}
        onOpenNewWorktree={() => openNewWorktreeModal(activeRootRepo)}
        onOpenGithubDrawer={() => setIsGithubDrawerOpen(true)}
        onOpenPrePrAudit={() => setIsAuditModalOpen(true)}
        onOpenSessionHistory={() => setIsSessionHistoryOpen(true)}
        onOpenTokenSpend={() => setIsTokenSpendOpen(true)}
        onOpenArchonGraph={() => setIsArchonGraphOpen(true)}
        onOpenFactoryStation={() => setIsFactoryStationOpen(true)}
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

      {/* 1-Click Multi-Agent Swarm Preset Modal */}
      <SwarmModal
        isOpen={isSwarmModalOpen}
        activeProject={activeProject}
        onClose={() => setIsSwarmModalOpen(false)}
        onLaunchSwarm={launchSwarm}
        savedSwarms={savedSwarms}
        onSaveSwarm={saveSwarm}
        onRemoveSwarm={removeSwarm}
      />

      {/* Visual Diff & File Change Inspector Drawer */}
      <DiffViewerDrawer
        isOpen={isDiffInspectorOpen}
        onClose={() => setIsDiffInspectorOpen(false)}
        events={events}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
      />

      {/* Interactive Tool Approval Modal */}
      {isPermissionModalOpen && pendingPermissions.length > 0 && (
        <PermissionModal
          pendingRequests={pendingPermissions}
          terminals={terminals}
          onResolve={(reqId, decision, reason, remember) => {
            resolvePermission(reqId, decision, reason, remember);
            if (pendingPermissions.length <= 1) {
              setIsPermissionModalOpen(false);
            }
          }}
        />
      )}

      {/* Add Project Dialog */}
      <AddProjectModal
        isOpen={isAddProjectOpen}
        onClose={() => setIsAddProjectOpen(false)}
        onAddProject={addProject}
      />

      {/* New Terminal Dialog (^b n) */}
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

      {/* Agent-to-Agent Orchestration Bus Panel */}
      <A2APanel
        isOpen={isA2AOpen}
        terminals={terminals}
        onClose={() => setIsA2AOpen(false)}
      />

      {/* Git Worktree Creation Modal (^b w) */}
      <NewWorktreeModal
        isOpen={isNewWorktreeOpen}
        repoPath={worktreeModalTarget?.repoPath || activeRootRepo}
        projectName={worktreeModalTarget?.projectName || activeProjectObj?.name || "Repo"}
        suggestedIssueNumber={worktreeModalTarget?.suggestedIssueNumber}
        onClose={() => setIsNewWorktreeOpen(false)}
        onCreate={async (branch, newBranch, baseBranch, launchClaude) => {
          await createWorktree(
            worktreeModalTarget?.repoPath || activeRootRepo,
            branch,
            newBranch,
            baseBranch,
            launchClaude
          );
        }}
      />

      {/* GitHub Companion Drawer (^b i) */}
      <GithubCompanionDrawer
        isOpen={isGithubDrawerOpen}
        repoPath={activeRootRepo}
        projectName={activeProjectObj?.name || "Repo"}
        onClose={() => setIsGithubDrawerOpen(false)}
        onImplementIssue={handleImplementIssue}
        onTriageIssue={handleTriageIssue}
        onCreateWorktreeForIssue={handleCreateWorktreeForIssue}
        onResolvePrConflicts={handleResolvePrConflicts}
        onOpenArchonMonitor={() => setIsArchonGraphOpen(true)}
      />

      {/* Pre-PR Audit Gate Modal (^b a) */}
      <PrePrAuditModal
        isOpen={isAuditModalOpen}
        projectPath={activeRootRepo}
        projectName={activeProjectObj?.name || "Repo"}
        onClose={() => setIsAuditModalOpen(false)}
        onFixWithClaude={handleFixAuditWithClaude}
      />

      {/* Claude Session History & Auto-Resume Drawer (^b h) */}
      <SessionHistoryDrawer
        isOpen={isSessionHistoryOpen}
        activeProject={activeProject}
        onClose={() => setIsSessionHistoryOpen(false)}
        onResumeSession={(sessionId, projectPath) => resumeSession(sessionId, projectPath)}
      />

      {/* Claude Live Token Spend & Background Turn Chime Modal (^b t) */}
      <TokenSpendModal
        isOpen={isTokenSpendOpen}
        stats={claudeStats}
        onRefresh={refreshClaudeStats}
        onClose={() => setIsTokenSpendOpen(false)}
      />

      {/* Archon & SDD Spec Graph Inspector Modal (^b r) */}
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

      {/* Machina software factory (^b f) */}
      <FactoryStationModal
        isOpen={isFactoryStationOpen}
        activeProject={activeProject}
        terminals={terminals}
        onClose={() => setIsFactoryStationOpen(false)}
        onSelectTerminal={selectTerminal}
        onSpawnTerminal={spawnTerminal}
      />

      {/* Global Live A2A Dispatch HUD & Swarm Broadcast Toasts */}
      <A2AToast
        terminals={terminals}
        onSelectTerminal={selectTerminal}
      />

      {/* Software Update Checker & Installer Modal (^b u) */}
      <UpdateModal
        isOpen={isUpdateModalOpen}
        onClose={() => setIsUpdateModalOpen(false)}
        initialUpdate={detectedUpdate}
      />
    </div>
  );
}

export default App;
