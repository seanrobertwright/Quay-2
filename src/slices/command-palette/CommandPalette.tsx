import React, { useState, useEffect, useRef, useMemo } from "react";
import { TerminalInfo, StageLayout, RunKind } from "../terminal/types";
import { Project } from "../workspace/types";
import { GitWorktree } from "../git/types";
import { SwarmPreset, BUILTIN_SWARM_PRESETS } from "../orchestrator/swarmTypes";
import {
  AgentIcon,
  ClaudeIcon,
  AntigravityIcon,
  CodexIcon,
  PiIcon,
  GeminiIcon,
  GrokIcon,
  AiderIcon,
  KiroIcon,
  CopilotIcon,
  OpenCodeIcon,
  PigIcon,
  PowerShellIcon,
} from "../terminal/AgentIcons";
import {
  Search,
  FolderGit2,
  Columns2,
  Rows2,
  LayoutGrid,
  Square,
  Maximize2,
  RotateCcw,
  Zap,
  ListOrdered,
  Network,
  Settings,
  GitCompare,
  Plus,
  ShieldCheck,
  GitBranch,
  History,
  Coins,
  ShieldAlert,
  Cpu,
  ArrowUpCircle,
  Workflow,
  X,
} from "lucide-react";
import { useOverlay } from "../overlay/useOverlay";
import { GithubIcon } from "../github/GithubIcon";
import { ArchonIcon } from "../archon/ArchonIcon";
import { APP_CURRENT_VERSION } from "../updater/updaterService";
import { isSamePath } from "../../utils/paths";

export interface CommandItem {
  id: string;
  category: "Terminals" | "Workspaces" | "Layouts" | "Swarms" | "Tools & Actions";
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  shortcut?: string;
  badge?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  activeProject: string;
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
  onSelectProject: (path: string) => void;
  onSelectTerminal: (id: string, projectPath?: string) => void;
  onSetLayout: (layout: StageLayout) => void;
  onToggleZoom: () => void;
  onFocusNextPane: () => void;
  onNewTerminal: (runKind?: RunKind) => void;
  onOpenWorkspaceSettings: () => void;
  onOpenSwarmModal: () => void;
  onLaunchSwarmPreset: (preset: SwarmPreset) => void;
  savedSwarms: SwarmPreset[];
  onOpenActionLog: () => void;
  onOpenA2A: () => void;
  onOpenDiffInspector: () => void;
  onToggleLiveMode?: () => void;
  onAddProject: () => void;
  projectWorktrees?: Record<string, GitWorktree[]>;
  onOpenNewWorktree?: () => void;
  onOpenGithubDrawer?: () => void;
  onOpenPrePrAudit?: () => void;
  onOpenSessionHistory?: () => void;
  onOpenTokenSpend?: () => void;
  onOpenArchonGraph?: () => void;
  onOpenFactoryStation?: () => void;
  onOpenPraxisBuilder?: () => void;
  onCheckForUpdates?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  projects,
  activeProject,
  terminals,
  activeTerminalId,
  projectWorktrees,
  onSelectProject,
  onSelectTerminal,
  onSetLayout,
  onToggleZoom,
  onFocusNextPane,
  onNewTerminal,
  onOpenWorkspaceSettings,
  onOpenSwarmModal,
  onLaunchSwarmPreset,
  savedSwarms,
  onOpenActionLog,
  onOpenA2A,
  onOpenDiffInspector,
  onOpenNewWorktree,
  onOpenGithubDrawer,
  onOpenPrePrAudit,
  onOpenSessionHistory,
  onOpenTokenSpend,
  onOpenArchonGraph,
  onOpenFactoryStation,
  onOpenPraxisBuilder,
  onCheckForUpdates,
  onToggleLiveMode,
  onAddProject,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Start each opening fresh; useOverlay puts focus in the input
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const { backdropProps, panelProps } = useOverlay({ isOpen, onClose, initialFocusRef: inputRef });

