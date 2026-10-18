import { FC, CSSProperties, MouseEvent, useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTerminal } from "./useTerminal";
import { TerminalInfo, isAgentRunKind } from "./types";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { AgentIcon } from "./AgentIcons";
import {
  Maximize2,
  X,
  Loader2,
  Search,
  Play,
  RotateCw,
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
  onRelaunch?: () => void;
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
  onRelaunch,
  className = "",
  style,
}) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [a2aNotification, setA2aNotification] = useState<{
    fromName: string;
    content: string;
  } | null>(null);

  const isAgent = isAgentRunKind(terminal?.run_kind);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const unlistenDispatchedPromise = listen<{
      id: string;
      from_terminal: string;
      to_terminal: string;
      from_name?: string | null;
      to_name?: string | null;
      content: string;
    }>("a2a-message-dispatched", (event) => {
      if (event.payload.to_terminal === terminalId) {
        setA2aNotification({
          fromName: event.payload.from_name || event.payload.from_terminal,
          content: event.payload.content,
        });
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          setA2aNotification(null);
        }, 10000);
      }
    });

    const unlistenToastPromise = listen<string>("a2a-toast", (event) => {
      if (isAgent) {
        setA2aNotification({
          fromName: "Swarm Broadcast",
          content: event.payload,
        });
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          setA2aNotification(null);
        }, 10000);
      }
    });

    return () => {
      unlistenDispatchedPromise.then((unlisten) => unlisten());
      unlistenToastPromise.then((unlisten) => unlisten());
      if (timeout) clearTimeout(timeout);
    };
  }, [terminalId, isAgent]);

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => !prev);
  }, []);

  const {
    containerRef,
    findNext,
    findPrevious,
    clearSearch,
    exportScrollback,
    searchResult,
    focusTerminal,
    repaintTerminal,
  } = useTerminal(terminalId, isVisible, isFocused, handleToggleSearch);

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
      onClick={() => {
        onSelect?.();
        focusTerminal();
      }}
      onMouseDown={() => {
        focusTerminal();
      }}
      className={`overflow-hidden transition-colors bg-[#0d1117] ${
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
            {terminal?.permission_mode === "skip" && (
              <span className="text-[9px] px-1 py-0.2 rounded bg-[#ff7b72]/20 text-[#ff7b72] font-mono font-bold border border-[#ff7b72]/40" title="Bypassing tool permissions">
                SKIP
              </span>
            )}

            {isFocused && (
              <span className="text-[10px] px-1 py-0.2 rounded bg-[#58a6ff]/20 text-[#58a6ff] font-mono font-medium">
                ACTIVE
              </span>
            )}

            {/* Repaint / Redraw Terminal */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                repaintTerminal();
              }}
              className="p-1 rounded text-[#8b949e] hover:text-[#58a6ff] hover:bg-[#30363d] transition-colors cursor-pointer"
              title="Redraw terminal screen (Ctrl+L)"
            >
              <RotateCw className="w-3 h-3" />
            </button>

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

        {/* Incoming A2A Task Floating Banner */}
        {a2aNotification && (
          <div className="absolute top-2 left-2 right-2 z-20 flex items-center justify-between px-3 py-1.5 bg-[#161b22]/95 border border-[#1f6feb]/70 rounded shadow-lg backdrop-blur text-xs animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#58a6ff] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#58a6ff]" />
              </span>
              <span className="font-semibold text-[#58a6ff] shrink-0">
                Incoming A2A Task from {a2aNotification.fromName}:
              </span>
              <span className="text-[#c9d1d9] truncate font-mono text-[11px]">
                {a2aNotification.content}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setA2aNotification(null)}
              className="text-[#8b949e] hover:text-white p-0.5 rounded cursor-pointer shrink-0 ml-2"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Restored Dormant / Exited Session Ribbon */}
        {terminal?.claude_status === "exited" && (
          <div className="absolute top-2 left-2 right-2 z-20 flex items-center justify-between px-3 py-1.5 bg-[#161b22]/95 border border-[#30363d] rounded shadow-lg backdrop-blur text-xs">
            <div className="flex items-center gap-2 text-[#8b949e]">
              <span className="w-2 h-2 rounded-full bg-[#ff7b72] shrink-0" />
              <span className="font-medium text-[#c9d1d9]">Session Inactive</span>
              <span className="text-[11px] text-[#8b949e] hidden sm:inline">Scrollback restored from disk</span>
            </div>
            {onRelaunch && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRelaunch();
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-[#238636] hover:bg-[#2ea043] text-white font-medium rounded text-xs transition-colors cursor-pointer shadow-xs"
              >
                <Play className="w-3 h-3 fill-white" />
                <span>Relaunch Agent</span>
              </button>
            )}
          </div>
        )}

        <div
          ref={containerRef}
          tabIndex={-1}
          onClick={() => focusTerminal()}
          className="w-full h-full focus:outline-hidden"
        />
      </div>
    </div>
  );
};
