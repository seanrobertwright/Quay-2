import { TerminalInfo, PermissionMode, isAgentRunKind } from "../terminal/types";
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

const LIVE_MODES: Record<
  PermissionMode,
  { label: string; Icon: typeof ShieldCheck; className: string }
> = {
  skip: {
    label: "Skip",
    Icon: Sparkles,
    className: "bg-[#3fb950]/15 text-[#3fb950] border-[#3fb950]/30 hover:bg-[#3fb950]/25",
  },
  normal: {
    label: "Normal",
    Icon: ShieldCheck,
    className:
      "bg-[#d29922]/15 text-[#d29922] border-[#d29922]/30 hover:bg-[#d29922]/25 font-semibold",
  },
};

interface StripButtonProps {
  Icon: React.FC<{ className?: string }>;
  label: string;
  count?: number;
  title: string;
  className: string;
  onClick: () => void;
}

/**
 * A link-style strip button. Its label stays whole at the capture widths and
 * collapses to the icon only on a stage narrower than 56rem; the count, title
 * and accessible name always stay.
 */
const StripButton: React.FC<StripButtonProps> = ({
  Icon,
  label,
  count,
  title,
  className,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex shrink-0 items-center gap-1 hover:underline cursor-pointer ${className}`}
    title={title}
    aria-label={count === undefined ? label : `${label} (${count})`}
  >
    <Icon className="w-3.5 h-3.5 shrink-0" />
    <span className="@max-[56rem]:hidden">{label}</span>
    {count !== undefined && <span className="shrink-0">({count})</span>}
  </button>
);

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
  const liveMode = LIVE_MODES[terminal.live_mode];

  // The strip stays one h-8 line at every width. It is a size container, so it
  // responds to the stage's width (window minus rail), not the window's. When
  // room runs short, text truncates with an ellipsis and a title tooltip rather
  // than wrapping: the project path gives way first, then "auto-approved", then
  // "Approval Required", and the status text keeps a minimum width. The mode
  // name and the button labels stay whole. Only on a stage narrower than 56rem
  // (narrower than either capture width, e.g. with the rail dragged wide) do the
  // labels collapse to their icons; every item, count and click target stays.
  return (
    <div className="@container h-8 bg-[#161b22] border-t border-[#30363d] px-4 flex items-center justify-between gap-4 overflow-hidden whitespace-nowrap text-xs text-[#8b949e] shrink-0 select-none">
      <div className="flex flex-1 min-w-[11rem] @min-[56rem]:min-w-[12rem] @min-[64rem]:min-w-[16rem] items-center gap-3 overflow-hidden">
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

      <div className="flex min-w-0 items-center gap-2">
        {/* Pending Approvals Alert Pill */}
        {pendingCount !== undefined && pendingCount > 0 && onOpenPermissionModal && (
          <button
            type="button"
            onClick={onOpenPermissionModal}
            className="flex min-w-[3.5rem] shrink-[10] items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#d29922] text-[#0d1117] font-bold text-[11px] animate-pulse cursor-pointer shadow-md hover:bg-[#e3b341] transition-colors"
            title={`Approval Required (${pendingCount}). Click to review pending tool approvals`}
            aria-label={`Approval Required (${pendingCount})`}
          >
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate @max-[56rem]:hidden">Approval Required</span>
            <span className="shrink-0">({pendingCount})</span>
          </button>
        )}

        {/* Live Permission Mode Switcher */}
        {isAgent && onToggleLiveMode && (
          <button
            type="button"
            onClick={onToggleLiveMode}
            className={`flex shrink-0 items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer border transition-colors ${liveMode.className}`}
            title={`Mode: ${liveMode.label}. Click to toggle between Skip (Auto-Approve) and Normal (Interactive Gatekeeper)`}
            aria-label={`Mode: ${liveMode.label}`}
          >
            <liveMode.Icon className="w-3 h-3 shrink-0" />
            <span className="@max-[56rem]:hidden">{liveMode.label}</span>
          </button>
        )}

        {/* Auto approved count */}
        {isAgent && (
          <div
            className="flex min-w-[2.5rem] shrink-[20] items-center gap-1 text-[#8b949e] hover:text-[#c9d1d9] cursor-pointer"
            onClick={onOpenActionLog}
            title={`${terminal.auto_approved_count} auto-approved. Click to view Action Log`}
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[#3fb950]" />
            <strong className="shrink-0 text-white font-mono">{terminal.auto_approved_count}</strong>
            <span className="truncate @max-[56rem]:hidden">auto-approved</span>
          </div>
        )}

        {isAgent && (
          <StripButton
            Icon={ListOrdered}
            label="Action Log"
            title="Action Log"
            className="text-[#58a6ff]"
            onClick={onOpenActionLog}
          />
        )}

        {onOpenDiffInspector && (
          <StripButton
            Icon={GitCompare}
            label="Diffs"
            count={diffCount > 0 ? diffCount : undefined}
            title="Inspect Visual Diff & File Changes"
            className="text-[#3fb950]"
            onClick={onOpenDiffInspector}
          />
        )}

        {onOpenGithubDrawer && (
          <StripButton
            Icon={GithubIcon}
            label="GitHub"
            title="GitHub Issues & Pull Requests Companion (^b i)"
            className="text-[#c9d1d9] hover:text-white"
            onClick={onOpenGithubDrawer}
          />
        )}

        {onOpenAuditModal && (
          <StripButton
            Icon={ShieldAlert}
            label="Audit"
            title="Run Pre-PR Audit Leak & Claim Scanner (^b a)"
            className="text-[#f85149] hover:text-[#ff7b72]"
            onClick={onOpenAuditModal}
          />
        )}

        {onOpenSessionHistory && (
          <StripButton
            Icon={History}
            label="History"
            title="Browse & Auto-Resume Past Claude Sessions (^b h)"
            className="text-[#c9d1d9] hover:text-white"
            onClick={onOpenSessionHistory}
          />
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

        <div className="flex min-w-[4rem] shrink-[100] items-center gap-1 text-[#8b949e] font-mono text-[11px]">
          <FileCode className="w-3 h-3 shrink-0" />
          <span className="min-w-0 truncate max-w-[200px]" title={terminal.project_path}>
            {terminal.project_path}
          </span>
        </div>
      </div>
    </div>
  );
};