  // Build command items
  const allCommands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // 1. Layouts
    items.push(
      {
        id: "layout-single",
        category: "Layouts",
        title: "Single Pane Layout",
        subtitle: "Maximize active terminal",
        icon: <Square className="w-4 h-4 text-[#8b949e]" />,
        shortcut: "Ctrl+Shift+B x",
        action: () => onSetLayout("single"),
      },
      {
        id: "layout-split-h",
        category: "Layouts",
        title: "Side-by-Side Split",
        subtitle: "Two vertical panes side by side",
        icon: <Columns2 className="w-4 h-4 text-[#58a6ff]" />,
        shortcut: "Ctrl+Shift+B %",
        action: () => onSetLayout("split-horizontal"),
      },
      {
        id: "layout-split-v",
        category: "Layouts",
        title: "Stacked Split",
        subtitle: "Two horizontal panes stacked",
        icon: <Rows2 className="w-4 h-4 text-[#58a6ff]" />,
        shortcut: 'Ctrl+Shift+B "',
        action: () => onSetLayout("split-vertical"),
      },
      {
        id: "layout-grid",
        category: "Layouts",
        title: "2x2 Quad Grid Layout",
        subtitle: "Four terminal panes arranged in a grid",
        icon: <LayoutGrid className="w-4 h-4 text-[#bc8cff]" />,
        shortcut: "Ctrl+Shift+B g",
        action: () => onSetLayout("grid"),
      },
      {
        id: "layout-zoom",
        category: "Layouts",
        title: "Toggle Zoom Active Pane",
        subtitle: "Expand current pane to full screen and back",
        icon: <Maximize2 className="w-4 h-4 text-[#d29922]" />,
        shortcut: "Ctrl+Shift+B z",
        action: () => onToggleZoom(),
      },
      {
        id: "layout-cycle",
        category: "Layouts",
        title: "Cycle Next Pane Focus",
        subtitle: "Shift focus to next terminal pane",
        icon: <RotateCcw className="w-4 h-4 text-[#8b949e]" />,
        shortcut: "Ctrl+Shift+B o",
        action: () => onFocusNextPane(),
      }
    );

