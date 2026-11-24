import { FC, useState, useRef, CSSProperties, type ReactNode } from "react";
import { TerminalInfo, StageLayout } from "../terminal/types";
import { TerminalView } from "../terminal/TerminalView";
import { AskingButton } from "../surface/AskingButton.tsx";
import { BoardStrip } from "../surface/strip/BoardStrip.tsx";
import type { SurfaceKey } from "../surface/surfaceTypes.ts";
import { Placeholder } from "./Placeholder";
import { ShellWarningBanner } from "./ShellWarningBanner.tsx";
import { singleLayoutTerminalId } from "./singlePane";
import { StageTabBar, type StageToolTab } from "./StageTabBar";
import { Plus, GripVertical, GripHorizontal } from "lucide-react";
import { isSamePath } from "../../utils/paths";

/** A full-stage tool open in a stage tab, such as the swarm builder. */
export interface StageTool extends StageToolTab {
  /** What the tool draws over the panes while its tab is in front. */
  content: ReactNode;
}

interface StageProps {
  terminals: TerminalInfo[];
  activeProject: string;
  activeTerminalId: string | null;
  primaryTerminalId: string | null;
  secondaryTerminalId: string | null;
  gridTerminalIds: [string | null, string | null, string | null, string | null];
  layout: StageLayout;
  focusedPane: "primary" | "secondary" | "grid-0" | "grid-1" | "grid-2" | "grid-3";
  splitRatio: number;
  zoomedFromLayout: StageLayout | null;
  /** The bridge's current tool, shown in the selected terminal's pane header. */
  activeTool?: string | null;
  onSelectTerminal: (id: string) => void;
  onSelectPane: (pane: "primary" | "secondary" | number) => void;
  onSwitchPaneTerminal: (pane: "primary" | "secondary" | number, terminalId: string) => void;
  onSetLayout: (layout: StageLayout) => void;
  onSetSplitRatio: (ratio: number) => void;
  onToggleZoom: () => void;
  onUnsplit: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onSplitGrid: () => void;
  onNewTerminal: () => void;
  onToggleLiveMode?: (terminalId: string, currentMode: "skip" | "normal") => void;
  onRelaunchTerminal?: (terminalId: string) => void;
  onRenameTerminal?: (terminalId: string, name: string) => void;
  onCloseTerminal?: (terminalId: string) => void;
  /** Opens a terminal's agent surface, from the button in its pane header that counts those that ask. */
  onOpenSurface?: (key: SurfaceKey) => void;
  /** The mark a terminal's pane header shows before its actions, if any. `isVisible` is whether the pane is on the stage. */
  terminalMark?: (terminal: TerminalInfo, isVisible: boolean) => ReactNode;
  /** The line a terminal's pane shows above it, if any. `isVisible` is whether the pane is on the stage. */
  terminalNote?: (terminal: TerminalInfo, isVisible: boolean) => ReactNode;
  /** The open stage tab tools. Each stays mounted while the terminals are in front. */
  tools?: readonly StageTool[];
  /** The tool in front of the panes, or null while the terminals are. */
  frontToolId?: string | null;
  onSelectTool?: (id: string) => void;
  onCloseTool?: (id: string) => void;
}

