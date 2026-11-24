import { Fragment, useState, useId, type MouseEvent, type KeyboardEvent } from "react";
import type { PermissionMode, TerminalInfo } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import type { SurfaceKey } from "../surface/surfaceTypes.ts";
import { TerminalRow } from "./TerminalRow.tsx";
import { LaneView, PipelineSection, type ProjectsPipeline } from "./TicketPipeline.tsx";

export type { ProjectsPipeline } from "./TicketPipeline.tsx";
import {
  FolderGit2,
  Plus,
  Radio,
  Activity,
  Layers,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Trash2,
  Settings,
  Zap,
  GitBranch,
  Coins,
} from "lucide-react";
import { VsCodeIcon } from "../workspace/VsCodeIcon.tsx";
import type { ClaudeTokenStats } from "../sessions/types.ts";
import { isSamePath, isSubpathOf, normalizePath } from "../../utils/paths.ts";
import { secondaryWorktrees } from "../shell/terminalStatus.ts";
import { useContextMenu } from "../overlay/useContextMenu.ts";
import { ProjectMenu, WorktreeMenu } from "./RailRowMenus.tsx";
import { worktreeRowName } from "./worktreeMenu.ts";

interface ProjectsPanelProps {
  projects: Project[];
  activeProject: string;
  /** Normalized paths of the projects and worktrees with unsaved Praxis Builder drafts. */
  unsavedPraxisProjects?: ReadonlySet<string>;
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
  bridgePort: number;
  projectWorktrees?: Record<string, GitWorktree[]>;
  claudeStats?: ClaudeTokenStats | null;
  onSelectTerminal: (id: string) => void;
  onCloseTerminal: (id: string) => void;
  onNewTerminal: (projectPath?: string) => void;
  onSelectProject: (path: string) => void;
  onAddProject: () => void;
  onRemoveProject: (path: string) => void;
  onRenameTerminal?: (id: string, name: string) => void;
  onOpenSettings?: (project: Project) => void;
  onOpenSwarm?: () => void;
  onOpenNewWorktree?: (repoPath: string) => void;
  onRemoveWorktree?: (repoPath: string, wtPath: string) => void;
  /** Opens Topos on the active project. */
  onOpenTopos?: () => void;
  onOpenTokenSpend?: () => void;
  onOpenInVsCode?: (projectPath: string) => void;
  onRelaunchTerminal?: (id: string) => void;
  /** Switches a terminal between Skip and Ask, from the mode it is in now. */
  onToggleTerminalAsk?: (id: string, currentMode: PermissionMode) => void;
  /** Opens a terminal's agent surface, from its chip on the terminal's row. */
  onOpenSurface?: (key: SurfaceKey) => void;
  /** The ticket pipeline: a lane on each terminal row that holds a ticket, and the lists under the terminals. */
  pipeline?: ProjectsPipeline | null;
}

/** The row a Projects panel menu is open for: a project's row, or one of its worktrees' rows. */
type RowMenuTarget = { kind: "project"; path: string } | { kind: "worktree"; repoPath: string; path: string };

/** Marks a project or worktree whose Praxis Builder drafts have unsaved changes. */
const UnsavedDot = () => (
  <span className="w-1.5 h-1.5 rounded-full bg-[#e3b341] shrink-0" title="Unsaved Praxis Builder changes">
    <span className="sr-only">(unsaved Praxis Builder changes)</span>
  </span>
);

