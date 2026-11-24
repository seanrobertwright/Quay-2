import { neonPart } from "../../lib/neon.ts";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Columns2, Grid2x2, Maximize2, Minimize2, Plus, Rows2, Square, X } from "lucide-react";
import type { StageLayout, TerminalInfo } from "../terminal/types";

/** The stage tab bar's height, in CSS px. */
export const STAGE_TAB_BAR_HEIGHT = 34;

/** A full-stage tool, such as the swarm builder, with its own stage tab. */
export interface StageToolTab {
  id: string;
  label: string;
  /** What names it for a screen reader and on hover, when that is more than its label. */
  name?: string;
  /** Whether it waits for the operator: its icon pulses until it is in front. */
  waits?: boolean;
  icon: ReactNode;
}

interface StageTabBarProps {
  /** The active project's terminals, in Projects panel order. */
  terminals: TerminalInfo[];
  /** The terminal in the focused pane, whose tab is current. */
  currentTerminalId: string;
  layout: StageLayout;
  /** The layout a zoomed pane came from, or null while nothing is zoomed. */
  zoomedFromLayout: StageLayout | null;
  onSelectTerminal: (id: string) => void;
  onNewTerminal: () => void;
  onUnsplit: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onSplitGrid: () => void;
  onToggleZoom: () => void;
  /** The open stage tab tools, each with a tab after the terminals'. */
  tools?: readonly StageToolTab[];
  /** The tool in front of the terminals, whose tab is current instead of a terminal's; null for none. */
  frontToolId?: string | null;
  onSelectTool?: (id: string) => void;
  onCloseTool?: (id: string) => void;
  /** The menu that finished surface tabs are folded under, after the tabs. */
  earlierTabs?: ReactNode;
}

interface LayoutChoice {
  layout: StageLayout;
  label: string;
  chord: string;
  icon: ReactNode;
  run: () => void;
}

/**
 * The bar on top of the stage, `STAGE_TAB_BAR_HEIGHT` tall: a tab per terminal of the active
 * project, then a tab per open stage tab tool, then the finished surface tabs' menu, then New terminal, with the layout switchers and
 * Zoom on the right. A terminal tab selects its terminal: it focuses the pane that shows it, or
 * else takes over the focused pane. A tool tab brings its tool in front of the panes. Tabs are plain
 * buttons marked current, not ARIA tabs, since the panes they show are not tab panels.
 */
