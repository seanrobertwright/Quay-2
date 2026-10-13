import { MouseEvent } from "react";
import { TerminalInfo } from "../terminal/types";
import { Sparkles, Terminal as TerminalIcon, Command as CommandIcon, X, Loader2 } from "lucide-react";

interface TerminalRowProps {
  index: number;
  terminal: TerminalInfo;
  isActive: boolean;
  onSelect: () => void;
  onClose: (e: MouseEvent<HTMLButtonElement>) => void;
}

export const TerminalRow = ({
  index,
  terminal,
  isActive,
  onSelect,
  onClose,
}: TerminalRowProps) => {
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

  const renderStatus = () => {
    if (terminal.run_kind !== "claude") {
      if (terminal.claude_status === "exited") {
        return (
          <span className="text-[11px] text-[#8b949e] font-mono">
            exited {terminal.exit_code ?? 0}
          </span>
        );
      }
      return null;
    }

    switch (terminal.claude_status) {
      case "working":
        return (
          <span className="flex items-center gap-1 text-[11px] text-[#58a6ff]">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Working</span>
          </span>
        );
      case "waiting":
        return (
          <span className="flex items-center gap-1 text-[11px] text-[#d29922] font-semibold">
            <span className="text-sm leading-none">◆</span>
            <span>Waiting</span>
          </span>
        );
      case "starting":
        return (
          <span className="flex items-center gap-1 text-[11px] text-[#8b949e]">
            <span className="w-2 h-2 rounded-full bg-[#d29922] animate-pulse" />
            <span>Starting</span>
          </span>
        );
      case "idle":
        return (
          <span className="flex items-center gap-1 text-[11px] text-[#3fb950]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
            <span>Idle</span>
          </span>
        );
      case "exited":
        return (
          <span className="text-[11px] text-[#ff7b72] font-mono">
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
      className={`group flex items-center justify-between px-3 py-2 text-xs rounded-md cursor-pointer transition-colors ${
        isActive
          ? "bg-[#21262d] text-white font-medium shadow-xs"
          : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#c9d1d9]"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[#484f58] w-3 shrink-0 text-right">
          {index}
        </span>
        {renderIcon()}
        <span className="truncate max-w-[110px]" title={terminal.name}>
          {terminal.name}
        </span>

        {/* Permission Mode badge */}
        {terminal.run_kind === "claude" && terminal.permission_mode === "skip" && (
          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-[#ff7b72]/20 text-[#ff7b72] border border-[#ff7b72]/40 shrink-0">
            SKIP
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {renderStatus()}

        {/* Auto approved counter */}
        {terminal.auto_approved_count > 0 && (
          <span
            className="px-1.5 py-0.2 bg-[#30363d] text-[#8b949e] rounded text-[10px] font-mono"
            title={`${terminal.auto_approved_count} auto-approved actions`}
          >
            {terminal.auto_approved_count}
          </span>
        )}

        <button
          onClick={onClose}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[#ff7b72] rounded transition-opacity"
          title="Close terminal"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