    // 2. Tools & Actions
    items.push(
      {
        id: "action-new-claude",
        category: "Tools & Actions",
        title: "New Claude Code Agent",
        subtitle: "Launch a new Claude Code AI session",
        icon: <ClaudeIcon className="w-4 h-4 text-[#f0883e]" />,
        shortcut: "Ctrl+Shift+B n",
        action: () => onNewTerminal("claude"),
      },
      {
        id: "action-new-antigravity",
        category: "Tools & Actions",
        title: "New Antigravity CLI Agent",
        subtitle: "Launch Google Gemini / Antigravity CLI session",
        icon: <AntigravityIcon className="w-4 h-4 text-[#38bdf8]" />,
        action: () => onNewTerminal("antigravity"),
      },
      {
        id: "action-new-codex",
        category: "Tools & Actions",
        title: "New OpenAI Codex Agent",
        subtitle: "Launch OpenAI Codex CLI session",
        icon: <CodexIcon className="w-4 h-4 text-[#10a37f]" />,
        action: () => onNewTerminal("codex"),
      },
      {
        id: "action-new-pi",
        category: "Tools & Actions",
        title: "New Pi Coding Agent",
        subtitle: "Launch Pi multi-provider coding agent session",
        icon: <PiIcon className="w-4 h-4 text-[#c084fc]" />,
        action: () => onNewTerminal("pi"),
      },
      {
        id: "action-new-gemini",
        category: "Tools & Actions",
        title: "New Google Gemini CLI Agent",
        subtitle: "Launch Google Gemini CLI session",
        icon: <GeminiIcon className="w-4 h-4 text-[#60a5fa]" />,
        action: () => onNewTerminal("gemini"),
      },
      {
        id: "action-new-grok",
        category: "Tools & Actions",
        title: "New xAI Grok CLI Agent",
        subtitle: "Launch xAI Grok CLI session",
        icon: <GrokIcon className="w-4 h-4 text-[#f1f5f9]" />,
        action: () => onNewTerminal("grok"),
      },
      {
        id: "action-new-aider",
        category: "Tools & Actions",
        title: "New Aider Pair Programmer",
        subtitle: "Launch Aider terminal pair programmer",
        icon: <AiderIcon className="w-4 h-4 text-[#34d399]" />,
        action: () => onNewTerminal("aider"),
      },
      {
        id: "action-new-kiro",
        category: "Tools & Actions",
        title: "New Kiro CLI Agent",
        subtitle: "Launch Kiro CLI multi-model session",
        icon: <KiroIcon className="w-4 h-4 text-[#a855f7]" />,
        action: () => onNewTerminal("kiro"),
      },
      {
        id: "action-new-copilot",
        category: "Tools & Actions",
        title: "New GitHub Copilot Agent",
        subtitle: "Launch GitHub Copilot CLI session",
        icon: <CopilotIcon className="w-4 h-4 text-[#38bdf8]" />,
        action: () => onNewTerminal("copilot"),
      },
      {
        id: "action-new-opencode",
        category: "Tools & Actions",
        title: "New OpenCode CLI Agent",
        subtitle: "Launch OpenCode multi-provider terminal agent",
        icon: <OpenCodeIcon className="w-4 h-4 text-[#f97316]" />,
        action: () => onNewTerminal("opencode"),
      },
      {
        id: "action-new-pig",
        category: "Tools & Actions",
        title: "New PiG (Pi in Go) Agent",
        subtitle: "Launch a PiG (Pi in Go) coding agent session",
        icon: <PigIcon className="w-4 h-4 text-[#00ADD8]" />,
        action: () => onNewTerminal("pig"),
      },
      {
        id: "action-new-shell",
        category: "Tools & Actions",
        title: "New PowerShell Terminal",
        subtitle: "Launch a clean ConPTY PowerShell terminal",
        icon: <PowerShellIcon className="w-4 h-4 text-[#58a6ff]" />,
        action: () => onNewTerminal("powershell"),
      },
      {
        id: "action-swarm-modal",
        category: "Tools & Actions",
        title: "Open Swarm Preset Launcher...",
        subtitle: "Multi-agent team orchestrator",
        icon: <Zap className="w-4 h-4 text-[#d29922]" />,
        action: () => onOpenSwarmModal(),
      },
      {
        id: "action-diff-inspector",
        category: "Tools & Actions",
        title: "Visual Diff & File Changes",
        subtitle: "Inspect code edits and writes from Claude tools",
        icon: <GitCompare className="w-4 h-4 text-[#3fb950]" />,
        action: () => onOpenDiffInspector(),
      },
      {
        id: "action-action-log",
        category: "Tools & Actions",
        title: "Action Log Drawer",
        subtitle: "Telemetry stream and tool execution history",
        icon: <ListOrdered className="w-4 h-4 text-[#58a6ff]" />,
        action: () => onOpenActionLog(),
      },
      {
        id: "action-a2a-bus",
        category: "Tools & Actions",
        title: "Mission Control",
        subtitle: "Send messages to agents and read the A2A bus's message trail",
        icon: <Network className="w-4 h-4 text-[#bc8cff]" />,
        shortcut: "Ctrl+Shift+B m",
        action: () => onOpenA2A(),
      },
      {
        id: "action-workspace-settings",
        category: "Tools & Actions",
        title: "Workspace Settings (Env Vars & Flags)",
        subtitle: "Configure default launch flags and environment variables",
        icon: <Settings className="w-4 h-4 text-[#8b949e]" />,
        action: () => onOpenWorkspaceSettings(),
      },
      {
        id: "action-add-workspace",
        category: "Tools & Actions",
        title: "Add Project Workspace...",
        subtitle: "Register an existing local directory into Quay",
        icon: <Plus className="w-4 h-4 text-[#3fb950]" />,
        action: () => onAddProject(),
      }
    );

