import { useState, useEffect, useId, MouseEvent, KeyboardEvent, ReactNode } from "react";
import { TerminalInfo } from "../terminal/types";
import { Project } from "../workspace/types";
import { GitWorktree } from "../git/types";
import { TerminalRow } from "./TerminalRow";
import {
  FolderGit2,
  Plus,
  Radio,
  Network,
  Activity,
  Layers,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Trash2,
  Settings,
  Zap,
  Command,
  GitBranch,
  History,
  ShieldCheck,
  Coins,
} from "lucide-react";
import { GithubIcon } from "../github/GithubIcon";
import { ArchonIcon } from "../archon/ArchonIcon";
import { PraxisIcon } from "../praxis-builder/PraxisIcon";
import { ClaudeTokenStats } from "../sessions/types";
import { isSamePath, isSubpathOf } from "../../utils/paths";

// The rail was a fixed 288px (`w-72`); the drag range is measured from that width
const RAIL_BASE_WIDTH = 288;
const RAIL_MIN_WIDTH = RAIL_BASE_WIDTH + 50;
const RAIL_MAX_WIDTH = RAIL_BASE_WIDTH + 300;
const RAIL_KEYBOARD_STEP = 16;
const RAIL_WIDTH_KEY = "quay_rail_width";

const clampRailWidth = (width: number) =>
  Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, Math.round(width)));

// Falls back to the minimum width when storage is unavailable or holds anything but digits
function loadRailWidth(): number {
  try {
    const saved = localStorage.getItem(RAIL_WIDTH_KEY);
    return saved && /^\d+$/.test(saved) ? clampRailWidth(Number(saved)) : RAIL_MIN_WIDTH;
  } catch {
    return RAIL_MIN_WIDTH;
  }
}

interface RailProps {
  projects: Project[];
  activeProject: string;
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
  onOpenA2APanel: () => void;
  onOpenSettings?: (project: Project) => void;
  onOpenSwarm?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenNewWorktree?: (repoPath: string) => void;
  onRemoveWorktree?: (repoPath: string, wtPath: string) => void;
  onOpenGithubDrawer?: () => void;
  onOpenPrePrAudit?: () => void;
  onOpenSessionHistory?: () => void;
  onOpenTokenSpend?: () => void;
  onOpenArchonGraph?: () => void;
  onOpenFactoryStation?: () => void;
  onRelaunchTerminal?: (id: string) => void;
}