export const Stage: FC<StageProps> = ({
  terminals,
  activeProject,
  activeTerminalId,
  primaryTerminalId,
  secondaryTerminalId,
  gridTerminalIds,
  layout,
  focusedPane,
  splitRatio,
  zoomedFromLayout,
  activeTool,
  onSelectTerminal,
  onSelectPane,
  onSwitchPaneTerminal,
  onSetSplitRatio,
  onToggleZoom,
  onUnsplit,
  onSplitHorizontal,
  onSplitVertical,
  onSplitGrid,
  onNewTerminal,
  onToggleLiveMode,
  onRelaunchTerminal,
  onRenameTerminal,
  onCloseTerminal,
  onOpenSurface,
  terminalMark,
  terminalNote,
  tools = [],
  frontToolId = null,
  onSelectTool,
  onCloseTool,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Filter terminals for active project
  const visibleTerminals = terminals.filter((t) => isSamePath(t.project_path, activeProject));
  const activeTerminal =
    visibleTerminals.find((t) => t.id === activeTerminalId) || visibleTerminals[0];
  // How many panes show a terminal, which the pane header menu's Close pane needs.
  const paneTerminalIds =
    layout === "grid" ? gridTerminalIds : layout === "single" ? [activeTerminalId] : [primaryTerminalId, secondaryTerminalId];
  const paneCount = paneTerminalIds.filter((id) => visibleTerminals.some((t) => t.id === id)).length;

  // Every terminal of every project, hidden unless its project is active. Both returns render
  // them in the same keyed viewport, so a project with no terminals never remounts them.
  const terminalViews = terminals.map((term) => {
    const isProjectActive = isSamePath(term.project_path, activeProject);
    let isVisible = false;
    let isFocused = false;
    let showPaneHeader = false;
    let paneStyle: CSSProperties = { display: "none" };
    let onPaneSelect: (() => void) | undefined = undefined;
    let onSwitchTerm: ((newId: string) => void) | undefined = undefined;

    if (!isProjectActive) {
      isVisible = false;
      isFocused = false;
      showPaneHeader = false;
      paneStyle = { display: "none" };
    } else if (layout === "single") {
      isVisible =
        term.id ===
        singleLayoutTerminalId({ primaryTerminalId, activeTerminalId, zoomed: zoomedFromLayout !== null });
      isFocused = isVisible;
      // The pane header carries the terminal's state and Skip/Ask pill in every layout.
      showPaneHeader = true;
      paneStyle = {
        position: "absolute",
        inset: 0,
        display: isVisible ? "flex" : "none",
      };
    } else if (layout === "split-horizontal") {
      const isPrimary = term.id === primaryTerminalId;
      const isSecondary = term.id === secondaryTerminalId;
      isVisible = isPrimary || isSecondary;
      isFocused = isPrimary ? focusedPane === "primary" : focusedPane === "secondary";
      showPaneHeader = true;
      onPaneSelect = () => onSelectPane(isPrimary ? "primary" : "secondary");
      onSwitchTerm = (newId) =>
        onSwitchPaneTerminal(isPrimary ? "primary" : "secondary", newId);

      if (isPrimary) {
        paneStyle = {
          position: "absolute",
          top: "4px",
          bottom: "4px",
          left: "4px",
          width: `calc(${splitRatio}% - 8px)`,
          display: "flex",
        };
      } else if (isSecondary) {
        paneStyle = {
          position: "absolute",
          top: "4px",
          bottom: "4px",
          left: `calc(${splitRatio}% + 4px)`,
          right: "4px",
          display: "flex",
        };
      }
    } else if (layout === "split-vertical") {
      const isPrimary = term.id === primaryTerminalId;
      const isSecondary = term.id === secondaryTerminalId;
      isVisible = isPrimary || isSecondary;
      isFocused = isPrimary ? focusedPane === "primary" : focusedPane === "secondary";
      showPaneHeader = true;
      onPaneSelect = () => onSelectPane(isPrimary ? "primary" : "secondary");
      onSwitchTerm = (newId) =>
        onSwitchPaneTerminal(isPrimary ? "primary" : "secondary", newId);

      if (isPrimary) {
        paneStyle = {
          position: "absolute",
          top: "4px",
          left: "4px",
          right: "4px",
          height: `calc(${splitRatio}% - 8px)`,
          display: "flex",
        };
      } else if (isSecondary) {
        paneStyle = {
          position: "absolute",
          top: `calc(${splitRatio}% + 4px)`,
          bottom: "4px",
          left: "4px",
          right: "4px",
          display: "flex",
        };
      }
    } else if (layout === "grid") {
      const slotIdx = gridTerminalIds.indexOf(term.id);
      isVisible = slotIdx !== -1;
      isFocused = focusedPane === `grid-${slotIdx}`;
      showPaneHeader = true;
      if (slotIdx !== -1) {
        onPaneSelect = () => onSelectPane(slotIdx);
        onSwitchTerm = (newId) => onSwitchPaneTerminal(slotIdx, newId);

        // 0: top-left, 1: top-right, 2: bottom-left, 3: bottom-right
        if (slotIdx === 0) {
          paneStyle = {
            position: "absolute",
            top: "4px",
            left: "4px",
            width: "calc(50% - 6px)",
            height: "calc(50% - 6px)",
            display: "flex",
          };
        } else if (slotIdx === 1) {
          paneStyle = {
            position: "absolute",
            top: "4px",
            right: "4px",
            width: "calc(50% - 6px)",
            height: "calc(50% - 6px)",
            display: "flex",
          };
        } else if (slotIdx === 2) {
          paneStyle = {
            position: "absolute",
            bottom: "4px",
            left: "4px",
            width: "calc(50% - 6px)",
            height: "calc(50% - 6px)",
            display: "flex",
          };
        } else if (slotIdx === 3) {
          paneStyle = {
            position: "absolute",
            bottom: "4px",
            right: "4px",
            width: "calc(50% - 6px)",
            height: "calc(50% - 6px)",
            display: "flex",
          };
        }
      }
    }

    return (
      <TerminalView
        key={term.id}
        terminalId={term.id}
        isVisible={isVisible}
        isFocused={isFocused}
        terminal={term}
        allTerminals={visibleTerminals}
        showPaneHeader={showPaneHeader}
        framed={layout !== "single"}
        activeTool={isVisible && isFocused && term.id === activeTerminalId ? activeTool : null}
        onSelect={onPaneSelect}
        // A lone pane has nothing to close, and zooms only back out to the layout it came from.
        onZoomPane={layout !== "single" || zoomedFromLayout !== null ? onToggleZoom : undefined}
        onClosePane={layout !== "single" ? onUnsplit : undefined}
        onSwitchTerminal={onSwitchTerm}
        onRelaunch={onRelaunchTerminal ? () => onRelaunchTerminal(term.id) : undefined}
        onRename={onRenameTerminal ? (name) => onRenameTerminal(term.id, name) : undefined}
        onToggleAsk={onToggleLiveMode ? () => onToggleLiveMode(term.id, term.live_mode) : undefined}
        onCloseTerminal={onCloseTerminal ? () => onCloseTerminal(term.id) : undefined}
        headerExtra={onOpenSurface && <AskingButton terminalId={term.id} onOpen={onOpenSurface} />}
        headerMark={terminalMark?.(term, isVisible)}
        strip={isVisible && <BoardStrip terminal={term} />}
        note={terminalNote?.(term, isVisible)}
        paneCount={paneCount}
        style={paneStyle}
      />
    );
  });

  // Each open tool, drawn over the panes while its tab is in front and hidden, still mounted, otherwise.
  const toolLayers = tools.map((tool) => (
    <div
      key={`tool-${tool.id}`}
      data-stage-tool-panel={tool.id}
      hidden={tool.id !== frontToolId}
      className="absolute inset-0 z-30 flex flex-col bg-[#0d1117] overflow-hidden"
    >
      {tool.content}
    </div>
  ));
  const front = tools.some((tool) => tool.id === frontToolId) ? frontToolId : null;
  const toolTabs = { tools, frontToolId: front, onSelectTool, onCloseTool };

  if (!activeTerminal || visibleTerminals.length === 0) {
    return (
      <main className="flex-1 flex flex-col h-full bg-[#0d1117] overflow-hidden relative select-none">
        {tools.length > 0 && (
          <StageTabBar
            terminals={[]}
            currentTerminalId=""
            layout={layout}
            zoomedFromLayout={zoomedFromLayout}
            onSelectTerminal={onSelectTerminal}
            onNewTerminal={onNewTerminal}
            onUnsplit={onUnsplit}
            onSplitHorizontal={onSplitHorizontal}
            onSplitVertical={onSplitVertical}
            onSplitGrid={onSplitGrid}
            onToggleZoom={onToggleZoom}
            {...toolTabs}
          />
        )}
        {/* A shell-wide warning shows with no terminal open too, such as one raised at startup */}
        <ShellWarningBanner />
        <div className="flex-1 min-h-0 relative flex flex-col">
          <Placeholder onNewTerminal={onNewTerminal} />
          {toolLayers}
        </div>
        <div key="stage-viewport" className="hidden" aria-hidden="true">
          {terminalViews}
          {/* A second child keeps the panes nested as they are in the stage viewport below;
              as the only child they would sit one level higher and React would remount them. */}
          {null}
        </div>
      </main>
    );
  }

  let focusedTerminal = activeTerminal;
  if (layout === "split-horizontal" || layout === "split-vertical") {
    const targetId = focusedPane === "secondary" ? secondaryTerminalId : primaryTerminalId;
    focusedTerminal = visibleTerminals.find((t) => t.id === targetId) || activeTerminal;
  } else if (layout === "grid" && focusedPane.startsWith("grid-")) {
    const idx = parseInt(focusedPane.replace("grid-", ""), 10);
    const targetId = gridTerminalIds[idx];
    focusedTerminal = visibleTerminals.find((t) => t.id === targetId) || activeTerminal;
  }

  // Draggable Divider mouse down handler
  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (layout === "split-horizontal") {
        const offsetX = moveEvent.clientX - rect.left;
        const ratio = Math.round((offsetX / rect.width) * 100);
        onSetSplitRatio(Math.min(80, Math.max(20, ratio)));
      } else if (layout === "split-vertical") {
        const offsetY = moveEvent.clientY - rect.top;
        const ratio = Math.round((offsetY / rect.height) * 100);
        onSetSplitRatio(Math.min(80, Math.max(20, ratio)));
      }
    };

    const onMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <main className="flex-1 flex flex-col h-full bg-[#0d1117] overflow-hidden relative select-none">
      <StageTabBar
        terminals={visibleTerminals}
        currentTerminalId={focusedTerminal.id}
        layout={layout}
        zoomedFromLayout={zoomedFromLayout}
        onSelectTerminal={onSelectTerminal}
        onNewTerminal={onNewTerminal}
        onUnsplit={onUnsplit}
        onSplitHorizontal={onSplitHorizontal}
        onSplitVertical={onSplitVertical}
        onSplitGrid={onSplitGrid}
        onToggleZoom={onToggleZoom}
        {...toolTabs}
      />

      {/* Shell-wide warnings: full stage width, between the tab bar and the panes */}
      <ShellWarningBanner />

      {/* Main Terminal Viewport (Persistently mounts all terminals across all projects) */}
      <div
        key="stage-viewport"
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-[#0d1117] p-1.5"
      >
        {/* Render all terminals so switching projects/worktrees never destroys xterm buffers */}
        {terminalViews}

        {toolLayers}

        {/* Draggable Divider for split-horizontal */}
        {layout === "split-horizontal" && (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA 1.2 focusable window splitter (separator with aria-valuenow)
          <div role="separator" tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize split panes"
            aria-valuenow={Math.round(splitRatio)}
            aria-valuemin={15}
            aria-valuemax={85}
            onMouseDown={handleDividerMouseDown}
            onDoubleClick={() => onSetSplitRatio(50)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                onSetSplitRatio(Math.max(15, splitRatio - 5));
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                onSetSplitRatio(Math.min(85, splitRatio + 5));
              }
            }}
            className={`absolute top-0 bottom-0 z-20 cursor-col-resize flex items-center justify-center transition-colors group select-none ${
              isDragging ? "bg-[#58a6ff]/20" : "hover:bg-[#58a6ff]/10"
            }`}
            style={{
              left: `calc(${splitRatio}% - 5px)`,
              width: "10px",
            }}
            title="Drag to resize panes (Double click to reset 50%)"
          >
            <div
              className={`w-[2px] h-full transition-colors ${
                isDragging ? "bg-[#58a6ff]" : "bg-[#30363d] group-hover:bg-[#58a6ff]"
              }`}
            />
            <div className="absolute top-1/2 -translate-y-1/2 p-0.5 rounded bg-[#161b22] border border-[#30363d] opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVertical className="w-3 h-3 text-[#8b949e]" />
            </div>
          </div>
        )}

        {/* Draggable Divider for split-vertical */}
        {layout === "split-vertical" && (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA 1.2 focusable window splitter (separator with aria-valuenow)
          <div role="separator" tabIndex={0}
            aria-orientation="horizontal"
            aria-label="Resize split panes"
            aria-valuenow={Math.round(splitRatio)}
            aria-valuemin={15}
            aria-valuemax={85}
            onMouseDown={handleDividerMouseDown}
            onDoubleClick={() => onSetSplitRatio(50)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                onSetSplitRatio(Math.max(15, splitRatio - 5));
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                onSetSplitRatio(Math.min(85, splitRatio + 5));
              }
            }}
            className={`absolute left-0 right-0 z-20 cursor-row-resize flex items-center justify-center transition-colors group select-none ${
              isDragging ? "bg-[#58a6ff]/20" : "hover:bg-[#58a6ff]/10"
            }`}
            style={{
              top: `calc(${splitRatio}% - 5px)`,
              height: "10px",
            }}
            title="Drag to resize panes (Double click to reset 50%)"
          >
            <div
              className={`h-[2px] w-full transition-colors ${
                isDragging ? "bg-[#58a6ff]" : "bg-[#30363d] group-hover:bg-[#58a6ff]"
              }`}
            />
            <div className="absolute left-1/2 -translate-x-1/2 p-0.5 rounded bg-[#161b22] border border-[#30363d] opacity-0 group-hover:opacity-100 transition-opacity">
              <GripHorizontal className="w-3 h-3 text-[#8b949e]" />
            </div>
          </div>
        )}

        {/* Grid empty slots placeholder */}
        {layout === "grid" &&
          [0, 1, 2, 3].map((slotIdx) => {
            if (gridTerminalIds[slotIdx] !== null) return null;
            let slotPos: CSSProperties = {};
            if (slotIdx === 0)
              slotPos = { top: "4px", left: "4px", width: "calc(50% - 6px)", height: "calc(50% - 6px)" };
            if (slotIdx === 1)
              slotPos = { top: "4px", right: "4px", width: "calc(50% - 6px)", height: "calc(50% - 6px)" };
            if (slotIdx === 2)
              slotPos = { bottom: "4px", left: "4px", width: "calc(50% - 6px)", height: "calc(50% - 6px)" };
            if (slotIdx === 3)
              slotPos = { bottom: "4px", right: "4px", width: "calc(50% - 6px)", height: "calc(50% - 6px)" };

            return (
              <button
                key={`empty-grid-${slotIdx}`}
                type="button"
                style={{ ...slotPos, position: "absolute" }}
                onClick={onNewTerminal}
                className="border border-dashed border-[#30363d] rounded-md bg-[#161b22]/40 hover:bg-[#161b22]/70 flex flex-col items-center justify-center cursor-pointer transition-colors text-[#8b949e] hover:text-[#58a6ff] gap-2 select-none group"
              >
                <Plus className="w-6 h-6 text-[#8b949e] group-hover:text-[#58a6ff] transition-colors" />
                <span className="text-xs font-medium">Add Terminal to Slot {slotIdx + 1}</span>
              </button>
            );
          })}
      </div>
    </main>
  );
};