    if (onOpenNewWorktree) {
      items.push({
        id: "action-new-worktree",
        category: "Tools & Actions",
        title: "New Git Worktree...",
        subtitle: "Create isolated working tree branch and launch Claude Code",
        icon: <GitBranch className="w-4 h-4 text-[#58a6ff]" />,
        shortcut: "Ctrl+Shift+B w",
        action: () => onOpenNewWorktree(),
      });
    }

    if (onOpenGithubDrawer) {
      items.push({
        id: "action-github-companion",
        category: "Tools & Actions",
        title: "GitHub Issues & Pull Requests",
        subtitle: "Browse issues, label filters, PR status checks, and 1-click agent dispatch",
        icon: <GithubIcon className="w-4 h-4 text-white" />,
        shortcut: "Ctrl+Shift+B i",
        action: () => onOpenGithubDrawer(),
      });
    }

    if (onOpenPrePrAudit) {
      items.push({
        id: "action-pre-pr-audit",
        category: "Tools & Actions",
        title: "Pre-PR Audit Gate...",
        subtitle: "Scan git diff & untracked files for secrets, paths, and claim leaks",
        icon: <ShieldAlert className="w-4 h-4 text-[#f85149]" />,
        shortcut: "Ctrl+Shift+B a",
        action: () => onOpenPrePrAudit(),
      });
    }

    if (onOpenSessionHistory) {
      items.push({
        id: "action-session-history",
        category: "Tools & Actions",
        title: "Session History & Auto-Resume...",
        subtitle: "Browse past Claude sessions and resume with context restored",
        icon: <History className="w-4 h-4 text-[#58a6ff]" />,
        shortcut: "Ctrl+Shift+B h",
        action: () => onOpenSessionHistory(),
      });
    }

    if (onOpenTokenSpend) {
      items.push({
        id: "action-token-spend",
        category: "Tools & Actions",
        title: "Token Spend & Audio Turn Chimes...",
        subtitle: "View live token usage, cache savings, and audio notification settings",
        icon: <Coins className="w-4 h-4 text-[#e3b341]" />,
        shortcut: "Ctrl+Shift+B t",
        action: () => onOpenTokenSpend(),
      });
    }

    if (onOpenArchonGraph) {
      items.push({
        id: "action-archon-graph",
        category: "Tools & Actions",
        title: "Archon & SDD Spec Graph Inspector...",
        subtitle: "Inspect Archon workflow DAGs, SDD tasks, and ADR decision trails",
        icon: <ArchonIcon className="w-4 h-4" />,
        shortcut: "Ctrl+Shift+B r",
        action: () => onOpenArchonGraph(),
      });
    }

    if (onOpenFactoryStation) {
      items.push({
        id: "action-factory-station",
        category: "Tools & Actions",
        title: "Machina Factory Station...",
        subtitle: "AI Software Factory Cockpit: 6-Stage Pipeline DAG, Holdback Vault & Governed Holds",
        icon: <Cpu className="w-4 h-4 text-[#58a6ff]" />,
        shortcut: "Ctrl+Shift+B f",
        action: () => onOpenFactoryStation(),
      });
    }

    if (onOpenPraxisBuilder) {
      items.push({
        id: "action-praxis-builder",
        category: "Tools & Actions",
        title: "Praxis Builder...",
        subtitle: "Browse the project's Praxis graphs, contracts, grants and triggers",
        icon: <Workflow className="w-4 h-4 text-[#58a6ff]" />,
        shortcut: "Ctrl+Shift+B p",
        action: () => onOpenPraxisBuilder(),
      });
    }

