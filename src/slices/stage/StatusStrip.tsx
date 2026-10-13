import { TerminalInfo } from "../terminal/types";
import { Loader2, ShieldCheck, ListOrdered, FileCode, CheckCircle2 } from "lucide-react";

interface StatusStripProps {
  terminal: TerminalInfo;
  activeTool?: string | null;
  onOpenActionLog: () => void;
}

export const StatusStrip: React.FC<StatusStripProps> = ({
  terminal,
  activeTool,
  onOpenActionLog,
}) => {
  return (
    <div className="h-8 bg-[#161b22] border-t border-[#30363d] px-4 flex items-center justify-between text-xs text-[#8b949e] shrink-0 select-none">
      <div className="flex items-center gap-4">
        {/* Terminal Run Kind & Name */}
        <div className="flex items-center gap-1.5 font-medium text-white">
          <span>{terminal.name}</span>
          <span className="text-[#8b949e] font-normal">({terminal.run_kind})</span>
        </div>

        {/* Live Status indicator */}
        {terminal.run_kind === "claude" && (
          <div className="flex items-center gap-2">
            <span className="text-[#30363d]">|</span>
            {terminal.claude_status === "working" && (
              <span className="flex items-center gap-1.5 text-[#58a6ff]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Working {activeTool ? `(${activeTool})` : ""}</span>
              </span>
            )}

            {terminal.claude_status === "waiting" && (
              <span className="flex items-center gap-1.5 text-[#d29922] font-semibold">
                <span className="text-sm leading-none">◆</span>
                <span>Waiting for decision or user input</span>
              </span>
            )}

            {terminal.claude_status === "idle" && (
              <span className="flex items-center gap-1.5 text-[#3fb950]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Ready for next prompt</span>
              </span>
            )}

            {terminal.claude_status === "starting" && (
              <span className="flex items-center gap-1.5 text-[#8b949e]">
                <span className="w-2 h-2 rounded-full bg-[#d29922] animate-pulse" />
                <span>Starting session...</span>
              </span>
            )}

            {terminal.claude_status === "exited" && (
              <span className="text-[#ff7b72] font-mono">
                Exited with code {terminal.exit_code ?? "?"}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Auto approved count */}
        {terminal.run_kind === "claude" && (
          <div
            className="flex items-center gap-1 text-[#8b949e] hover:text-[#c9d1d9] cursor-pointer"
            onClick={onOpenActionLog}
            title="Click to view Action Log"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#3fb950]" />
            <span>
              <strong className="text-white font-mono">{terminal.auto_approved_count}</strong> auto-approved
            </span>
          </div>
        )}

        {/* Action Log Drawer Trigger */}
        {terminal.run_kind === "claude" && (
          <button
            onClick={onOpenActionLog}
            className="flex items-center gap-1 text-[#58a6ff] hover:underline"
          >
            <ListOrdered className="w-3.5 h-3.5" />
            <span>Action Log</span>
          </button>
        )}

        <div className="flex items-center gap-1 text-[#8b949e] font-mono text-[11px]">
          <FileCode className="w-3 h-3" />
          <span className="truncate max-w-[200px]">{terminal.project_path}</span>
        </div>
      </div>
    </div>
  );
};
