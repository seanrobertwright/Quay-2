import { FC, CSSProperties, MouseEvent, useState, useEffect } from "react";
import { useTerminal } from "./useTerminal";
import { TerminalInfo } from "./types";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { AgentIcon } from "./AgentIcons";
import {
  Maximize2,
  X,
  Loader2,
  Search,
} from "lucide-react";

interface TerminalViewProps {
  terminalId: string;
  isVisible: boolean;
  isFocused?: boolean;
  terminal?: TerminalInfo;
  allTerminals?: TerminalInfo[];
  showPaneHeader?: boolean;
  onSelect?: () => void;
  onClosePane?: () => void;
  onZoomPane?: () => void;
  onSwitchTerminal?: (newTerminalId: string) => void;
  className?: string;
  style?: CSSProperties;
}

export const TerminalView: FC<TerminalViewProps> = ({
  terminalId,
  isVisible,
  isFocused = false,
  terminal,
  allTerminals = [],
  showPaneHeader = false,
  onSelect,
  onClosePane,
  onZoomPane,
  onSwitchTerminal,
  className = "",
  style,
}) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const {
    containerRef,
    findNext,
    findPrevious,
    clearSearch,
    exportScrollback,
    searchResult,
  } = useTerminal(terminalId, isVisible, isFocused, () => {
    setIsSearchOpen((prev) => !prev);
  });

  // Hotkey listener for Ctrl+F when pane is focused
  useEffect(() => {
    if (!isVisible || !isFocused) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        setIsSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, isFocused]);

  const isAgent =
    terminal?.run_kind === "claude" ||
    terminal?.run_kind === "antigravity" ||
    terminal?.run_kind === "codex";

  const renderIcon = () => {
    return <AgentIcon kind={terminal?.run_kind} className="w-3.5 h-3.5 shrink-0" />;
  };

  const renderStatusBadge = () => {
    if (!terminal || !isAgent) return null;

    if (terminal.claude_status === "working") {
      return (
        <span className="flex items-center gap-1 text-[10px] text-[#58a6ff]">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          <span>{terminal.current_tool || "Working"}</span>
        </span>
      );
    }
    if (terminal.claude_status === "waiting") {
      return (
        <span className="flex items-center gap-1 text-[10px] text-[#d29922] font-semibold animate-pulse">
          <span className="text-xs leading-none">◆</span>
          <span>Waiting</span>
        </span>
      );
    }
    if (terminal.claude_status === "idle") {
      return (
        <span className="flex items-center gap-1 text-[10px] text-[#3fb950]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
          <span>Ready</span>
        </span>
      );
    }
    if (terminal.claude_status === "exited") {
      return (
        <span className="text-[10px] text-[#ff7b72] font-mono">
          Exited
        </span>
      );
    }
    return null;
  };

  return (
    <div
      onClick={onSelect}
      className={`overflow-hidden transition-all bg-[#0d1117] ${
        isVisible ? "flex flex-col" : "hidden"
      } ${
        showPaneHeader
          ? isFocused
            ? "ring-1 ring-[#58a6ff] border border-[#58a6ff]/70 rounded-md shadow-md"
            : "border border-[#30363d]/60 rounded-md"
          : "w-full h-full"
      } ${className}`}
      style={{
        display: isVisible ? "flex" : "none",
        ...style,
      }}
    >
      {/* Pane Header (only displayed in split/grid layout) */}
      {showPaneHeader && (
        <div
          className={`h-7 px-2.5 border-b border-[#30363d]/60 flex items-center justify-between text-xs select-none shrink-0 transition-colors ${
            isFocused ? "bg-[#21262d] text-white" : "bg-[#161b22] text-[#8b949e]"
          }`}
        >
          {/* Left: Terminal Selector / Name & Status */}
          <div className="flex items-center gap-2 min-w-0">
            {renderIcon()}

            {allTerminals.length > 1 && onSwitchTerminal ? (
              <select
                value={terminalId}
                onChange={(e) => onSwitchTerminal(e.target.value)}
                onClick={(e: MouseEvent<HTMLSelectElement>) => e.stopPropagation()}
                className="bg-transparent font-medium text-xs text-[#c9d1d9] hover:text-white border-none focus:outline-hidden cursor-pointer max-w-[140px] truncate"
              >
                {allTerminals.map((t) => (
                  <option key={t.id} value={t.id} className="bg-[#161b22] text-white">
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium truncate max-w-[140px] text-xs">
                {terminal?.name || terminalId}
              </span>
            )}

            {renderStatusBadge()}
          </div>

          {/* Right: Actions (Search, Focus indicator, Zoom, Close) */}
          <div className="flex items-center gap-1 shrink-0">
            {isFocused && (
              <span className="text-[10px] px-1 py-0.2 rounded bg-[#58a6ff]/20 text-[#58a6ff] font-mono font-medium">
                ACTIVE
              </span>
            )}

            {/* In-Pane Search Trigger */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsSearchOpen((prev) => !prev);
              }}
              className={`p-1 rounded transition-colors cursor-pointer ${
                isSearchOpen
                  ? "bg-[#58a6ff]/20 text-[#58a6ff]"
                  : "text-[#8b949e] hover:text-white hover:bg-[#30363d]"
              }`}
              title="Search terminal scrollback (Ctrl+F)"
            >
              <Search className="w-3 h-3" />
            </button>

            {onZoomPane && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onZoomPane();
                }}
                className="p-1 hover:bg-[#30363d] text-[#8b949e] hover:text-white rounded transition-colors cursor-pointer"
                title="Zoom pane (Ctrl+B z)"
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            )}

            {onClosePane && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClosePane();
                }}
                className="p-1 hover:bg-[#30363d] hover:text-[#ff7b72] text-[#8b949e] rounded transition-colors cursor-pointer"
                title="Close pane / Unsplit"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Terminal Viewport */}
      <div className="flex-1 w-full h-full min-h-0 relative overflow-hidden bg-[#0d1117] p-2">
        {/* Floating Search Bar */}
        <TerminalSearchBar
          isOpen={isSearchOpen}
          searchResult={searchResult}
          terminalName={terminal?.name}
          onFindNext={findNext}
          onFindPrevious={findPrevious}
          onClear={clearSearch}
          onClose={() => setIsSearchOpen(false)}
          onGetScrollback={exportScrollback}
        />
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
};