    if (onToggleLiveMode) {
      items.push({
        id: "action-toggle-gatekeeper",
        category: "Tools & Actions",
        title: "Toggle Security Gatekeeper Mode",
        subtitle: "Switch between Skip (auto-approve) and Normal (approval modal)",
        icon: <ShieldCheck className="w-4 h-4 text-[#d29922]" />,
        action: () => onToggleLiveMode(),
      });
    }

    if (onCheckForUpdates) {
      items.push({
        id: "action-check-updates",
        category: "Tools & Actions",
        title: "Check for Updates...",
        subtitle: `Quay v${APP_CURRENT_VERSION} — check GitHub releases and updater`,
        icon: <ArrowUpCircle className="w-4 h-4 text-[#58a6ff]" />,
        shortcut: "Ctrl+Shift+B u",
        action: () => onCheckForUpdates(),
      });
    }

    // 3. Swarm Presets (1-Click): saved swarms first, then the built-ins
    for (const preset of [...savedSwarms, ...BUILTIN_SWARM_PRESETS]) {
      items.push({
        id: `swarm-${preset.id}`,
        category: "Swarms",
        title: `Swarm: ${preset.title}`,
        subtitle: preset.description,
        icon: <Zap className="w-4 h-4 text-[#d29922]" />,
        badge: preset.badge,
        action: () => onLaunchSwarmPreset(preset),
      });
    }

    // 4. Terminals
    terminals.forEach((term, idx) => {
      const projName = term.project_path.split(/[/\\]/).filter(Boolean).pop() || "Workspace";
      items.push({
        id: `term-${term.id}`,
        category: "Terminals",
        title: term.name || `Terminal ${idx + 1}`,
        subtitle: `${projName} • ${term.run_kind} ${term.task_title ? `— "${term.task_title}"` : ""}`,
        icon: <AgentIcon kind={term.run_kind} className="w-4 h-4 shrink-0" />,
        badge:
          term.id === activeTerminalId
            ? "active"
            : term.claude_status === "working"
            ? "working"
            : term.claude_status === "waiting"
            ? "decision"
            : undefined,
        action: () => onSelectTerminal(term.id, term.project_path),
      });
    });

    // 5. Workspaces
    projects.forEach((proj) => {
      const count = terminals.filter((t) => isSamePath(t.project_path, proj.path)).length;
      const isCurrent = proj.path === activeProject;
      items.push({
        id: `proj-${proj.path}`,
        category: "Workspaces",
        title: proj.name,
        subtitle: proj.path,
        icon: <FolderGit2 className="w-4 h-4 text-[#58a6ff]" />,
        badge: isCurrent ? `current • ${count} open` : `${count} open`,
        action: () => onSelectProject(proj.path),
      });
    });

    // 6. Secondary Git Worktrees
    Object.entries(projectWorktrees || {}).forEach(([repoPath, wts]) => {
      const projName = repoPath.split(/[/\\]/).filter(Boolean).pop() || "Repo";
      wts
        .filter((wt) => !wt.is_main)
        .forEach((wt) => {
          const branchName = wt.branch ? wt.branch.replace("refs/heads/", "") : wt.head.slice(0, 7);
          const wtTerms = terminals.filter((t) => isSamePath(t.project_path, wt.path));
          const isCurrent = wt.path === activeProject;
          items.push({
            id: `worktree-${wt.path}`,
            category: "Workspaces",
            title: `Worktree: ${branchName}`,
            subtitle: `${projName} • ${wt.path}`,
            icon: <GitBranch className="w-4 h-4 text-[#3fb950]" />,
            badge: isCurrent ? `active • ${wtTerms.length} open` : wtTerms.length > 0 ? `${wtTerms.length} open` : undefined,
            action: () => {
              onSelectProject(wt.path);
              if (wtTerms.length > 0) {
                onSelectTerminal(wtTerms[0].id, wt.path);
              }
            },
          });
        });
    });

