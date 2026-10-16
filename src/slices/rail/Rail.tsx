import { useState, MouseEvent } from "react";
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

  const toggleCollapse = (path: string, e?: MouseEvent) => {
    e?.stopPropagation();
    setCollapsedProjects((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  // Find any terminals that might not match any registered project
  const knownPaths = new Set(projects.map((p) => p.path));
  const orphanTerminals = terminals.filter((t) => !knownPaths.has(t.project_path));

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
          {projects.map((proj) => {
            const isCollapsed = !!collapsedProjects[proj.path];
            const isProjectActive = proj.path === activeProject;
            const projectTerminals = terminals.filter((t) => t.project_path === proj.path);
            const projectWts = projectWorktrees?.[proj.path] || [];
            const secondaryWorktrees = projectWts.filter((wt) => !wt.is_main);

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
                          <span className="flex items-center gap-1 text-[#58a6ff]">
                            <GitBranch className="w-3 h-3" />
                            <span>Worktrees ({secondaryWorktrees.length})</span>
                          </span>
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

                        <div className="space-y-1 mt-1">
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

      {/* Bottom Mission Control / A2A Router Bar */}
      <div className="p-3 border-t border-[#30363d] bg-[#161b22] flex flex-col gap-2">
        {onOpenGithubDrawer && (
          <button
            onClick={onOpenGithubDrawer}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white rounded-md text-xs font-medium transition-colors border border-[#30363d]"
            title="Open GitHub Issues & Pull Requests (^b i)"
          >
            <div className="flex items-center gap-2">
              <GithubIcon className="w-3.5 h-3.5 text-white" />
              <span>GitHub Issues & PRs</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-[#161b22] text-[10px] font-mono text-[#8b949e] border border-[#30363d]">
              Ctrl+B i
            </kbd>
          </button>
        )}

        {onOpenSessionHistory && (
          <button
            onClick={onOpenSessionHistory}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white rounded-md text-xs font-medium transition-colors border border-[#30363d]"
            title="Browse & Auto-Resume Past Claude Sessions (^b h)"
          >
            <div className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>Session History</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-[#161b22] text-[10px] font-mono text-[#8b949e] border border-[#30363d]">
              Ctrl+B h
            </kbd>
          </button>
        )}

        {onOpenPrePrAudit && (
          <button
            onClick={onOpenPrePrAudit}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white rounded-md text-xs font-medium transition-colors border border-[#30363d]"
            title="Pre-PR Leak & Secret Audit Gate (^b a)"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-[#f85149]" />
              <span>Pre-PR Audit Gate</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-[#161b22] text-[10px] font-mono text-[#8b949e] border border-[#30363d]">
              Ctrl+B a
            </kbd>
          </button>
        )}

        {onOpenArchonGraph && (
          <button
            onClick={onOpenArchonGraph}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white rounded-md text-xs font-medium transition-colors border border-[#30363d]"
            title="Archon Workflow DAG & SDD Spec Inspector (Ctrl+B R)"
          >
            <div className="flex items-center gap-2">
              <GitFork className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>Archon & SDD Graph</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-[#161b22] text-[10px] font-mono text-[#8b949e] border border-[#30363d]">
              Ctrl+B r
            </kbd>
          </button>
        )}

        {onOpenFactoryStation && (
          <button
            onClick={onOpenFactoryStation}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#0d1117] hover:bg-[#21262d] text-[#c9d1d9] hover:text-white rounded-md text-xs font-medium transition-colors border border-[#58a6ff]/40"
            title="Machina Praxis AI Software Factory Cockpit (Ctrl+B F)"
          >
            <div className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span className="font-semibold text-white">Machina Praxis</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-[#161b22] text-[10px] font-mono text-[#58a6ff] border border-[#30363d]">
              Ctrl+B f
            </kbd>
          </button>
        )}

        {onOpenTokenSpend && (
          <button
            onClick={onOpenTokenSpend}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white rounded-md text-xs font-medium transition-colors border border-[#30363d]"
            title="Token Spend & Audio Turn Chime Settings (^b t)"
          >
            <div className="flex items-center gap-2">
              <Coins className="w-3.5 h-3.5 text-[#e3b341]" />
              <span>Token Spend & Chimes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-[#e3b341] font-semibold">
                ${(claudeStats?.total_cost_usd ?? 0).toFixed(2)}
              </span>
              <kbd className="px-1.5 py-0.5 rounded bg-[#161b22] text-[10px] font-mono text-[#8b949e] border border-[#30363d]">
                ^b t
              </kbd>
            </div>
          </button>
        )}

        {onOpenCommandPalette && (
          <button
            onClick={onOpenCommandPalette}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white rounded-md text-xs font-medium transition-colors border border-[#30363d]"
            title="Open Global Command Palette (Ctrl+K)"
          >
            <div className="flex items-center gap-2">
              <Command className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>Command Palette</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-[#161b22] text-[10px] font-mono text-[#8b949e] border border-[#30363d]">
              Ctrl+K
            </kbd>
          </button>
        )}

        <button
          onClick={onOpenA2APanel}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-white rounded-md text-xs font-medium transition-colors border border-[#30363d]"
        >
          <Network className="w-3.5 h-3.5 text-[#58a6ff]" />
          <span>A2A Orchestration Bus</span>
        </button>

        <div className="flex items-center justify-between text-[10px] text-[#8b949e] px-1 font-mono">
          <span>Shortcuts: ^b n / ^b 1..9</span>
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-[#3fb950]" />
            <span>ConPTY</span>
          </span>
        </div>
      </div>
    </aside>
  );
};
