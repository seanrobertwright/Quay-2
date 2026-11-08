import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { type PermissionMode, type TerminalInfo, isAgentRunKind, launchModel } from "../terminal/types.ts";
import { AgentIcon } from "../terminal/AgentIcons.tsx";
import { TerminalMenu } from "../terminal/TerminalMenu.tsx";
import { RenameInput } from "../terminal/RenameInput.tsx";
import { requestTerminal } from "../terminal/terminalRequests.ts";
import { useContextMenu } from "../overlay/useContextMenu.ts";
import {
  Terminal as TerminalIcon,
  X,
  Loader2,
  FileEdit,
  Search,
  Edit2,
  Shield,
  Radio,
  Play,
} from "lucide-react";

interface TerminalRowProps {
  index: number;
  terminal: TerminalInfo;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename?: (id: string, newName: string) => void;
  onRelaunch?: (id: string) => void;
  /** Switches the terminal between Skip and Ask, as the status strip's mode switch does. */
  onToggleAsk?: (id: string, currentMode: PermissionMode) => void;
}

export const TerminalRow = ({
  index,
  terminal,
  isActive,
  onSelect,
  onClose,
  onRename,
  onRelaunch,
  onToggleAsk,
}: TerminalRowProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [hasRecentA2A, setHasRecentA2A] = useState(false);
  const [recentA2APrompt, setRecentA2APrompt] = useState<string | null>(null);
  const menu = useContextMenu<string>();

  const isAgent = isAgentRunKind(terminal.run_kind);
  const launchedModel = launchModel(terminal.custom_flags);
  // "claude-sonnet-4-6" -> "sonnet-4-6"; provider prefixes like "anthropic/" are dropped
  const modelLabel = launchedModel?.split("/").pop()?.replace(/^claude-/, "") ?? null;

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const unlistenDispatchedPromise = listen<{
      id: string;
      from_terminal: string;
      to_terminal: string;
      content: string;
      broadcast?: boolean;
    }>("a2a-message-dispatched", (event) => {
      // A broadcast notice is dispatched to each peer it reaches, so only those show it.
      if (event.payload.to_terminal === terminal.id) {
        setHasRecentA2A(true);
        setRecentA2APrompt(
          event.payload.broadcast ? `Broadcast: ${event.payload.content}` : event.payload.content,
        );
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          setHasRecentA2A(false);
        }, 9000);
      }
    });

    return () => {
      unlistenDispatchedPromise.then((unlisten) => unlisten());
      if (timeout) clearTimeout(timeout);
    };
  }, [terminal.id]);

  const handleRenameDone = (newName: string | null) => {
    if (newName !== null) onRename?.(terminal.id, newName);
    setIsEditing(false);
  };

  const renderIcon = () => {
    return <AgentIcon kind={terminal.run_kind} className="w-3.5 h-3.5 shrink-0" />;
  };

  const renderToolBadge = () => {
    const tool = terminal.current_tool;
    const detail = terminal.tool_detail;
    if (!tool) {
      return (
        <span className="flex items-center gap-1 text-[10px] text-[#58a6ff]">
          <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
          <span>Working...</span>
        </span>
      );
    }

    const lowerTool = tool.toLowerCase();
    if (lowerTool.includes("bash") || lowerTool.includes("cmd") || lowerTool.includes("exec")) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#1f6feb]/20 text-[#58a6ff] border border-[#1f6feb]/40 max-w-full">
          <TerminalIcon className="w-2.5 h-2.5 shrink-0" />
          <strong className="shrink-0 font-medium">{tool}:</strong>
          <span className="truncate max-w-[120px]">{detail || "executing"}</span>
        </span>
      );
    }

    if (lowerTool.includes("edit") || lowerTool.includes("write") || lowerTool.includes("file")) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#a371f7]/20 text-[#d2a8ff] border border-[#a371f7]/40 max-w-full">
          <FileEdit className="w-2.5 h-2.5 shrink-0" />
          <strong className="shrink-0 font-medium">{tool}:</strong>
          <span className="truncate max-w-[120px]">{detail || "editing"}</span>
        </span>
      );
    }

    if (
      lowerTool.includes("read") ||
      lowerTool.includes("glob") ||
      lowerTool.includes("grep") ||
      lowerTool.includes("view")
    ) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 max-w-full">
          <Search className="w-2.5 h-2.5 shrink-0" />
          <strong className="shrink-0 font-medium">{tool}:</strong>
          <span className="truncate max-w-[120px]">{detail || "scanning"}</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#1f6feb]/20 text-[#58a6ff] border border-[#1f6feb]/40 max-w-full">
        <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
        <strong className="shrink-0 font-medium">{tool}</strong>
        {detail && <span className="truncate max-w-[120px]">{detail}</span>}
      </span>
    );
  };

  const renderStatus = () => {
    if (!isAgent) {
      if (terminal.claude_status === "exited") {
        return (
          <span className="text-[10px] text-[#8b949e] font-mono">
            exited {terminal.exit_code ?? 0}
          </span>
        );
      }
      return null;
    }

    switch (terminal.claude_status) {
      case "working":
        return renderToolBadge();
      case "waiting":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-medium bg-[#d29922]/20 text-[#d29922] border border-[#d29922]/40 animate-pulse">
            <span className="text-xs leading-none">◆</span>
            <span>Waiting</span>
          </span>
        );
      case "starting":
        return (
          <span className="flex items-center gap-1 text-[10px] text-[#8b949e]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d29922] animate-pulse" />
            <span>Starting...</span>
          </span>
        );
      case "idle":
        if (terminal.task_title && terminal.task_title !== terminal.name) {
          return (
            <span
              className="flex items-center gap-1 text-[10px] text-[#8b949e] truncate max-w-[140px]"
              title={terminal.task_title}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] shrink-0" />
              <span className="truncate">{terminal.task_title}</span>
            </span>
          );
        }
        return (
          <span className="flex items-center gap-1 text-[10px] text-[#3fb950]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
            <span>Ready</span>
          </span>
        );
      case "exited":
        return (
          <span className="flex items-center gap-1.5 text-[10px] text-[#8b949e]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff7b72] shrink-0" />
            <span className="font-mono">exited {terminal.exit_code ?? 0}</span>
            {onRelaunch && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRelaunch(terminal.id);
                }}
                className="text-[9px] text-[#58a6ff] hover:text-[#79c0ff] hover:underline cursor-pointer"
              >
                Relaunch
              </button>
            )}
          </span>
        );
      case "unknown":
        return (
          <span className="flex items-center gap-1 text-[10px] text-[#8b949e]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#8b949e]" />
            <span>Unknown</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <>
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="menu"
      onClick={onSelect}
      // Right-click opens the terminal menu and leaves the selection as it is. The rename box
      // keeps the native menu, with its Cut, Copy and Paste.
      onContextMenu={(e) => {
        if (!isEditing) menu.onContextMenu(e, terminal.id);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
          return;
        }
        menu.onKeyDown(e, terminal.id);
      }}
      className={`group flex flex-col gap-1 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
        isActive
          ? "bg-[#21262d] text-white font-medium shadow-xs border border-[#30363d]/80"
          : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#c9d1d9] border border-transparent"
      }`}
    >
      {/* Top Header Row: Index, Icon, Name (with inline edit), and Action Badges */}
      <div className="flex items-center justify-between min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-mono text-[#484f58] w-3 shrink-0 text-right text-[11px]">
            {index}
          </span>
          {renderIcon()}

          {isEditing ? (
            <RenameInput name={terminal.name} onDone={handleRenameDone} />
          ) : (
            <div className="flex items-center gap-1 min-w-0 truncate">
              <span
                className="truncate font-medium text-xs text-[#c9d1d9] group-hover:text-white"
                title={`${terminal.name}${terminal.task_title ? ` — ${terminal.task_title}` : ""}`}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
              >
                {terminal.name}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-[#8b949e] hover:text-white rounded transition-opacity"
                title="Rename session"
              >
                <Edit2 className="w-2.5 h-2.5" />
              </button>
            </div>
          )}

          {/* Permission Mode badge */}
          {isAgent && terminal.permission_mode === "skip" && (
            <span className="px-1 py-0.2 rounded text-[9px] font-mono font-bold bg-[#ff7b72]/20 text-[#ff7b72] border border-[#ff7b72]/40 shrink-0">
              SKIP
            </span>
          )}

          {/* Incoming A2A Badge */}
          {hasRecentA2A && (
            <span
              className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-[#1f6feb]/30 text-[#58a6ff] border border-[#58a6ff]/60 animate-pulse shrink-0 flex items-center gap-1"
              title={`Incoming A2A Task: ${recentA2APrompt || ""}`}
            >
              <Radio className="w-2.5 h-2.5 text-[#58a6ff] animate-spin shrink-0" />
              <span>A2A ✉</span>
            </span>
          )}
        </div>

        {/* Action icons / counters on right */}
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          {terminal.auto_approved_count > 0 && (
            <span
              className="flex items-center gap-0.5 px-1.5 py-0.2 bg-[#30363d]/80 text-[#8b949e] rounded text-[9px] font-mono"
              title={`${terminal.auto_approved_count} auto-approved actions`}
            >
              <Shield className="w-2.5 h-2.5 text-[#3fb950]" />
              <span>{terminal.auto_approved_count}</span>
            </span>
          )}

          {terminal.claude_status === "exited" && onRelaunch && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRelaunch(terminal.id);
              }}
              className="p-0.5 text-[#3fb950] hover:text-[#56d364] hover:bg-[#238636]/20 rounded transition-colors"
              title="Relaunch agent process"
            >
              <Play className="w-3 h-3 fill-current" />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5 hover:text-[#ff7b72] rounded transition-opacity"
            title="Close terminal"
            aria-label={`Close terminal ${terminal.name}`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Sub Row: Live Status and Tool Badge */}
      <div className="pl-4.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
        {renderStatus()}
        {/* Launch model (absent when the agent runs its default model) */}
        {isAgent && modelLabel && (
          <span
            className="ml-auto px-1 py-0.2 rounded text-[9px] font-mono bg-[#388bfd]/15 text-[#79c0ff] border border-[#388bfd]/40 shrink-0 truncate max-w-[96px]"
            title={`Launched with --model ${launchedModel}`}
          >
            {modelLabel}
          </span>
        )}
      </div>
    </div>

      {/* Outside the row, whose click selects the terminal: the portal still bubbles React
          events from the menu to the element that renders it. */}
      {menu.open && (
        <TerminalMenu
          terminal={terminal}
          surface={{ kind: "rail" }}
          at={menu.open.at}
          onClose={menu.close}
          handlers={{
            rename: () => setIsEditing(true),
            relaunch: onRelaunch && (() => onRelaunch(terminal.id)),
            toggleAsk: onToggleAsk && (() => onToggleAsk(terminal.id, terminal.live_mode)),
            showInFocusedPane: onSelect,
            redraw: () => requestTerminal(terminal.id, "redraw"),
            // The search shows in the terminal's pane, so the terminal is shown first.
            find: () => {
              onSelect();
              requestTerminal(terminal.id, "find");
            },
            closeTerminal: onClose,
          }}
        />
      )}
    </>
  );
};

