import { useState, useEffect, useCallback, useMemo, FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ClaudeSessionSummary } from "./types";
import { useOverlay } from "../overlay/useOverlay";
import {
  X,
  History,
  RotateCw,
  Search,
  Play,
  Copy,
  Check,
  Folder,
  MessageSquare,
  Clock,
} from "lucide-react";

interface SessionHistoryDrawerProps {
  isOpen: boolean;
  activeProject: string;
  onClose: () => void;
  onResumeSession: (sessionId: string, projectPath: string) => void;
}

export const SessionHistoryDrawer: FC<SessionHistoryDrawerProps> = ({
  isOpen,
  activeProject,
  onClose,
  onResumeSession,
}) => {
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCurrentOnly, setFilterCurrentOnly] = useState(true);
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await invoke<ClaudeSessionSummary[]>("list_claude_sessions", {
        projectPath: filterCurrentOnly ? activeProject : null,
        limit: 100,
      });
      setSessions(list || []);
    } catch (err) {
      console.error("Failed to load Claude sessions:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeProject, filterCurrentOnly]);

  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen, loadSessions]);

  const { backdropProps, panelProps } = useOverlay({ isOpen, onClose });

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.session_id.toLowerCase().includes(q) ||
        s.last_prompt.toLowerCase().includes(q) ||
        s.project_path.toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedSessionId(id);
    setTimeout(() => setCopiedSessionId(null), 1800);
  };

  const formatTimestamp = (ts: number) => {
    if (!ts) return "Unknown";
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return `Today at ${timeStr}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeStr}`;
  };

  if (!isOpen) return null;

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
    >
      <div
        {...panelProps}
        aria-label="Claude Session History"
        className="focus:outline-hidden w-full max-w-2xl bg-[#0d1117] border-l border-[#30363d] shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="h-12 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-md bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/30">
              <History className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">Claude Session History</h2>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#21262d] text-[#8b949e] font-mono">
                  {sessions.length} sessions
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={loadSessions}
              disabled={isLoading}
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors disabled:opacity-50"
              title="Refresh sessions"
            >
              <RotateCw className={`w-4 h-4 ${isLoading ? "animate-spin text-[#58a6ff]" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between text-xs gap-3 shrink-0">
          <div className="flex items-center gap-1 bg-[#0d1117] border border-[#30363d] rounded p-0.5">
            <button
              type="button"
              onClick={() => setFilterCurrentOnly(true)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filterCurrentOnly
                  ? "bg-[#21262d] text-white shadow-xs font-semibold"
                  : "text-[#8b949e] hover:text-[#c9d1d9]"
              }`}
            >
              Active Workspace
            </button>
            <button
              type="button"
              onClick={() => setFilterCurrentOnly(false)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                !filterCurrentOnly
                  ? "bg-[#21262d] text-white shadow-xs font-semibold"
                  : "text-[#8b949e] hover:text-[#c9d1d9]"
              }`}
            >
              All Workspaces
            </button>
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompts or session IDs..."
              className="w-full pl-8 pr-2.5 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder-[#8b949e] focus:outline-hidden focus:border-[#58a6ff]"
            />
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-[#8b949e]">
              <RotateCw className="w-5 h-5 animate-spin text-[#58a6ff]" />
              <span>Scanning Claude Code history...</span>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#8b949e]">
              No past Claude sessions found matching filter.
            </div>
          ) : (
            filteredSessions.map((session) => {
              const projName =
                session.project_path.split(/[/\\]/).filter(Boolean).pop() || "Workspace";

              return (
                <div
                  key={session.session_id}
                  className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff]/50 transition-all flex flex-col gap-2 group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate" title={session.last_prompt}>
                        {session.last_prompt || "Claude Interactive Session"}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-[#8b949e]">
                        <span className="flex items-center gap-1 font-mono text-[#58a6ff]" title={session.project_path}>
                          <Folder className="w-3 h-3" />
                          <span>{projName}</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatTimestamp(session.timestamp_ms)}</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 font-mono">
                          <MessageSquare className="w-3 h-3" />
                          <span>{session.message_count} msgs</span>
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onResumeSession(session.session_id, session.project_path)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold transition-colors shadow-xs shrink-0 cursor-pointer"
                      title={`Resume session ${session.session_id} in Claude Code`}
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Resume</span>
                    </button>
                  </div>

                  {/* Session ID Pill and quick copy */}
                  <div className="flex items-center justify-between pt-1 border-t border-[#30363d]/50 text-[10px] text-[#8b949e]">
                    <div className="flex items-center gap-1 font-mono">
                      <span>ID:</span>
                      <span className="text-[#c9d1d9]">{session.session_id}</span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleCopyId(session.session_id, e)}
                      className="flex items-center gap-1 hover:text-white transition-colors"
                      title="Copy full Session ID"
                    >
                      {copiedSessionId === session.session_id ? (
                        <>
                          <Check className="w-3 h-3 text-[#3fb950]" />
                          <span className="text-[#3fb950]">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy ID</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
