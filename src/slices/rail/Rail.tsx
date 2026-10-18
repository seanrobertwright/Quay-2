import { useState, useId, MouseEvent, ReactNode } from "react";
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
  GitFork,
  Cpu,
} from "lucide-react";
import { GithubIcon } from "../github/GithubIcon";
import { ClaudeTokenStats } from "../sessions/types";

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
  const knownPaths = new Set(projects.map((p) => p.path));
  Object.values(projectWorktrees ?? {}).forEach((wts) => wts.forEach((wt) => knownPaths.add(wt.path)));
  const orphanTerminals = terminals.filter((t) => !knownPaths.has(t.project_path));

  // Tool launchers rendered as one icon row so the project tree keeps the vertical space
  const toolButtons: {
    id: string;
    label: string;
    shortcut?: string;
    icon: ReactNode;
    onClick: () => void;
    accent?: boolean;
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
      icon: <GitFork className="w-4 h-4 text-[#58a6ff]" />,
      onClick: onOpenArchonGraph,
    });
  }
  if (onOpenFactoryStation) {
    toolButtons.push({
      id: "machina",
      label: "Machina Praxis",
      shortcut: "^b f",
      icon: <Cpu className="w-4 h-4 text-[#58a6ff]" />,
      onClick: onOpenFactoryStation,
      accent: true,
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
    label: "A2A Orchestration Bus",
    icon: <Network className="w-4 h-4 text-[#c9d1d9]" />,
    onClick: onOpenA2APanel,
  });

  return (
    <aside className="w-72 bg-[#0d1117] border-r border-[#30363d] flex flex-col h-full select-none text-[#c9d1d9]">
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
            const isProjectActive = proj.path === activeProject;
            const projectTerminals = terminals.filter((t) => t.project_path === proj.path);
            const projectWts = projectWorktrees?.[proj.path] || [];
            const secondaryWorktrees = projectWts.filter((wt) => !wt.is_main);
            const wtCollapsed = isWorktreesCollapsed(proj.path);
            const wtListId = `${railId}-worktrees-${projIdx}`;
            // A collapsed header flags when it hides the active worktree or terminal
            const wtHidesActive = secondaryWorktrees.some(
              (wt) =>
                wt.path === activeProject ||
                terminals.some((t) => t.project_path === wt.path && t.id === activeTerminalId)
            );

            return (
              <div
                key={proj.path}
                className="rounded-md overflow-hidden bg-[#161b22]/30 border border-[#30363d]/40 transition-colors"
              >
                {/* Project Header Row */}
                <div
                  onClick={() => onSelectProject(proj.path)}
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
                            const isWtActive = activeProject === wt.path;
                            const wtTerminals = terminals.filter((t) => t.project_path === wt.path);

                            return (
                              <div key={wt.path} className="flex flex-col">
                                <div
                                  onClick={() => {
                                    onSelectProject(wt.path);
                                    if (wtTerminals.length > 0) {
                                      onSelectTerminal(wtTerminals[0].id);
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
          {toolButtons.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={tool.onClick}
              aria-label={tool.label}
              title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
              className={`p-1.5 rounded-md transition-colors hover:bg-[#21262d] ${
                tool.accent ? "ring-1 ring-[#58a6ff]/40 bg-[#0d1117]" : ""
              }`}
            >
              {tool.icon}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between text-[10px] text-[#8b949e] px-1 font-mono">
          {onOpenTokenSpend ? (
            <button
              type="button"
              onClick={onOpenTokenSpend}
              aria-label="Token Spend & Chimes"
              title="Token Spend & Audio Turn Chime Settings (^b t)"
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