export const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
  projects,
  activeProject,
  unsavedPraxisProjects,
  terminals,
  activeTerminalId,
  bridgePort,
  projectWorktrees,
  claudeStats,
  onSelectTerminal,
  onCloseTerminal,
  onNewTerminal,
  onSelectProject,
  onAddProject,
  onRemoveProject,
  onRenameTerminal,
  onRelaunchTerminal,
  onToggleTerminalAsk,
  onOpenSurface,
  onOpenSettings,
  onOpenSwarm,
  onOpenNewWorktree,
  onRemoveWorktree,
  onOpenTopos,
  onOpenTokenSpend,
  onOpenInVsCode,
  pipeline = null,
}) => {
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  // Worktree lists start collapsed; an entry of `false` means the user expanded it
  const [collapsedWorktrees, setCollapsedWorktrees] = useState<Record<string, boolean>>({});
  const railId = useId();
  const toggleCollapse = (path: string, e?: MouseEvent) => {
    e?.stopPropagation();
    setCollapsedProjects((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const isWorktreesCollapsed = (path: string) => {
    // Default mode is collapsed
    return collapsedWorktrees[path] !== false;
  };

  const toggleWorktreesCollapse = (path: string, e?: MouseEvent) => {
    e?.stopPropagation();
    setCollapsedWorktrees((prev) => ({
      ...prev,
      [path]: prev[path] === false ? true : false,
    }));
  };

  // Removing a workspace or a worktree asks first. The trash buttons and the row menus both
  // remove through these, so the question is asked in one place.
  const removeProject = (proj: Project) => {
    if (window.confirm(`Remove workspace "${proj.name}"? Any active terminals in this workspace will be closed.`)) {
      onRemoveProject(proj.path);
    }
  };

  const removeWorktree = async (repoPath: string, wt: GitWorktree) => {
    if (!onRemoveWorktree) return;
    if (!window.confirm(`Remove worktree "${worktreeRowName(wt)}"? Any active terminals in this worktree will be closed.`)) return;
    try {
      await onRemoveWorktree(repoPath, wt.path);
    } catch (err) {
      console.error(err);
    }
  };

  // One menu at a time, for a project row or a worktree row. Opening it never changes the active
  // project; an item that acts on the active project selects the row's project first.
  const rowMenu = useContextMenu<RowMenuTarget>({ keyOf: (t) => `${t.kind} ${t.path}` });
  const selectThen = (path: string, run?: () => void) =>
    run &&
    (() => {
      onSelectProject(path);
      run();
    });

  /** A project or worktree row's `onKeyDown`: Enter and Space activate the row, Shift+F10 and the Menu key open its menu. */
  const onRowKeyDown = (e: KeyboardEvent<HTMLElement>, target: RowMenuTarget, activate: () => void) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    } else {
      rowMenu.onKeyDown(e, target);
    }
  };

  /** A terminal's row, numbered across all open terminals, with its lane when it holds a ticket. */
  const renderTerminal = (term: TerminalInfo) => (
    <Fragment key={term.id}>
      <TerminalRow
        index={terminals.findIndex((t) => t.id === term.id) + 1}
        terminal={term}
        isActive={term.id === activeTerminalId}
        onSelect={() => onSelectTerminal(term.id)}
        onClose={() => onCloseTerminal(term.id)}
        onRename={onRenameTerminal}
        onToggleAsk={onToggleTerminalAsk}
        onRelaunch={onRelaunchTerminal}
        onOpenSurface={onOpenSurface}
      />
      {pipeline && <LaneFor terminal={term} isActive={term.id === activeTerminalId} onSelect={() => onSelectTerminal(term.id)} pipeline={pipeline} />}
    </Fragment>
  );

  const renderRowMenu = () => {
    const open = rowMenu.open;
    if (!open) return null;
    if (open.target.kind === "project") {
      const path = open.target.path;
      const proj = projects.find((p) => p.path === path);
      if (!proj) return null;
      return (
        <ProjectMenu
          project={proj}
          collapsed={!!collapsedProjects[proj.path]}
          at={open.at}
          onClose={rowMenu.close}
          handlers={{
            newTerminal: () => onNewTerminal(proj.path),
            newWorktree: onOpenNewWorktree && (() => onOpenNewWorktree(proj.path)),
            swarm: selectThen(proj.path, onOpenSwarm),
            topos: selectThen(proj.path, onOpenTopos),
            settings: onOpenSettings && (() => onOpenSettings(proj)),
            toggleCollapse: () => toggleCollapse(proj.path),
            remove: () => removeProject(proj),
          }}
        />
      );
    }
    const { repoPath, path } = open.target;
    const wt = projectWorktrees?.[repoPath]?.find((w) => w.path === path);
    if (!wt) return null;
    return (
      <WorktreeMenu
        worktree={wt}
        rowName={worktreeRowName(wt)}
        at={open.at}
        onClose={rowMenu.close}
        handlers={{
          newTerminal: () => onNewTerminal(wt.path),
          remove: onRemoveWorktree && (() => void removeWorktree(repoPath, wt)),
        }}
      />
    );
  };

  // Find any terminals that match neither a registered project nor one of its worktrees
  const orphanTerminals = terminals.filter((t) => {
    // Check if terminal belongs to any project directly
    if (projects.some((p) => isSamePath(t.project_path, p.path))) return false;
    // Check if terminal belongs to any known worktree
    const allWorktrees = Object.values(projectWorktrees ?? {}).flat();
    if (allWorktrees.some((wt) => isSamePath(t.project_path, wt.path))) return false;
    // Check if terminal is located within any project directory tree (e.g. newly created Archon worktree)
    if (projects.some((p) => isSubpathOf(t.project_path, p.path))) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full min-h-0 select-none text-[#c9d1d9]">
      {/* App Branding & Quay Logo */}
      <div className="h-12 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-[#58a6ff]" />
          <span className="font-bold tracking-wide text-white text-sm">
            QUAY <span className="text-[10px] text-[#58a6ff] font-mono font-normal">Tauri</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#21262d] text-[11px] text-[#8b949e] font-mono">
          <Radio className="w-3 h-3 text-[#3fb950] animate-pulse" />
          <span>:{bridgePort || "..."}</span>
        </div>
      </div>

      {/* Unified Projects & Terminals Section */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Section Header */}
        <div className="px-3 py-2 border-b border-[#30363d] bg-[#161b22]/50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
            <span>Workspaces</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#21262d] text-[#c9d1d9] font-mono">
              {projects.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {onOpenSwarm && (
              <button
                onClick={onOpenSwarm}
                className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-[#21262d] text-[#d29922] hover:text-white rounded text-xs transition-colors"
                title="Launch Multi-Agent Swarm Preset (Ctrl+Shift+B s)"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Swarm</span>
              </button>
            )}
            <button
              onClick={() => onNewTerminal(activeProject)}
              className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-[#21262d] text-[#58a6ff] hover:text-white rounded text-xs transition-colors"
              title="New Terminal in active project (Ctrl+Shift+B n)"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Term</span>
            </button>
            <button
              onClick={onAddProject}
              className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-[#21262d] text-[#58a6ff] hover:text-white rounded text-xs transition-colors"
              title="Add Project Workspace"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Tree Container */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {projects.map((proj, projIdx) => {
            const isCollapsed = !!collapsedProjects[proj.path];
            const isProjectActive = isSamePath(proj.path, activeProject);
            const projectTerminals = terminals.filter((t) => isSamePath(t.project_path, proj.path));
            const projectWts = projectWorktrees?.[proj.path] || [];
            const secondaryWts = secondaryWorktrees(proj.path, projectWts);
            const wtCollapsed = isWorktreesCollapsed(proj.path);
            const wtListId = `${railId}-worktrees-${projIdx}`;
            // A collapsed header flags when it hides the active worktree or terminal
            const wtHidesActive = secondaryWts.some(
              (wt) =>
                isSamePath(wt.path, activeProject) ||
                terminals.some((t) => isSamePath(t.project_path, wt.path) && t.id === activeTerminalId)
            );

            return (
              <div
                key={proj.path}
                className="rounded-md overflow-hidden bg-[#161b22]/30 border border-[#30363d]/40 transition-colors"
              >
                {/* Project Header Row */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectProject(proj.path)}
                  onContextMenu={(e) => rowMenu.onContextMenu(e, { kind: "project", path: proj.path })}
                  data-pie-surface="list"
                  data-pie-row
                  data-pie-folder={proj.path}
                  onKeyDown={(e) => onRowKeyDown(e, { kind: "project", path: proj.path }, () => onSelectProject(proj.path))}
                  className={`group flex items-center justify-between px-2.5 py-1.5 text-xs rounded-t cursor-pointer transition-colors ${
                    isProjectActive
                      ? "bg-[#21262d] text-white font-medium"
                      : "text-[#c9d1d9] hover:bg-[#161b22]"
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={(e) => toggleCollapse(proj.path, e)}
                      className="p-0.5 text-[#8b949e] hover:text-white rounded transition-colors"
                      title={isCollapsed ? "Expand project" : "Collapse project"}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <FolderGit2 className="w-3.5 h-3.5 text-[#58a6ff] shrink-0" />
                    <span className="truncate font-medium" title={proj.path}>
                      {proj.name}
                    </span>
                    {unsavedPraxisProjects?.has(normalizePath(proj.path)) && <UnsavedDot />}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#30363d] text-[#8b949e] font-mono">
                      {projectTerminals.length}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewTerminal(proj.path);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#30363d] text-[#58a6ff] hover:text-white rounded transition-all"
                      title={`New Terminal in ${proj.name}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>

                    {onOpenNewWorktree && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenNewWorktree(proj.path);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#30363d] text-[#8b949e] hover:text-[#58a6ff] rounded transition-all"
                        title={`New Git Worktree for ${proj.name} (Ctrl+Shift+B w)`}
                      >
                        <GitBranch className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {onOpenSettings && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSettings(proj);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#30363d] text-[#8b949e] hover:text-[#58a6ff] rounded transition-all"
                        title={`Workspace Settings (Env Vars & Flags) for ${proj.name}`}
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {onOpenInVsCode && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInVsCode(proj.path);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#30363d] text-[#8b949e] hover:text-[#007acc] rounded transition-all"
                        title={`Open ${proj.name} in VS Code`}
                        aria-label={`Open ${proj.name} in VS Code`}
                      >
                        <VsCodeIcon className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeProject(proj);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#30363d] text-[#8b949e] hover:text-[#f85149] rounded transition-all"
                      title={`Remove workspace ${proj.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Sub-list of Terminals under this Project */}
                {!isCollapsed && (
                  <div className="ml-3 pl-2 border-l border-[#30363d]/60 space-y-1 my-1 pr-1">
                    {projectTerminals.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => onNewTerminal(proj.path)}
                        className="w-full text-left px-2 py-1.5 text-[11px] text-[#8b949e] hover:text-[#58a6ff] hover:bg-[#161b22] rounded flex items-center gap-1.5 transition-colors group"
                      >
                        <Plus className="w-3 h-3 text-[#58a6ff]" />
                        <span>Launch terminal...</span>
                      </button>
                    ) : (
                      projectTerminals.map(renderTerminal)
                    )}

                    {/* Secondary Git Worktrees under this repo */}
                    {secondaryWts.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#30363d]/40">
                        <div className="flex items-center justify-between px-1 py-1 text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">
                          <button
                            type="button"
                            onClick={(e) => toggleWorktreesCollapse(proj.path, e)}
                            aria-expanded={!wtCollapsed}
                            aria-controls={wtListId}
                            className="flex items-center gap-1 text-[#58a6ff] hover:text-white uppercase tracking-wider transition-colors"
                            title={
                              wtCollapsed && wtHidesActive
                                ? "Expand worktrees (contains the active terminal)"
                                : wtCollapsed
                                ? "Expand worktrees"
                                : "Collapse worktrees"
                            }
                          >
                            {wtCollapsed ? (
                              <ChevronRight className="w-3 h-3 text-[#8b949e]" />
                            ) : (
                              <ChevronDown className="w-3 h-3 text-[#8b949e]" />
                            )}
                            <GitBranch className="w-3 h-3" />
                            <span>Worktrees ({secondaryWts.length})</span>
                            {wtCollapsed && wtHidesActive && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-[#58a6ff]"
                                aria-label="contains the active terminal"
                              />
                            )}
                          </button>
                          {onOpenNewWorktree && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenNewWorktree(proj.path);
                              }}
                              className="p-0.5 text-[#8b949e] hover:text-[#58a6ff] rounded transition-colors"
                              title="Create worktree branch"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        {!wtCollapsed && (
                          <div id={wtListId} className="space-y-1 mt-1">
                          {secondaryWts.map((wt) => {
                            const branchName = worktreeRowName(wt);
                            const wtMenuTarget: RowMenuTarget = { kind: "worktree", repoPath: proj.path, path: wt.path };
                            const isWtActive = isSamePath(activeProject, wt.path);
                            const wtTerminals = terminals.filter((t) => isSamePath(t.project_path, wt.path));
                            const selectWorktree = () => {
                              onSelectProject(wt.path);
                              if (wtTerminals.length > 0) {
                                onSelectTerminal(wtTerminals[0].id);
                              }
                            };

                            return (
                              <div key={wt.path} className="flex flex-col">
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={selectWorktree}
                                  onContextMenu={(e) => rowMenu.onContextMenu(e, wtMenuTarget)}
                                  data-pie-surface="list"
                                  data-pie-row
                                  data-pie-folder={wt.path}
                                  onKeyDown={(e) => onRowKeyDown(e, wtMenuTarget, selectWorktree)}
                                  className={`group/wt flex items-center justify-between px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
                                    isWtActive
                                      ? "bg-[#21262d] text-[#58a6ff] font-medium border border-[#58a6ff]/30"
                                      : "text-[#c9d1d9] hover:bg-[#161b22] border border-transparent"
                                  }`}
                                  title={`${branchName} • ${wt.path}`}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    <GitBranch
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        isWtActive ? "text-[#58a6ff]" : "text-[#8b949e]"
                                      }`}
                                    />
                                    <span className="truncate text-[11px] font-mono">{branchName}</span>
                                    {unsavedPraxisProjects?.has(normalizePath(wt.path)) && <UnsavedDot />}
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    {wtTerminals.length > 0 && (
                                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#30363d] text-[#8b949e] font-mono">
                                        {wtTerminals.length}
                                      </span>
                                    )}

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onNewTerminal(wt.path);
                                      }}
                                      className="opacity-0 group-hover/wt:opacity-100 p-0.5 hover:bg-[#30363d] text-[#58a6ff] hover:text-white rounded transition-all"
                                      title={`New Terminal in ${branchName}`}
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>

                                    {onOpenInVsCode && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onOpenInVsCode(wt.path);
                                        }}
                                        className="opacity-0 group-hover/wt:opacity-100 p-0.5 hover:bg-[#30363d] text-[#8b949e] hover:text-[#007acc] rounded transition-all"
                                        title={`Open worktree ${branchName} in VS Code`}
                                        aria-label={`Open worktree ${branchName} in VS Code`}
                                      >
                                        <VsCodeIcon className="w-3 h-3" />
                                      </button>
                                    )}

                                    {onRemoveWorktree && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void removeWorktree(proj.path, wt);
                                        }}
                                        className="opacity-0 group-hover/wt:opacity-100 p-0.5 hover:bg-[#30363d] text-[#8b949e] hover:text-[#ff7b72] rounded transition-all"
                                        title={`Remove worktree ${branchName}`}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Active terminals inside this worktree */}
                                {wtTerminals.length > 0 && (
                                  <div className="ml-3 pl-2 border-l border-[#30363d]/60 space-y-1 my-1 pr-1">
                                    {wtTerminals.map(renderTerminal)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      </div>
                    )}
                    {pipeline && <PipelineSection projectPath={proj.path} pipeline={pipeline} />}
                  </div>
                )}
              </div>
            );
          })}

          {/* Any Terminals without an explicitly matching Project folder */}
          {orphanTerminals.length > 0 && (
            <div className="rounded-md overflow-hidden bg-[#161b22]/30 border border-[#30363d]/40">
              <div className="px-2.5 py-1.5 text-xs text-[#8b949e] font-semibold uppercase tracking-wider">
                Other Terminals
              </div>
              <div className="ml-3 pl-2 border-l border-[#30363d]/60 space-y-1 my-1 pr-1">
                {orphanTerminals.map(renderTerminal)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status line: spend, the chord hint and the terminal backend */}
      <div className="px-2 py-1.5 border-t border-[#30363d] bg-[#161b22] flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] text-[#8b949e] px-1 font-mono">
          {onOpenTokenSpend ? (
            <button
              type="button"
              onClick={onOpenTokenSpend}
              aria-label="Token Spend & Chimes"
              title={`All-time API-equivalent Claude spend · today (UTC) $${(
                claudeStats?.windows?.find((w) => w.key === "today")?.cost_usd ?? 0
              ).toFixed(2)} (Ctrl+Shift+B t)`}
              className="flex items-center gap-1 px-1 -mx-1 rounded hover:bg-[#21262d] hover:text-white transition-colors"
            >
              <Coins className="w-3 h-3 text-[#e3b341]" />
              <span className="text-[#e3b341] font-semibold">
                ${(claudeStats?.total_cost_usd ?? 0).toFixed(2)}
              </span>
            </button>
          ) : (
            <span />
          )}
          <span title="New terminal: Ctrl+Shift+B n · Jump to terminal: Ctrl+Shift+B 1..9">^⇧b n · ^⇧b 1..9</span>
          <span className="flex items-center gap-1" title="Windows ConPTY backend">
            <Activity className="w-3 h-3 text-[#3fb950]" />
            <span>ConPTY</span>
          </span>
        </div>
      </div>
      {renderRowMenu()}
    </div>
  );
};

/** The lane under a terminal row, when the terminal holds a ticket. */
const LaneFor = ({
  terminal,
  isActive,
  onSelect,
  pipeline,
}: {
  terminal: TerminalInfo;
  isActive: boolean;
  onSelect: () => void;
  pipeline: ProjectsPipeline;
}) => {
  const lane = pipeline.laneOf(terminal);
  return lane ? <LaneView terminal={terminal} lane={lane} isActive={isActive} onSelect={onSelect} pipeline={pipeline} /> : null;
};
