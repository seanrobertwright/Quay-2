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
import { CommandPalette } from "./slices/command-palette/CommandPalette";
import { DiffViewerDrawer } from "./slices/bridge/DiffViewerDrawer";
import { NewWorktreeModal } from "./slices/git/NewWorktreeModal";
import { GithubCompanionDrawer } from "./slices/github/GithubCompanionDrawer";
import { GithubIssue, GithubPullRequest } from "./slices/github/types";
import { TerminalInfo } from "./slices/terminal/types";
import { PrePrAuditModal } from "./slices/audit/PrePrAuditModal";
import { AuditViolation } from "./slices/audit/types";
import { SessionHistoryDrawer } from "./slices/sessions/SessionHistoryDrawer";
import { TokenSpendModal } from "./slices/metrics/TokenSpendModal";
import { ArchonGraphModal } from "./slices/archon/ArchonGraphModal";
import { FactoryStationModal } from "./slices/machina/FactoryStationModal";
import { A2AToast } from "./slices/orchestrator/A2AToast";
import { submitPromptToTerminal } from "./slices/terminal/submitPrompt";

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

  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);

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

  // 1-Click: Implement issue in dedicated git worktree with Claude Code
  const handleImplementIssue = async (issue: GithubIssue) => {
    const rootRepo = activeRootRepo;
    const branchName = `feat/issue-${issue.number}`;
    const cleanBranch = `issue-${issue.number}`;

    try {
      // Check if worktree for this branch already exists
      const existingWts = projectWorktrees[rootRepo] || [];
      const matchedWt = existingWts.find(
        (wt) =>
          wt.branch === `refs/heads/${branchName}` ||
          wt.branch === branchName ||
          wt.path.endsWith(cleanBranch)
      );

      let targetTerminalId: string | null = null;
      // A terminal spawned here is still starting, so the prompt waits for it to settle
      let spawnedTerminal = false;

      if (matchedWt) {
        // Worktree already exists, switch active project to it
        setActiveProject(matchedWt.path);
        const existingTerm = terminals.find((t) => t.project_path === matchedWt.path);
        if (existingTerm) {
          selectTerminal(existingTerm.id);
          targetTerminalId = existingTerm.id;
        } else {
          // Spawn Claude Code in that worktree
          const spawned = await invoke<TerminalInfo>("spawn_terminal", {
            request: {
              project_path: matchedWt.path,
              run_kind: "claude",
              name: `wt-${cleanBranch}`,
            },
          });
          selectTerminal(spawned.id);
          targetTerminalId = spawned.id;
          spawnedTerminal = true;
        }
      } else {
        // Create new worktree and launch Claude
        const res = await createWorktree(rootRepo, branchName, true, "main", true);
        if (res?.terminal) {
          targetTerminalId = res.terminal.id;
          spawnedTerminal = true;
        }
      }

      // Close the GitHub drawer to give focus to the terminal
      setIsGithubDrawerOpen(false);

      // Auto-dispatch user's proven workflow prompt into the terminal ConPTY
      if (targetTerminalId) {
        submitPromptToTerminal(
          targetTerminalId,
          `use archon and lril workflows to implement issue ${issue.number}`,
          { awaitStartup: spawnedTerminal }
        ).catch(console.error);
      }
    } catch (err) {
      console.error("Failed to implement issue:", err);
      alert(`Failed to implement issue #${issue.number}: ${err}`);
    }
  };

  // 1-Click: Triage issue with Wayfinder
  const handleTriageIssue = async (issue: GithubIssue) => {
    const prompt = `/wayfinder ${issue.number} triage this issue`;
    try {
      if (activeTerminalId) {
        await submitPromptToTerminal(activeTerminalId, prompt);
      } else {
        // Spawn Claude terminal in active project
        const spawned = await invoke<TerminalInfo>("spawn_terminal", {
          request: {
            project_path: activeProject,
            run_kind: "claude",
            name: `claude-triage`,
          },
        });
        selectTerminal(spawned.id);
        submitPromptToTerminal(spawned.id, prompt, { awaitStartup: true }).catch(console.error);
      }
      setIsGithubDrawerOpen(false);
    } catch (err) {
      console.error("Failed to triage issue:", err);
    }
  };

  // 1-Click: Resolve merge conflicts in PR
  const handleResolvePrConflicts = async (_pr: GithubPullRequest) => {
    const prompt = `resolve the merge conflicts in this issue's PR.`;
    try {
      if (activeTerminalId) {
        await submitPromptToTerminal(activeTerminalId, prompt);
      } else {
        const spawned = await invoke<TerminalInfo>("spawn_terminal", {
          request: {
            project_path: activeProject,
            run_kind: "claude",
            name: `claude-conflict`,
          },
        });
        selectTerminal(spawned.id);
        submitPromptToTerminal(spawned.id, prompt, { awaitStartup: true }).catch(console.error);
      }
      setIsGithubDrawerOpen(false);
    } catch (err) {
      console.error("Failed to resolve PR conflicts:", err);
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
        const spawned = await invoke<TerminalInfo>("spawn_terminal", {
          request: {
            project_path: activeProject,
            run_kind: "claude",
            name: "audit-fixer",
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
      />

      {/* 1-Click Multi-Agent Swarm Preset Modal */}
      <SwarmModal
        isOpen={isSwarmModalOpen}
        activeProject={activeProject}
        onClose={() => setIsSwarmModalOpen(false)}
        onLaunchSwarm={launchSwarm}
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
    </div>
  );
}

export default App;