export const StageTabBar = ({
  terminals,
  currentTerminalId,
  layout,
  zoomedFromLayout,
  onSelectTerminal,
  onNewTerminal,
  onUnsplit,
  onSplitHorizontal,
  onSplitVertical,
  onSplitGrid,
  onToggleZoom,
  tools = [],
  frontToolId = null,
  onSelectTool,
  onCloseTool,
  earlierTabs,
}: StageTabBarProps) => {
  const layoutRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const choices: LayoutChoice[] = [
    { layout: "single", label: "Single", chord: "Ctrl+Shift+B x", icon: <Square className="w-3.5 h-3.5" />, run: onUnsplit },
    { layout: "split-horizontal", label: "Split horizontal", chord: "Ctrl+Shift+B %", icon: <Columns2 className="w-3.5 h-3.5" />, run: onSplitHorizontal },
    { layout: "split-vertical", label: "Split vertical", chord: 'Ctrl+Shift+B "', icon: <Rows2 className="w-3.5 h-3.5" />, run: onSplitVertical },
    { layout: "grid", label: "2 x 2 grid", chord: "Ctrl+Shift+B g", icon: <Grid2x2 className="w-3.5 h-3.5" />, run: onSplitGrid },
  ];
  // A zoomed pane shows in the single layout, but the layout the user chose is the one it came from.
  const zoomed = zoomedFromLayout !== null;
  const chosenLayout = zoomedFromLayout ?? layout;
  const checkedIndex = Math.max(0, choices.findIndex((c) => c.layout === chosenLayout));

  // The radio group's keyboard pattern with manual activation: the arrow keys move focus to the
  // previous or next layout, wrapping, and Space or Enter switches to it. Switching on arrow alone
  // would split the stage at every step, and a split can start a terminal.
  const onLayoutKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    layoutRefs.current[(index + step + choices.length) % choices.length]?.focus();
  };

  // A terminal selected from elsewhere, such as a chord, brings its tab into view.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const tab = tabsRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    tab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [currentTerminalId, frontToolId]);

  return (
    <div
      style={{ height: STAGE_TAB_BAR_HEIGHT }}
      className="shrink-0 z-10 flex items-stretch bg-[#161b22] border-b border-[#30363d] text-xs select-none"
    >
      <div ref={tabsRef} role="group" aria-label="Stage tabs" className="min-w-0 flex items-stretch overflow-x-auto">
        {terminals.map((term, index) => {
          const current = frontToolId === null && term.id === currentTerminalId;
          return (
            <button
              key={term.id}
              type="button"
              data-terminal-id={term.id}
              onClick={() => onSelectTerminal(term.id)}
              aria-label={term.name}
              aria-current={current ? "true" : undefined}
              title={index < 9 ? `${term.name} (Ctrl+Shift+B ${index + 1})` : term.name}
              className={`relative shrink-0 max-w-[12rem] px-3 flex items-center gap-1.5 border-r border-[#30363d] transition-colors ${
                current ? "bg-[#0d1117] text-white" : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]"
              }`}
            >
              {current && <span aria-hidden="true" data-neon={neonPart("edge", true)} className="absolute left-0 right-0 bottom-0 h-[2px]" />}
              <span className="truncate">{term.name}</span>
              <span aria-hidden="true" className="shrink-0 text-[10px] text-[#8b949e] font-mono">
                {term.run_kind}
              </span>
            </button>
          );
        })}
        {tools.map((tool) => {
          const current = tool.id === frontToolId;
          return (
            <div
              key={tool.id}
              className={`relative shrink-0 flex items-stretch border-r border-[#30363d] ${
                current ? "bg-[#0d1117] text-white" : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]"
              }`}
            >
              {current && <span aria-hidden="true" data-neon={neonPart("edge", true)} className="absolute left-0 right-0 bottom-0 h-[2px]" />}
              <button
                type="button"
                data-stage-tool={tool.id}
                onClick={() => onSelectTool?.(tool.id)}
                aria-label={tool.name ?? tool.label}
                title={tool.name}
                aria-current={current ? "true" : undefined}
                className="max-w-[12rem] pl-3 pr-1 flex items-center gap-1.5"
              >
                <span
                  aria-hidden="true"
                  className={`shrink-0 w-3.5 h-3.5 grid place-items-center ${tool.waits && !current ? "motion-safe:animate-pulse" : ""}`}
                >
                  {tool.icon}
                </span>
                <span className="truncate">{tool.label}</span>
                {tool.waits && <span aria-hidden="true" data-waiting-dot className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d29922]" />}
              </button>
              <button
                type="button"
                onClick={() => onCloseTool?.(tool.id)}
                aria-label={`Close ${tool.label}`}
                title={`Close ${tool.label}`}
                className="w-6 my-auto mr-1 h-6 grid place-items-center rounded hover:bg-[#30363d]"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {earlierTabs}
      <button
        type="button"
        onClick={onNewTerminal}
        aria-label="New terminal"
        title="New terminal (Ctrl+Shift+B n)"
        className="shrink-0 w-[34px] grid place-items-center text-[#58a6ff] hover:text-white hover:bg-[#21262d] transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>
      <div className="flex-1" />

      <div className="shrink-0 flex items-center gap-1.5 px-2">
        <div role="radiogroup" aria-label="Layout" className="flex items-center bg-[#0d1117] border border-[#30363d] rounded p-0.5 gap-0.5">
          {choices.map((choice, index) => {
            const checked = index === checkedIndex;
            return (
              <button
                key={choice.layout}
                ref={(el) => {
                  layoutRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={choice.label}
                tabIndex={checked ? 0 : -1}
                onClick={choice.run}
                onKeyDown={(e) => onLayoutKeyDown(e, index)}
                title={`${choice.label} (${choice.chord})`}
                className={`w-6 h-6 grid place-items-center rounded transition-colors ${
                  checked ? "bg-[#21262d] text-[#58a6ff]" : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]"
                }`}
              >
                {choice.icon}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onToggleZoom}
          aria-label="Zoom pane"
          aria-pressed={zoomed}
          title={zoomed ? "Restore layout (Ctrl+Shift+B z)" : "Zoom pane (Ctrl+Shift+B z)"}
          className={`w-6 h-6 grid place-items-center rounded transition-colors ${
            zoomed ? "bg-[#58a6ff]/20 text-[#58a6ff]" : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          }`}
        >
          {zoomed ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