export const Rail: React.FC<RailProps> = ({
  projects,
  activeProject,
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
  onOpenA2APanel,
  onOpenSettings,
  onOpenSwarm,
  onOpenCommandPalette,
  onOpenNewWorktree,
  onRemoveWorktree,
  onOpenGithubDrawer,
  onOpenPrePrAudit,
  onOpenSessionHistory,
  onOpenTokenSpend,
  onOpenArchonGraph,
  onOpenFactoryStation,
}) => {
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  // Worktree lists start collapsed; an entry of `false` means the user expanded it
  const [collapsedWorktrees, setCollapsedWorktrees] = useState<Record<string, boolean>>({});
  const railId = useId();
  const [railWidth, setRailWidth] = useState<number>(loadRailWidth);
  const [isResizing, setIsResizing] = useState(false);

  // Persist once a drag ends rather than on every mouse move
  useEffect(() => {
    if (isResizing) return;
    try {
      localStorage.setItem(RAIL_WIDTH_KEY, String(railWidth));
    } catch {
      // Storage can be unavailable; the width still applies for this session
    }
  }, [railWidth, isResizing]);

  // Draggable rail edge mouse down handler
  const handleResizeMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = railWidth;
    setIsResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      setRailWidth(clampRailWidth(startWidth + moveEvent.clientX - startX));
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleResizeKeyDown = (e: KeyboardEvent) => {
    const next =
      e.key === "ArrowLeft"
        ? railWidth - RAIL_KEYBOARD_STEP
        : e.key === "ArrowRight"
        ? railWidth + RAIL_KEYBOARD_STEP
        : e.key === "Home"
        ? RAIL_MIN_WIDTH
        : e.key === "End"
        ? RAIL_MAX_WIDTH
        : null;
    if (next === null) return;
    e.preventDefault();
    setRailWidth(clampRailWidth(next));
  };

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

  // Tool launchers rendered as one icon row so the project tree keeps the vertical space
  const toolButtons: {
    id: string;
    label: string;
    shortcut?: string;
    icon: ReactNode;
    onClick: () => void;
  }[] = [];
  if (onOpenGithubDrawer) {
    toolButtons.push({
      id: "github",
      label: "GitHub Issues & PRs",
      shortcut: "^b i",
      icon: <GithubIcon className="w-4 h-4 text-white" />,
      onClick: onOpenGithubDrawer,
    });
  }
  if (onOpenSessionHistory) {
    toolButtons.push({
      id: "sessions",
      label: "Session History",
      shortcut: "^b h",
      icon: <History className="w-4 h-4 text-[#58a6ff]" />,
      onClick: onOpenSessionHistory,
    });
  }
  if (onOpenPrePrAudit) {
    toolButtons.push({
      id: "audit",
      label: "Pre-PR Audit Gate",
      shortcut: "^b a",
      icon: <ShieldCheck className="w-4 h-4 text-[#f85149]" />,
      onClick: onOpenPrePrAudit,
    });
  }
  if (onOpenArchonGraph) {
    toolButtons.push({
      id: "archon",
      label: "Archon & SDD Graph",
      shortcut: "^b r",
      icon: <ArchonIcon className="w-4 h-4" />,
      onClick: onOpenArchonGraph,
    });
  }
  if (onOpenFactoryStation) {
    toolButtons.push({
      id: "machina",
      label: "Machina",
      shortcut: "^b f",
      icon: <PraxisIcon className="w-4 h-4" />,
      onClick: onOpenFactoryStation,
    });
  }
  if (onOpenCommandPalette) {
    toolButtons.push({
      id: "palette",
      label: "Command Palette",
      shortcut: "Ctrl+K",
      icon: <Command className="w-4 h-4 text-[#58a6ff]" />,
      onClick: onOpenCommandPalette,
    });
  }
  toolButtons.push({
    id: "a2a",
    label: "Mission Control",
    shortcut: "^b m",
    icon: <Network className="w-4 h-4 text-[#c9d1d9]" />,
    onClick: onOpenA2APanel,
  });

  return (
    <aside
      id={`${railId}-panel`}
      style={{ width: railWidth }}
      className="relative shrink-0 bg-[#0d1117] border-r border-[#30363d] flex flex-col h-full select-none text-[#c9d1d9]"
    >
      {/* Draggable rail edge: drag, arrow keys, or Home/End resize; double click resets */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA 1.2 focusable window splitter (separator with aria-valuenow) */}
      <div role="separator" tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-controls={`${railId}-panel`}
        aria-valuenow={railWidth}
        aria-valuemin={RAIL_MIN_WIDTH}
        aria-valuemax={RAIL_MAX_WIDTH}
        onMouseDown={handleResizeMouseDown}
        onDoubleClick={() => setRailWidth(RAIL_MIN_WIDTH)}
        onKeyDown={handleResizeKeyDown}
        className={`group absolute top-0 bottom-0 -right-[5px] w-[10px] z-30 cursor-col-resize flex justify-center outline-none transition-colors ${
          isResizing ? "bg-[#58a6ff]/20" : "hover:bg-[#58a6ff]/10"
        }`}
        title="Drag to resize sidebar (Double click to reset)"
      >
        <div
          className={`w-[2px] h-full transition-colors ${
            isResizing
              ? "bg-[#58a6ff]"
              : "bg-transparent group-hover:bg-[#58a6ff] group-focus-visible:bg-[#58a6ff]"
          }`}
        />
      </div>

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
                title="Launch Multi-Agent Swarm Preset (^b s)"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Swarm</span>
              </button>
            )}
            <button
              onClick={() => onNewTerminal(activeProject)}
              className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-[#21262d] text-[#58a6ff] hover:text-white rounded text-xs transition-colors"
              title="New Terminal in active project (^b n)"
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
            const secondaryWorktrees = projectWts.filter((wt) => !wt.is_main);
            const wtCollapsed = isWorktreesCollapsed(proj.path);
            const wtListId = `${railId}-worktrees-${projIdx}`;
            // A collapsed header flags when it hides the active worktree or terminal
            const wtHidesActive = secondaryWorktrees.some(
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
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelectProject(proj.path);
                    }
                  }}
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
                        title={`New Git Worktree for ${proj.name} (^b w)`}
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

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `Remove workspace "${proj.name}"? Any active terminals in this workspace will be closed.`
                          )
                        ) {
                          onRemoveProject(proj.path);
                        }
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
                      projectTerminals.map((term) => {
                        // Global sequential index across all open terminals
                        const globalIndex = terminals.findIndex((t) => t.id === term.id) + 1;
                        return (
                          <TerminalRow
                            key={term.id}
                            index={globalIndex}
                            terminal={term}
                            isActive={term.id === activeTerminalId}
                            onSelect={() => {
                              onSelectTerminal(term.id);
                            }}
                            onClose={(e: MouseEvent<HTMLButtonElement>) => {
                              e.stopPropagation();
                              onCloseTerminal(term.id);
                            }}
                            onRename={onRenameTerminal}
                            onRelaunch={onRelaunchTerminal}
                          />
                        );
                      })
                    )}

                    {/* Secondary Git Worktrees under this repo */}
                    {secondaryWorktrees.length > 0 && (
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
                            <span>Worktrees ({secondaryWorktrees.length})</span>
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
                          {secondaryWorktrees.map((wt) => {
                            const branchName = wt.branch
                              ? wt.branch.replace("refs/heads/", "")
                              : wt.head.slice(0, 7);
                            const isWtActive = isSamePath(activeProject, wt.path);
                            const wtTerminals = terminals.filter((t) => isSamePath(t.project_path, wt.path));

                            return (
                              <div key={wt.path} className="flex flex-col">
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    onSelectProject(wt.path);
                                    if (wtTerminals.length > 0) {
                                      onSelectTerminal(wtTerminals[0].id);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                                      e.preventDefault();
                                      onSelectProject(wt.path);
                                      if (wtTerminals.length > 0) {
                                        onSelectTerminal(wtTerminals[0].id);
                                      }
                                    }
                                  }}
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

                                    {onRemoveWorktree && (
                                      <button
                                        type="button"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          if (
                                            window.confirm(
                                              `Remove worktree "${branchName}"? Any active terminals in this worktree will be closed.`
                                            )
                                          ) {
                                            try {
                                              await onRemoveWorktree(proj.path, wt.path);
                                            } catch (err: any) {
                                              console.error(err);
                                            }
                                          }
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
                                    {wtTerminals.map((term) => {
                                      const globalIndex = terminals.findIndex((t) => t.id === term.id) + 1;
                                      return (
                                        <TerminalRow
                                          key={term.id}
                                          index={globalIndex}
                                          terminal={term}
                                          isActive={term.id === activeTerminalId}
                                          onSelect={() => {
                                            onSelectTerminal(term.id);
                                          }}
                                          onClose={(e: MouseEvent<HTMLButtonElement>) => {
                                            e.stopPropagation();
                                            onCloseTerminal(term.id);
                                          }}
                                          onRename={onRenameTerminal}
                                          onRelaunch={onRelaunchTerminal}
                                        />
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      </div>
                    )}
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
                {orphanTerminals.map((term) => {
                  const globalIndex = terminals.findIndex((t) => t.id === term.id) + 1;
                  return (
                    <TerminalRow
                      key={term.id}
                      index={globalIndex}
                      terminal={term}
                      isActive={term.id === activeTerminalId}
                      onSelect={() => onSelectTerminal(term.id)}
                      onClose={(e: MouseEvent<HTMLButtonElement>) => {
                        e.stopPropagation();
                        onCloseTerminal(term.id);
                      }}
                      onRename={onRenameTerminal}
                      onRelaunch={onRelaunchTerminal}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Mission Control: one compact icon toolbar + status line */}
      <div className="px-2 py-1.5 border-t border-[#30363d] bg-[#161b22] flex flex-col gap-1">
        <div role="toolbar" aria-label="Quay tools" className="flex items-center justify-between">
          {toolButtons.map((tool, toolIdx) => {
            const shortcutId = `${railId}-tool-${tool.id}-shortcut`;
            // Styled tooltip instead of `title`, which WebView2 does not always show;
            // it opens toward the rail's middle so the window edge never clips it
            const opensRight = toolIdx < toolButtons.length / 2;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={tool.onClick}
                aria-label={tool.label}
                aria-describedby={tool.shortcut ? shortcutId : undefined}
                className="group/tool relative p-1.5 rounded-md transition-colors hover:bg-[#21262d]"
              >
                {tool.icon}
                <span
                  className={`pointer-events-none absolute bottom-full mb-1.5 z-50 whitespace-nowrap rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[11px] text-[#c9d1d9] shadow-lg opacity-0 transition-opacity group-hover/tool:opacity-100 group-hover/tool:delay-150 group-focus-visible/tool:opacity-100 ${
                    opensRight ? "left-0" : "right-0"
                  }`}
                >
                  {tool.label}
                  {tool.shortcut && (
                    <span id={shortcutId} className="ml-1.5 font-mono text-[#8b949e]">
                      {tool.shortcut}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[10px] text-[#8b949e] px-1 font-mono">
          {onOpenTokenSpend ? (
            <button
              type="button"
              onClick={onOpenTokenSpend}
              aria-label="Token Spend & Chimes"
              title={`All-time API-equivalent Claude spend · today (UTC) $${(
                claudeStats?.windows?.find((w) => w.key === "today")?.cost_usd ?? 0
              ).toFixed(2)} (^b t)`}
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
          <span title="New terminal: ^b n · Jump to terminal: ^b 1..9">^b n · ^b 1..9</span>
          <span className="flex items-center gap-1" title="Windows ConPTY backend">
            <Activity className="w-3 h-3 text-[#3fb950]" />
            <span>ConPTY</span>
          </span>
        </div>
      </div>
    </aside>
  );
};