    return items;
  }, [
    projects,
    activeProject,
    terminals,
    activeTerminalId,
    projectWorktrees,
    onOpenNewWorktree,
    onOpenGithubDrawer,
    onSetLayout,
    onToggleZoom,
    onFocusNextPane,
    onNewTerminal,
    onOpenWorkspaceSettings,
    onOpenSwarmModal,
    onLaunchSwarmPreset,
    savedSwarms,
    onOpenActionLog,
    onOpenA2A,
    onOpenDiffInspector,
    onOpenPrePrAudit,
    onOpenSessionHistory,
    onOpenTokenSpend,
    onOpenArchonGraph,
    onOpenFactoryStation,
    onOpenPraxisBuilder,
    onCheckForUpdates,
    onToggleLiveMode,
    onAddProject,
    onSelectProject,
    onSelectTerminal,
  ]);

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.subtitle && c.subtitle.toLowerCase().includes(q)) ||
        c.category.toLowerCase().includes(q) ||
        (c.shortcut && c.shortcut.toLowerCase().includes(q))
    );
  }, [allCommands, query]);

  // Reset selected index if out of bounds
  useEffect(() => {
    if (selectedIndex >= filteredCommands.length) {
      setSelectedIndex(0);
    }
  }, [filteredCommands.length, selectedIndex]);

  // Key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? Math.max(0, filteredCommands.length - 1) : prev - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filteredCommands[selectedIndex];
      if (target) {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        target.action();
        onClose();
      }
    }
  };

  // Auto scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    // z-60 keeps the palette above a drawer it was opened over
    <div
      {...backdropProps}
      className="fixed inset-0 z-60 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-xs p-4"
    >
      <div
        {...panelProps}
        aria-label="Command palette"
        className="focus:outline-hidden relative w-full max-w-2xl bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[70vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Search Input Bar */}
        <div className="px-4 py-3 border-b border-[#30363d] flex items-center gap-3 bg-[#0d1117]">
          <Search className="w-5 h-5 text-[#8b949e] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, terminal, layout, or workspace..."
            className="w-full bg-transparent border-none text-sm text-white placeholder-[#8b949e] focus:outline-hidden"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 shrink-0 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors"
            title="Close (Esc)"
            aria-label="Close command palette"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 divide-y divide-[#30363d]/30">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#8b949e]">
              No matching commands or resources found for &quot;{query}&quot;
            </div>
          ) : (
            filteredCommands.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-index={idx}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-[#21262d] text-white"
                      : "text-[#c9d1d9] hover:bg-[#161b22]"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-1 rounded bg-[#0d1117] border border-[#30363d] shrink-0">
                      {item.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">{item.title}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#0d1117] text-[#8b949e] font-mono">
                          {item.category}
                        </span>
                      </div>
                      {item.subtitle && (
                        <p className="text-[11px] text-[#8b949e] truncate mt-0.5">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {item.badge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#58a6ff]/15 text-[#58a6ff] font-mono">
                        {item.badge}
                      </span>
                    )}
                    {item.shortcut && (
                      <kbd className="px-1.5 py-0.5 rounded bg-[#0d1117] text-[10px] font-mono text-[#8b949e] border border-[#30363d]">
                        {item.shortcut}
                      </kbd>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div className="px-4 py-2 border-t border-[#30363d] bg-[#0d1117] flex items-center justify-between text-[11px] text-[#8b949e]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1 rounded bg-[#21262d] font-mono">↑</kbd>
              <kbd className="px-1 rounded bg-[#21262d] font-mono">↓</kbd> Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 rounded bg-[#21262d] font-mono">↵</kbd> Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 rounded bg-[#21262d] font-mono">Esc</kbd> Close
            </span>
          </div>

          <span className="font-mono text-[10px]">
            {filteredCommands.length} items
          </span>
        </div>
      </div>
    </div>
  );
};
