import { TerminalInfo } from "../terminal/types";
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ListOrdered,
  FileCode,
  CheckCircle2,
  Sparkles,
  GitCompare,
  Coins,
  History,
} from "lucide-react";
import { GithubIcon } from "../github/GithubIcon";
import { ClaudeTokenStats } from "../sessions/types";

interface StatusStripProps {
  terminal: TerminalInfo;
  activeTool?: string | null;
  pendingCount?: number;
  diffCount?: number;
  claudeStats?: ClaudeTokenStats | null;
  onOpenActionLog: () => void;
  onOpenDiffInspector?: () => void;
  onOpenGithubDrawer?: () => void;
  onOpenAuditModal?: () => void;
  onOpenSessionHistory?: () => void;
  onOpenTokenSpend?: () => void;
  onToggleLiveMode?: () => void;
  onOpenPermissionModal?: () => void;
}

export const StatusStrip: React.FC<StatusStripProps> = ({
  terminal,
  activeTool,
  pendingCount,
  diffCount = 0,
  claudeStats,
  onOpenActionLog,
  onOpenDiffInspector,
  onOpenGithubDrawer,
  onOpenAuditModal,
  onOpenSessionHistory,
  onOpenTokenSpend,
  onToggleLiveMode,
  onOpenPermissionModal,
}) => {
  const isAgent =
    terminal.run_kind === "claude" ||
    terminal.run_kind === "antigravity" ||
    terminal.run_kind === "codex";

  return (
    <div className="h-8 bg-[#161b22] border-t border-[#30363d] px-4 flex items-center justify-between text-xs text-[#8b949e] shrink-0 select-none">
      <div className="flex items-center gap-4">
        {/* Terminal Run Kind & Name */}
        <div className="flex items-center gap-1.5 font-medium text-white">
          <span>{terminal.name}</span>
          <span className="text-[#8b949e] font-normal">({terminal.run_kind})</span>
        </div>

        {/* Live Status indicator */}
        {isAgent && (
          <div className="flex items-center gap-2">
            <span className="text-[#30363d]">|</span>
            {terminal.claude_status === "working" && (
              <span className="flex items-center gap-1.5 text-[#58a6ff]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>
                  Working
                  {terminal.current_tool || activeTool
                    ? `: ${terminal.current_tool || activeTool}`
                    : ""}
                  {terminal.tool_detail ? ` (${terminal.tool_detail})` : ""}
                </span>
              </span>
            )}

            {terminal.claude_status === "waiting" && (
              <span className="flex items-center gap-1.5 text-[#d29922] font-semibold animate-pulse">
                <span className="text-sm leading-none">◆</span>
                <span>
                  Waiting for decision
                  {terminal.current_tool ? ` (${terminal.current_tool})` : ""}
                </span>
              </span>
            )}

            {terminal.claude_status === "idle" && (
              <span className="flex items-center gap-1.5 text-[#3fb950]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {terminal.task_title
                    ? `Ready — Task: "${terminal.task_title}"`
                    : "Ready for next prompt"}
                </span>
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
        {/* Pending Approvals Alert Pill */}
        {pendingCount !== undefined && pendingCount > 0 && onOpenPermissionModal && (
          <button
            type="button"
            onClick={onOpenPermissionModal}
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#d29922] text-[#0d1117] font-bold text-[11px] animate-pulse cursor-pointer shadow-md hover:bg-[#e3b341] transition-colors"
            title="Click to review pending tool approvals"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Approval Required ({pendingCount})</span>
          </button>
        )}

        {/* Live Permission Mode Switcher */}
        {isAgent && onToggleLiveMode && (
          <button
            type="button"
            onClick={onToggleLiveMode}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer border transition-colors ${
              terminal.live_mode === "skip"
                ? "bg-[#3fb950]/15 text-[#3fb950] border-[#3fb950]/30 hover:bg-[#3fb950]/25"
                : "bg-[#d29922]/15 text-[#d29922] border-[#d29922]/30 hover:bg-[#d29922]/25 font-semibold"
            }`}
            title="Click to toggle between Skip (Auto-Approve) and Normal (Interactive Gatekeeper)"
          >
            {terminal.live_mode === "skip" ? (
              <>
                <Sparkles className="w-3 h-3 text-[#3fb950]" />
                <span>Mode: Skip</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-3 h-3 text-[#d29922]" />
                <span>Mode: Normal</span>
              </>
            )}
          </button>
        )}

        {/* Auto approved count */}
        {isAgent && (
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
        {isAgent && (
          <button
            type="button"
            onClick={onOpenActionLog}
            className="flex items-center gap-1 text-[#58a6ff] hover:underline cursor-pointer"
          >
            <ListOrdered className="w-3.5 h-3.5" />
            <span>Action Log</span>
          </button>
        )}

        {/* Diff Inspector Trigger */}
        {onOpenDiffInspector && (
          <button
            type="button"
            onClick={onOpenDiffInspector}
            className="flex items-center gap-1 text-[#3fb950] hover:underline cursor-pointer"
            title="Inspect Visual Diff & File Changes"
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>
              Diffs{diffCount > 0 ? ` (${diffCount})` : ""}
            </span>
          </button>
        )}

        {/* GitHub Issues & PR Companion Trigger */}
        {onOpenGithubDrawer && (
          <button
            type="button"
            onClick={onOpenGithubDrawer}
            className="flex items-center gap-1 text-[#c9d1d9] hover:text-white hover:underline cursor-pointer"
            title="GitHub Issues & Pull Requests Companion (^b i)"
          >
            <GithubIcon className="w-3.5 h-3.5" />
            <span>GitHub</span>
          </button>
        )}

        {/* Pre-PR Audit Trigger */}
        {onOpenAuditModal && (
          <button
            type="button"
            onClick={onOpenAuditModal}
            className="flex items-center gap-1 text-[#f85149] hover:text-[#ff7b72] hover:underline cursor-pointer"
            title="Run Pre-PR Audit Leak & Claim Scanner (^b a)"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Audit</span>
          </button>
        )}

        {/* Session History Trigger */}
        {onOpenSessionHistory && (
          <button
            type="button"
            onClick={onOpenSessionHistory}
            className="flex items-center gap-1 text-[#c9d1d9] hover:text-white hover:underline cursor-pointer"
            title="Browse & Auto-Resume Past Claude Sessions (^b h)"
          >
            <History className="w-3.5 h-3.5" />
            <span>History</span>
          </button>
        )}

        {/* Live Token Spend Ticker Pill */}
        {onOpenTokenSpend && (
          <button
            type="button"
            onClick={onOpenTokenSpend}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#e3b341] hover:text-[#f2cc60] font-mono text-[11px] font-semibold cursor-pointer border border-[#30363d] transition-colors"
            title="Live Token Spend & Turn Chime Settings (^b t)"
          >
            <Coins className="w-3.5 h-3.5 text-[#e3b341]" />
            <span>${(claudeStats?.total_cost_usd ?? 0).toFixed(2)}</span>
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
