import { FC, useState, useRef, CSSProperties } from "react";
import { TerminalInfo, StageLayout, isAgentRunKind } from "../terminal/types";
import { TerminalView } from "../terminal/TerminalView";
import { SkipBanner } from "./SkipBanner";
import { StatusStrip } from "./StatusStrip";
import { Placeholder } from "./Placeholder";
import { singleLayoutTerminalId } from "./singlePane";
import {
  Square,
  Columns2,
  Rows2,
  Grid2x2,
  Maximize2,
  Minimize2,
  Plus,
  X,
  GripVertical,
  GripHorizontal,
  Folder,
  ShieldAlert,
  Settings,
  Zap,
  GitCompare,
  GitBranch,
  History,
  ShieldCheck,
  Cpu,
} from "lucide-react";
import { GithubIcon } from "../github/GithubIcon";
import { ClaudeTokenStats } from "../sessions/types";
import { isSamePath } from "../../utils/paths";

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
  activeTool?: string | null;
  pendingPermissionsCount?: number;
  diffCount?: number;
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
  onOpenActionLog: () => void;
  onOpenPermissionModal?: () => void;
  onOpenWorkspaceSettings?: () => void;
  onOpenSwarm?: () => void;
  onOpenDiffInspector?: () => void;
  onOpenNewWorktree?: () => void;
  onOpenGithubDrawer?: () => void;
  onOpenAuditModal?: () => void;
  onOpenSessionHistory?: () => void;
  onOpenTokenSpend?: () => void;
  onOpenFactoryStation?: () => void;
  claudeStats?: ClaudeTokenStats | null;
  onToggleLiveMode?: (terminalId: string, currentMode: "skip" | "normal") => void;
  onRelaunchTerminal?: (terminalId: string) => void;
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
  pendingPermissionsCount = 0,
  diffCount = 0,
  claudeStats,
  onSelectPane,
  onSwitchPaneTerminal,
  onSetSplitRatio,
  onToggleZoom,
  onUnsplit,
  onSplitHorizontal,
  onSplitVertical,
  onSplitGrid,
  onNewTerminal,
  onOpenActionLog,
  onOpenPermissionModal,
  onOpenWorkspaceSettings,
  onOpenSwarm,
  onOpenDiffInspector,
  onOpenNewWorktree,
  onOpenGithubDrawer,
  onOpenAuditModal,
  onOpenSessionHistory,
  onOpenTokenSpend,
  onOpenFactoryStation,
  onToggleLiveMode,
  onRelaunchTerminal,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Filter terminals for active project
  const visibleTerminals = terminals.filter((t) => isSamePath(t.project_path, activeProject));
  const activeTerminal =
    visibleTerminals.find((t) => t.id === activeTerminalId) || visibleTerminals[0];

  if (!activeTerminal || visibleTerminals.length === 0) {
    return (
      <>
        <Placeholder onNewTerminal={onNewTerminal} />
        {terminals.length > 0 && (
          <div className="hidden" aria-hidden="true">
            {terminals.map((term) => (
              <TerminalView
                key={term.id}
                terminalId={term.id}
                isVisible={false}
                isFocused={false}
                terminal={term}
                allTerminals={visibleTerminals}
                showPaneHeader={false}
                style={{ display: "none" }}
              />
            ))}
          </div>
        )}
      </>
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

  const isAgent = isAgentRunKind(focusedTerminal.run_kind);

  const showSkipBanner =
    isAgent &&
    focusedTerminal.permission_mode === "skip";

  const projectName = activeProject.split(/[/\\]/).filter(Boolean).pop() || "Workspace";

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
      {/* Stage Top Control Bar */}
      <header className="h-9 px-3 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between text-xs select-none shrink-0 z-10">
        {/* Left: Project Breadcrumb & Active Terminal indicator */}
        <div className="flex items-center gap-1.5 min-w-0 text-[#8b949e]">
          <Folder className="w-3.5 h-3.5 text-[#58a6ff] shrink-0" />
          <span className="font-semibold text-white truncate max-w-[150px]" title={activeProject}>
            {projectName}
          </span>
          {onOpenWorkspaceSettings && (
            <button
              type="button"
              onClick={onOpenWorkspaceSettings}
              className="p-1 text-[#8b949e] hover:text-[#58a6ff] hover:bg-[#21262d] rounded transition-colors"
              title={`Workspace Settings (Env Vars & Flags) for ${projectName}`}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="text-[#30363d]">/</span>
          <span className="font-medium text-[#c9d1d9] truncate max-w-[150px]">
            {activeTerminal.name}
          </span>

          {layout !== "single" && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#30363d]/80 text-[#58a6ff] font-mono uppercase tracking-wider font-semibold">
              {layout === "split-horizontal"
                ? `Split ${splitRatio}/${100 - splitRatio}`
                : layout === "split-vertical"
                ? `Stacked ${splitRatio}/${100 - splitRatio}`
                : `2x2 Grid`}
            </span>
          )}
        </div>

        {/* Right: Layout Switchers, Zoom, Unsplit, New Terminal */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Segmented Layout Selector */}
          <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded p-0.5 gap-0.5">
            <button
              type="button"
              onClick={onUnsplit}
              className={`p-1 rounded transition-colors ${
                layout === "single"
                  ? "bg-[#21262d] text-white shadow-xs"
                  : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]"
              }`}
              title="Single Pane (Ctrl+Shift+B x)"
            >
              <Square className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onSplitHorizontal}
              className={`p-1 rounded transition-colors ${
                layout === "split-horizontal"
                  ? "bg-[#21262d] text-[#58a6ff] shadow-xs"
                  : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]"
              }`}
              title="Side-by-Side Split (Ctrl+Shift+B %)"
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onSplitVertical}
              className={`p-1 rounded transition-colors ${
                layout === "split-vertical"
                  ? "bg-[#21262d] text-[#58a6ff] shadow-xs"
                  : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]"
              }`}
              title='Stacked Split (Ctrl+Shift+B ")'
            >
              <Rows2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onSplitGrid}
              className={`p-1 rounded transition-colors ${
                layout === "grid"
                  ? "bg-[#21262d] text-[#58a6ff] shadow-xs"
                  : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22]"
              }`}
              title="2x2 Grid Layout"
            >
              <Grid2x2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="w-[1px] h-4 bg-[#30363d] mx-0.5" />

          {/* Toggle Zoom button */}
          <button
            type="button"
            onClick={onToggleZoom}
            className={`p-1.5 rounded transition-colors ${
              zoomedFromLayout
                ? "bg-[#58a6ff]/20 text-[#58a6ff]"
                : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
            }`}
            title={
              zoomedFromLayout
                ? "Restore split layout (Ctrl+Shift+B z)"
                : "Zoom active pane (Ctrl+Shift+B z)"
            }
          >
            {zoomedFromLayout ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Unsplit / Close split button */}
          {layout !== "single" && (
            <button
              type="button"
              onClick={onUnsplit}
              className="p-1.5 rounded text-[#8b949e] hover:text-[#ff7b72] hover:bg-[#21262d] transition-colors"
              title="Close split layout (Ctrl+Shift+B x)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          <div className="w-[1px] h-4 bg-[#30363d] mx-0.5" />

          {/* Pending Approvals Warning Pill in Top Bar */}
          {pendingPermissionsCount > 0 && onOpenPermissionModal && (
            <button
              type="button"
              onClick={onOpenPermissionModal}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#d29922] text-[#0d1117] font-bold text-xs animate-pulse cursor-pointer shadow-md hover:bg-[#e3b341] transition-colors"
              title="Review pending tool approvals"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Approval ({pendingPermissionsCount})</span>
            </button>
          )}

          {/* Swarm Launcher Button */}
          {onOpenSwarm && (
            <button
              type="button"
              onClick={onOpenSwarm}
              className="flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#d29922] hover:text-white rounded transition-colors text-xs font-medium cursor-pointer"
              title="Launch Multi-Agent Swarm Preset (Ctrl+Shift+B s)"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Swarm</span>
            </button>
          )}

          {/* Machina Factory Station Button */}
          {onOpenFactoryStation && (
            <button
              type="button"
              onClick={onOpenFactoryStation}
              className="flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] hover:text-white rounded border border-[#58a6ff]/30 transition-colors text-xs font-medium cursor-pointer"
              title="Machina AI Software Factory Cockpit (Ctrl+Shift+B F)"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Factory</span>
            </button>
          )}

          {/* Visual Diff Inspector Button */}
          {onOpenDiffInspector && (
            <button
              type="button"
              onClick={onOpenDiffInspector}
              className="flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#3fb950] hover:text-white rounded transition-colors text-xs font-medium cursor-pointer"
              title="Visual Diff & File Changes (Ctrl+Shift+B d)"
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Diffs{diffCount > 0 ? ` (${diffCount})` : ""}</span>
            </button>
          )}

          {/* GitHub Issues & PR Companion Button */}
          {onOpenGithubDrawer && (
            <button
              type="button"
              onClick={onOpenGithubDrawer}
              className="flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white rounded transition-colors text-xs font-medium cursor-pointer"
              title="GitHub Issues & Pull Requests Companion (Ctrl+Shift+B i)"
            >
              <GithubIcon className="w-3.5 h-3.5" />
              <span>GitHub</span>
            </button>
          )}

          {/* Pre-PR Audit Gate Button */}
          {onOpenAuditModal && (
            <button
              type="button"
              onClick={onOpenAuditModal}
              className="flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#f85149] hover:text-[#ff7b72] rounded transition-colors text-xs font-medium cursor-pointer"
              title="Pre-PR Leak & Claim Audit Gate (Ctrl+Shift+B a)"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#f85149]" />
              <span>Audit</span>
            </button>
          )}

          {/* Session History & Auto-Resume Button */}
          {onOpenSessionHistory && (
            <button
              type="button"
              onClick={onOpenSessionHistory}
              className="flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white rounded transition-colors text-xs font-medium cursor-pointer"
              title="Session History & Auto-Resume (Ctrl+Shift+B h)"
            >
              <History className="w-3.5 h-3.5" />
              <span>History</span>
            </button>
          )}

          {/* New Worktree Button */}
          {onOpenNewWorktree && (
            <button
              type="button"
              onClick={onOpenNewWorktree}
              className="flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] hover:text-white rounded transition-colors text-xs font-medium cursor-pointer"
              title="Create Git Worktree for active project (Ctrl+Shift+B w)"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Worktree</span>
            </button>
          )}

          {/* Quick New Terminal button */}
          <button
            type="button"
            onClick={onNewTerminal}
            className="flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white rounded transition-colors text-xs font-medium cursor-pointer"
            title="New Terminal (Ctrl+Shift+B n)"
          >
            <Plus className="w-3.5 h-3.5 text-[#58a6ff]" />
            <span>New Terminal</span>
          </button>
        </div>
      </header>

      {/* Skip Banner above terminal */}
      {showSkipBanner && (
        <SkipBanner
          runKind={focusedTerminal.run_kind}
          agentName={focusedTerminal.name}
        />
      )}

      {/* Main Terminal Viewport (Persistently mounts all terminals across all projects) */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-[#0d1117] p-1.5"
      >
        {/* Render all terminals so switching projects/worktrees never destroys xterm buffers */}
        {terminals.map((term) => {
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
            showPaneHeader = false;
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
              onSelect={onPaneSelect}
              onZoomPane={onToggleZoom}
              onClosePane={onUnsplit}
              onSwitchTerminal={onSwitchTerm}
              onRelaunch={onRelaunchTerminal ? () => onRelaunchTerminal(term.id) : undefined}
              style={paneStyle}
            />
          );
        })}

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

      {/* Status Strip below terminal */}
      <StatusStrip
        terminal={activeTerminal}
        activeTool={activeTool}
        pendingCount={pendingPermissionsCount}
        diffCount={diffCount}
        claudeStats={claudeStats}
        onOpenActionLog={onOpenActionLog}
        onOpenDiffInspector={onOpenDiffInspector}
        onOpenGithubDrawer={onOpenGithubDrawer}
        onOpenAuditModal={onOpenAuditModal}
        onOpenSessionHistory={onOpenSessionHistory}
        onOpenTokenSpend={onOpenTokenSpend}
        onOpenPermissionModal={onOpenPermissionModal}
        onToggleLiveMode={
          onToggleLiveMode
            ? () => onToggleLiveMode(activeTerminal.id, activeTerminal.live_mode)
            : undefined
        }
      />
    </main>
  );
};
