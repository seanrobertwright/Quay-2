import type { FC } from "react";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { type PermissionMode, type TerminalInfo, isAgentRunKind, offersAskToggle } from "./types.ts";

interface PaneStatusProps {
  terminal: TerminalInfo;
  /** The bridge's current tool, shown while the agent reports none of its own. */
  activeTool?: string | null;
  /** Switches the terminal between Skip and Ask; the pill shows only when this is set. */
  onToggleAsk?: () => void;
}

const LIVE_MODES: Record<PermissionMode, { label: string; Icon: typeof ShieldCheck; className: string }> = {
  skip: {
    label: "Skip",
    Icon: Sparkles,
    className: "bg-[#3fb950]/15 text-[#3fb950] border-[#3fb950]/30 hover:bg-[#3fb950]/25",
  },
  normal: {
    label: "Ask",
    Icon: ShieldCheck,
    className: "bg-[#d29922]/15 text-[#d29922] border-[#d29922]/30 hover:bg-[#d29922]/25 font-semibold",
  },
};

/** An agent's state and current tool as one short line for the pane header. */
const AgentState: FC<{ terminal: TerminalInfo; activeTool?: string | null }> = ({ terminal, activeTool }) => {
  switch (terminal.claude_status) {
    case "working": {
      const tool = terminal.current_tool || activeTool;
      const text = `Working${tool ? `: ${tool}` : ""}${terminal.tool_detail ? ` (${terminal.tool_detail})` : ""}`;
      return (
        <span className="flex min-w-0 items-center gap-1 text-[#58a6ff]">
          <Loader2 className="w-2.5 h-2.5 shrink-0 animate-spin" aria-hidden="true" />
          <span className="truncate" title={text}>{text}</span>
        </span>
      );
    }
    case "waiting": {
      const text = `Waiting for decision${terminal.current_tool ? ` (${terminal.current_tool})` : ""}`;
      return (
        <span className="flex min-w-0 items-center gap-1 text-[#d29922] font-semibold animate-pulse">
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#d29922]" aria-hidden="true" />
          <span className="truncate" title={text}>{text}</span>
        </span>
      );
    }
    case "idle":
      return (
        <span className="flex min-w-0 items-center gap-1 text-[#3fb950]">
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#3fb950]" aria-hidden="true" />
          <span className="truncate">Ready</span>
        </span>
      );
    case "starting":
      return (
        <span className="flex min-w-0 items-center gap-1 text-[#8b949e]">
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#d29922] animate-pulse" aria-hidden="true" />
          <span className="truncate">Starting</span>
        </span>
      );
    case "exited":
      return <span className="truncate text-[#ff7b72] font-mono">Exited with code {terminal.exit_code ?? "?"}</span>;
    default:
      return (
        <span className="flex min-w-0 items-center gap-1 text-[#8b949e]">
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#8b949e]" aria-hidden="true" />
          <span className="truncate">Unknown</span>
        </span>
      );
  }
};

/**
 * What the pane header shows of its terminal's session, which the status strip used to show for
 * the selected terminal: the agent's state and current tool, and its Skip/Ask pill. An agent that
 * never asks before tool calls gets a fixed Skip badge instead; a shell terminal shows nothing.
 */
export const PaneStatus: FC<PaneStatusProps> = ({ terminal, activeTool, onToggleAsk }) => {
  if (!isAgentRunKind(terminal.run_kind)) return null;
  const liveMode = LIVE_MODES[terminal.live_mode];
  return (
    <span className="flex min-w-0 items-center gap-2 text-[10px]">
      <AgentState terminal={terminal} activeTool={activeTool} />
      {offersAskToggle(terminal.run_kind) && onToggleAsk ? (
        <button
          type="button"
          data-no-terminal-focus
          onClick={(e) => {
            e.stopPropagation();
            onToggleAsk();
          }}
          className={`flex shrink-0 items-center gap-1 px-1.5 rounded-full font-mono cursor-pointer border transition-colors ${liveMode.className}`}
          title={`Mode: ${liveMode.label}. Click to switch between Skip (run tools without asking) and Ask (ask before tool calls)`}
          aria-label={`Mode: ${liveMode.label}`}
        >
          <liveMode.Icon className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
          <span>{liveMode.label}</span>
        </button>
      ) : (
        terminal.permission_mode === "skip" && (
          <span
            className="shrink-0 text-[9px] px-1 rounded bg-[#ff7b72]/20 text-[#ff7b72] font-mono font-bold border border-[#ff7b72]/40"
            title="Bypassing tool permissions"
          >
            SKIP
          </span>
        )
      )}
    </span>
  );
};
