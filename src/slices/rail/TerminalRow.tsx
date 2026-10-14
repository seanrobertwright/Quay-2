import { useState, useRef, useEffect, MouseEvent, KeyboardEvent } from "react";
import { TerminalInfo } from "../terminal/types";
import {
  Sparkles,
  Terminal as TerminalIcon,
  Command as CommandIcon,
  X,
  Loader2,
  FileEdit,
  Search,
  Edit2,
  Shield,
} from "lucide-react";

interface TerminalRowProps {
  index: number;
  terminal: TerminalInfo;
  isActive: boolean;
  onSelect: () => void;
  onClose: (e: MouseEvent<HTMLButtonElement>) => void;
  onRename?: (id: string, newName: string) => void;
}

export const TerminalRow = ({
  index,
  terminal,
  isActive,
  onSelect,
  onClose,
  onRename,
}: TerminalRowProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(terminal.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(terminal.name);
  }, [terminal.name]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSaveRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== terminal.name && onRename) {
      onRename(terminal.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditValue(terminal.name);
      setIsEditing(false);
    }
  };

  const renderIcon = () => {
    switch (terminal.run_kind) {
      case "claude":
        return <Sparkles className="w-3.5 h-3.5 text-[#f0883e] shrink-0" />;
      case "powershell":
        return <TerminalIcon className="w-3.5 h-3.5 text-[#58a6ff] shrink-0" />;
      case "command":
        return <CommandIcon className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />;
    }
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
    if (terminal.run_kind !== "claude") {
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
          <span className="text-[10px] text-[#ff7b72] font-mono">
            exited {terminal.exit_code ?? "?"}
          </span>
        );
      case "unknown":
      default:
        return null;
    }
  };

  return (
    <div
      onClick={onSelect}
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
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSaveRename}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#0d1117] text-white border border-[#58a6ff] rounded px-1.5 py-0.2 text-xs font-medium focus:outline-none w-36"
            />
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
          {terminal.run_kind === "claude" && terminal.permission_mode === "skip" && (
            <span className="px-1 py-0.2 rounded text-[9px] font-mono font-bold bg-[#ff7b72]/20 text-[#ff7b72] border border-[#ff7b72]/40 shrink-0">
              SKIP
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

          <button
            onClick={onClose}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[#ff7b72] rounded transition-opacity"
            title="Close terminal"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Sub Row: Live Status and Tool Badge */}
      <div className="pl-4.5 flex items-center min-w-0 overflow-hidden">
        {renderStatus()}
      </div>
    </div>
  );
};

