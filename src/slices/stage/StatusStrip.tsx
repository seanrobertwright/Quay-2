import { TerminalInfo, isAgentRunKind } from "../terminal/types";
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
  const isAgent = isAgentRunKind(terminal.run_kind);
  const workingTool = terminal.current_tool || activeTool;
  const workingText = `Working${workingTool ? `: ${workingTool}` : ""}${
    terminal.tool_detail ? ` (${terminal.tool_detail})` : ""
  }`;
  const waitingText = `Waiting for decision${
    terminal.current_tool ? ` (${terminal.current_tool})` : ""
  }`;
  const idleText = terminal.task_title
    ? `Ready — Task: "${terminal.task_title}"`
    : "Ready for next prompt";
  const modeLabel = terminal.live_mode === "skip" ? "Mode: Skip" : "Mode: Normal";
  const diffsLabel = `Diffs${diffCount > 0 ? ` (${diffCount})` : ""}`;

  // The strip stays one h-8 line at every width. It is a size container, so its
  // labels follow the stage's width (window minus rail), not the window's: below
  // 90rem the mode switch and the secondary buttons show only their icons and
  // counts and the project path narrows, and below 64rem the approval pill does
  // too. Every click target stays, and long text (terminal name, status, project
  // path) truncates with a title tooltip.
  return (
    <div className="@container h-8 bg-[#161b22] border-t border-[#30363d] px-4 flex items-center justify-between gap-4 overflow-hidden whitespace-nowrap text-xs text-[#8b949e] shrink-0 select-none">
      <div className="flex flex-1 min-w-[12rem] items-center gap-3 @min-[64rem]:gap-4 overflow-hidden">
        {/* Terminal Run Kind & Name */}
        <div className="flex shrink-0 items-center gap-1.5 font-medium text-white">
          <span className="truncate max-w-[10rem]" title={terminal.name}>
            {terminal.name}
          </span>
          <span className="shrink-0 text-[#8b949e] font-normal">({terminal.run_kind})</span>
        </div>

        {/* Live Status indicator */}
        {isAgent && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[#30363d]">|</span>
            {terminal.claude_status === "working" && (
              <span className="flex min-w-0 items-center gap-1.5 text-[#58a6ff]">
                <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                <span className="truncate" title={workingText}>
                  {workingText}
                </span>
              </span>
            )}

            {terminal.claude_status === "waiting" && (
              <span className="flex min-w-0 items-center gap-1.5 text-[#d29922] font-semibold animate-pulse">
                <span className="shrink-0 text-sm leading-none">◆</span>
                <span className="truncate" title={waitingText}>
                  {waitingText}
                </span>
              </span>
            )}

            {terminal.claude_status === "idle" && (
              <span className="flex min-w-0 items-center gap-1.5 text-[#3fb950]">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate" title={idleText}>
                  {idleText}
                </span>
              </span>
            )}

            {terminal.claude_status === "starting" && (
              <span className="flex min-w-0 items-center gap-1.5 text-[#8b949e]">
                <span className="w-2 h-2 shrink-0 rounded-full bg-[#d29922] animate-pulse" />
                <span className="truncate">Starting session...</span>
              </span>
            )}

            {terminal.claude_status === "exited" && (
              <span className="truncate text-[#ff7b72] font-mono">
                Exited with code {terminal.exit_code ?? "?"}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 @min-[64rem]:gap-3">
        {/* Pending Approvals Alert Pill */}
        {pendingCount !== undefined && pendingCount > 0 && onOpenPermissionModal && (
          <button
            type="button"
            onClick={onOpenPermissionModal}
            className="flex shrink-0 items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#d29922] text-[#0d1117] font-bold text-[11px] animate-pulse cursor-pointer shadow-md hover:bg-[#e3b341] transition-colors"
            title="Click to review pending tool approvals"
            aria-label={`Approval Required (${pendingCount})`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span className="hidden @min-[64rem]:inline">Approval Required</span>
            <span>({pendingCount})</span>
          </button>
        )}

        {/* Live Permission Mode Switcher */}
        {isAgent && onToggleLiveMode && (
          <button
            type="button"
            onClick={onToggleLiveMode}
            className={`flex shrink-0 items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer border transition-colors ${
              terminal.live_mode === "skip"
                ? "bg-[#3fb950]/15 text-[#3fb950] border-[#3fb950]/30 hover:bg-[#3fb950]/25"
                : "bg-[#d29922]/15 text-[#d29922] border-[#d29922]/30 hover:bg-[#d29922]/25 font-semibold"
            }`}
            title="Click to toggle between Skip (Auto-Approve) and Normal (Interactive Gatekeeper)"
            aria-label={modeLabel}
          >
            {terminal.live_mode === "skip" ? (
              <Sparkles className="w-3 h-3 text-[#3fb950]" />
            ) : (
              <ShieldCheck className="w-3 h-3 text-[#d29922]" />
            )}
            <span className="hidden @min-[90rem]:inline">{modeLabel}</span>
          </button>
        )}

        {/* Auto approved count */}
        {isAgent && (
          <div
            className="flex shrink-0 items-center gap-1 text-[#8b949e] hover:text-[#c9d1d9] cursor-pointer"
            onClick={onOpenActionLog}
            title={`${terminal.auto_approved_count} auto-approved. Click to view Action Log`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#3fb950]" />
            <strong className="text-white font-mono">{terminal.auto_approved_count}</strong>
            <span className="hidden @min-[90rem]:inline">auto-approved</span>
          </div>
        )}

        {/* Action Log Drawer Trigger */}
        {isAgent && (
          <button
            type="button"
            onClick={onOpenActionLog}
            className="flex shrink-0 items-center gap-1 text-[#58a6ff] hover:underline cursor-pointer"
            title="Action Log"
            aria-label="Action Log"
          >
            <ListOrdered className="w-3.5 h-3.5" />
            <span className="hidden @min-[90rem]:inline">Action Log</span>
          </button>
        )}

        {/* Diff Inspector Trigger */}
        {onOpenDiffInspector && (
          <button
            type="button"
            onClick={onOpenDiffInspector}
            className="flex shrink-0 items-center gap-1 text-[#3fb950] hover:underline cursor-pointer"
            title="Inspect Visual Diff & File Changes"
            aria-label={diffsLabel}
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span className="hidden @min-[90rem]:inline">Diffs</span>
            {diffCount > 0 && <span>({diffCount})</span>}
          </button>
        )}

        {/* GitHub Issues & PR Companion Trigger */}
        {onOpenGithubDrawer && (
          <button
            type="button"
            onClick={onOpenGithubDrawer}
            className="flex shrink-0 items-center gap-1 text-[#c9d1d9] hover:text-white hover:underline cursor-pointer"
            title="GitHub Issues & Pull Requests Companion (^b i)"
            aria-label="GitHub"
          >
            <GithubIcon className="w-3.5 h-3.5" />
            <span className="hidden @min-[90rem]:inline">GitHub</span>
          </button>
        )}

        {/* Pre-PR Audit Trigger */}
        {onOpenAuditModal && (
          <button
            type="button"
            onClick={onOpenAuditModal}
            className="flex shrink-0 items-center gap-1 text-[#f85149] hover:text-[#ff7b72] hover:underline cursor-pointer"
            title="Run Pre-PR Audit Leak & Claim Scanner (^b a)"
            aria-label="Audit"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span className="hidden @min-[90rem]:inline">Audit</span>
          </button>
        )}

        {/* Session History Trigger */}
        {onOpenSessionHistory && (
          <button
            type="button"
            onClick={onOpenSessionHistory}
            className="flex shrink-0 items-center gap-1 text-[#c9d1d9] hover:text-white hover:underline cursor-pointer"
            title="Browse & Auto-Resume Past Claude Sessions (^b h)"
            aria-label="History"
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden @min-[90rem]:inline">History</span>
          </button>
        )}

        {/* Live Token Spend Ticker Pill */}
        {onOpenTokenSpend && (
          <button
            type="button"
            onClick={onOpenTokenSpend}
            className="flex shrink-0 items-center gap-1 px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#e3b341] hover:text-[#f2cc60] font-mono text-[11px] font-semibold cursor-pointer border border-[#30363d] transition-colors"
            title={`All-time API-equivalent Claude spend · today (UTC) $${(
              claudeStats?.windows?.find((w) => w.key === "today")?.cost_usd ?? 0
            ).toFixed(2)} (^b t)`}
          >
            <Coins className="w-3.5 h-3.5 text-[#e3b341]" />
            <span>${(claudeStats?.total_cost_usd ?? 0).toFixed(2)}</span>
          </button>
        )}

        <div className="flex min-w-[4rem] items-center gap-1 text-[#8b949e] font-mono text-[11px]">
          <FileCode className="w-3 h-3 shrink-0" />
          <span className="min-w-0 truncate max-w-[8rem] @min-[90rem]:max-w-[200px]" title={terminal.project_path}>
            {terminal.project_path}
          </span>
        </div>
      </div>
    </div>
  );
};
