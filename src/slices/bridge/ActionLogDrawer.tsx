import { useState, useMemo, FC } from "react";
import {
  X,
  Search,
  Copy,
  Check,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Terminal as TerminalIcon,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  Clock,
} from "lucide-react";
import { Envelope } from "./useBridgeEvents";

interface ActionLogDrawerProps {
  isOpen: boolean;
  terminalId: string | null;
  events: Envelope[];
  allEvents?: Envelope[];
  onClose: () => void;
}

interface ToolRecord {
  id: string;
  seq: number;
  ts: number;
  terminalId: string;
  tool: string;
  type: string;
  input: any;
  output?: any;
  error?: any;
  status: "running" | "success" | "error";
  durationMs?: number;
  isDestructive: boolean;
  raw: any;
}

export const ActionLogDrawer: FC<ActionLogDrawerProps> = ({
  isOpen,
  terminalId,
  events,
  allEvents = [],
  onClose,
}) => {
  const [scope, setScope] = useState<"current" | "all">("current");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "destructive" | "errors" | "bash" | "edit" | "search">("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState(false);

  // Determine source events based on scope
  const activeEventList = useMemo(() => {
    const list = scope === "current" ? events : allEvents.length > 0 ? allEvents : events;
    return list.filter((e) => e.type === "tool.started" || e.type === "tool.finished");
  }, [scope, events, allEvents]);

  const isDestructive = (input: any): boolean => {
    if (!input) return false;
    const str = (typeof input === "string" ? input : JSON.stringify(input)).toLowerCase();
    return (
      str.includes("rm -rf") ||
      str.includes("git push --force") ||
      str.includes("git push -f") ||
      str.includes("git reset --hard") ||
      str.includes("drop database") ||
      str.includes("drop table") ||
      str.includes("del /f") ||
      str.includes("format ") ||
      str.includes("rmdir /s")
    );
  };

  const isErrorPayload = (data: any): boolean => {
    if (!data) return false;
    if (data.is_error || data.isError || data.error) return true;
    if (typeof data.status === "string" && data.status.toLowerCase().includes("err")) return true;
    if (typeof data.output === "string" && (data.output.startsWith("Error:") || data.output.startsWith("panic:"))) {
      return true;
    }
    return false;
  };

  // Build normalized tool records
  const toolRecords: ToolRecord[] = useMemo(() => {
    return activeEventList.map((e, idx) => {
      const tool = e.data?.tool || (e.type === "tool.started" ? "Tool" : "Tool Finished");
      const destructive = isDestructive(e.data?.input);
      const isFinished = e.type === "tool.finished";
      const hasError = isErrorPayload(e.data);

      let status: "running" | "success" | "error" = "running";
      if (isFinished) {
        status = hasError ? "error" : "success";
      }

      return {
        id: `${e.sessionId}-${e.seq}-${idx}`,
        seq: e.seq,
        ts: e.ts,
        terminalId: e.tag || "unknown",
        tool,
        type: e.type,
        input: e.data?.input,
        output: e.data?.output || e.data?.result,
        error: e.data?.error,
        status,
        durationMs: e.data?.durationMs,
        isDestructive: destructive,
        raw: e,
      };
    });
  }, [activeEventList]);

  // Apply search query and category filters
  const filteredRecords = useMemo(() => {
    return toolRecords.filter((rec) => {
      // Category filter
      if (filterType === "destructive" && !rec.isDestructive) return false;
      if (filterType === "errors" && rec.status !== "error") return false;
      if (filterType === "bash" && !rec.tool.toLowerCase().includes("bash") && !rec.tool.toLowerCase().includes("cmd")) return false;
      if (filterType === "edit" && !rec.tool.toLowerCase().includes("edit") && !rec.tool.toLowerCase().includes("write")) return false;
      if (
        filterType === "search" &&
        !rec.tool.toLowerCase().includes("search") &&
        !rec.tool.toLowerCase().includes("glob") &&
        !rec.tool.toLowerCase().includes("grep") &&
        !rec.tool.toLowerCase().includes("read")
      ) {
        return false;
      }

      // Text search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const toolMatch = rec.tool.toLowerCase().includes(query);
        const tagMatch = rec.terminalId.toLowerCase().includes(query);
        const inputMatch = rec.input
          ? (typeof rec.input === "string" ? rec.input : JSON.stringify(rec.input)).toLowerCase().includes(query)
          : false;
        const outputMatch = rec.output
          ? (typeof rec.output === "string" ? rec.output : JSON.stringify(rec.output)).toLowerCase().includes(query)
          : false;
        const errorMatch = rec.error
          ? (typeof rec.error === "string" ? rec.error : JSON.stringify(rec.error)).toLowerCase().includes(query)
          : false;

        return toolMatch || tagMatch || inputMatch || outputMatch || errorMatch;
      }

      return true;
    });
  }, [toolRecords, filterType, searchQuery]);

  // Metrics
  const stats = useMemo(() => {
    let destructive = 0;
    let errors = 0;
    let bash = 0;
    let edit = 0;
    let search = 0;

    toolRecords.forEach((r) => {
      if (r.isDestructive) destructive++;
      if (r.status === "error") errors++;
      const lower = r.tool.toLowerCase();
      if (lower.includes("bash") || lower.includes("cmd")) bash++;
      if (lower.includes("edit") || lower.includes("write")) edit++;
      if (lower.includes("glob") || lower.includes("grep") || lower.includes("read") || lower.includes("search")) search++;
    });

    return { total: toolRecords.length, destructive, errors, bash, edit, search };
  }, [toolRecords]);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedCards((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const toggleExpandAll = () => {
    const next = !expandAll;
    setExpandAll(next);
    const map: Record<string, boolean> = {};
    toolRecords.forEach((r) => {
      map[r.id] = next;
    });
    setExpandedCards(map);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[560px] bg-[#161b22] border-l border-[#30363d] shadow-2xl flex flex-col text-[#c9d1d9] animate-in slide-in-from-right duration-150">
      {/* Header Bar */}
      <div className="h-14 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22] shrink-0">
        <div className="flex items-center gap-2.5">
          <TerminalIcon className="w-4 h-4 text-[#58a6ff]" />
          <div>
            <h2 className="text-sm font-semibold text-white leading-tight">Action Log Inspector</h2>
            <div className="flex items-center gap-2 text-[11px] text-[#8b949e]">
              <span>Telemetry Wire: <strong className="font-mono text-[#58a6ff]">v1</strong></span>
              <span>•</span>
              <span className="font-mono">{stats.total} total recorded</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Scope Selector */}
          <div className="flex items-center bg-[#0d1117] rounded-md p-0.5 border border-[#30363d] text-xs">
            <button
              onClick={() => setScope("current")}
              className={`px-2 py-0.5 rounded transition-colors ${
                scope === "current"
                  ? "bg-[#21262d] text-white font-medium shadow-xs"
                  : "text-[#8b949e] hover:text-[#c9d1d9]"
              }`}
              title={`Filtered to ${terminalId || "active"}`}
            >
              Current
            </button>
            <button
              onClick={() => setScope("all")}
              className={`px-2 py-0.5 rounded transition-colors ${
                scope === "all"
                  ? "bg-[#21262d] text-white font-medium shadow-xs"
                  : "text-[#8b949e] hover:text-[#c9d1d9]"
              }`}
              title="All active terminals"
            >
              All Agents
            </button>
          </div>

          <button
            onClick={onClose}
            className="text-[#8b949e] hover:text-white p-1.5 hover:bg-[#21262d] rounded transition-colors"
            title="Close Drawer (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Toolbar: Search & Filter Chips */}
      <div className="p-3 border-b border-[#30363d] bg-[#0d1117]/60 space-y-2.5 shrink-0">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tool names, commands, file paths, outputs..."
            className="w-full pl-8 pr-8 py-1.5 bg-[#161b22] border border-[#30363d] rounded-md text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#58a6ff] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8b949e] hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Chips & Expand All Toggle */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterType("all")}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                filterType === "all"
                  ? "bg-[#21262d] text-white border-[#58a6ff]"
                  : "bg-[#161b22] text-[#8b949e] border-[#30363d] hover:text-[#c9d1d9]"
              }`}
            >
              All ({toolRecords.length})
            </button>

            {stats.destructive > 0 && (
              <button
                onClick={() => setFilterType("destructive")}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1 ${
                  filterType === "destructive"
                    ? "bg-[#ff7b72]/20 text-[#ff7b72] border-[#ff7b72]"
                    : "bg-[#ff7b72]/10 text-[#ff7b72] border-[#ff7b72]/40 hover:bg-[#ff7b72]/20"
                }`}
              >
                <AlertOctagon className="w-3 h-3" />
                <span>Destructive ({stats.destructive})</span>
              </button>
            )}

            {stats.errors > 0 && (
              <button
                onClick={() => setFilterType("errors")}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1 ${
                  filterType === "errors"
                    ? "bg-[#f85149]/20 text-[#f85149] border-[#f85149]"
                    : "bg-[#f85149]/10 text-[#f85149] border-[#f85149]/40 hover:bg-[#f85149]/20"
                }`}
              >
                <AlertTriangle className="w-3 h-3" />
                <span>Errors ({stats.errors})</span>
              </button>
            )}

            {stats.bash > 0 && (
              <button
                onClick={() => setFilterType("bash")}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                  filterType === "bash"
                    ? "bg-[#1f6feb]/20 text-[#58a6ff] border-[#1f6feb]"
                    : "bg-[#161b22] text-[#8b949e] border-[#30363d] hover:text-[#c9d1d9]"
                }`}
              >
                Bash ({stats.bash})
              </button>
            )}

            {stats.edit > 0 && (
              <button
                onClick={() => setFilterType("edit")}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                  filterType === "edit"
                    ? "bg-[#a371f7]/20 text-[#d2a8ff] border-[#a371f7]"
                    : "bg-[#161b22] text-[#8b949e] border-[#30363d] hover:text-[#c9d1d9]"
                }`}
              >
                Edit ({stats.edit})
              </button>
            )}

            {stats.search > 0 && (
              <button
                onClick={() => setFilterType("search")}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                  filterType === "search"
                    ? "bg-[#238636]/20 text-[#3fb950] border-[#238636]"
                    : "bg-[#161b22] text-[#8b949e] border-[#30363d] hover:text-[#c9d1d9]"
                }`}
              >
                Search ({stats.search})
              </button>
            )}
          </div>

          <button
            onClick={toggleExpandAll}
            className="text-[11px] text-[#58a6ff] hover:underline whitespace-nowrap ml-2"
          >
            {expandAll ? "Collapse All" : "Expand All"}
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filteredRecords.length === 0 ? (
          <div className="text-center py-16 px-4 space-y-2">
            <Filter className="w-8 h-8 text-[#484f58] mx-auto mb-2" />
            <p className="text-sm text-white font-medium">
              {searchQuery || filterType !== "all" ? "No matching tool calls found" : "No tool calls recorded yet"}
            </p>
            <p className="text-xs text-[#8b949e]">
              {searchQuery || filterType !== "all"
                ? "Try adjusting your search query or selected filter chips."
                : "Tools executed by Claude Code will stream live into this inspector."}
            </p>
            {(searchQuery || filterType !== "all") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setFilterType("all");
                }}
                className="mt-2 px-2.5 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] text-white rounded transition-colors"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          filteredRecords.map((rec) => {
            const isCardExpanded = expandAll || !!expandedCards[rec.id];
            const rawJsonString = JSON.stringify(rec.raw, null, 2);

            let inputContent = "";
            if (rec.input) {
              if (typeof rec.input === "string") {
                inputContent = rec.input;
              } else if (typeof rec.input === "object" && rec.input.command) {
                inputContent = rec.input.command;
              } else {
                inputContent = JSON.stringify(rec.input, null, 2);
              }
            }

            let outputContent = "";
            if (rec.output) {
              outputContent = typeof rec.output === "string" ? rec.output : JSON.stringify(rec.output, null, 2);
            } else if (rec.error) {
              outputContent = typeof rec.error === "string" ? rec.error : JSON.stringify(rec.error, null, 2);
            }

            return (
              <div
                key={rec.id}
                className={`rounded-lg border text-xs transition-colors overflow-hidden ${
                  rec.isDestructive
                    ? "bg-[#ff7b72]/10 border-[#ff7b72]/60"
                    : rec.status === "error"
                    ? "bg-[#f85149]/10 border-[#f85149]/50"
                    : "bg-[#0d1117] border-[#30363d]"
                }`}
              >
                {/* Card Header Row */}
                <div
                  onClick={() => toggleExpand(rec.id)}
                  className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-[#161b22]/70 transition-colors select-none"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      className="text-[#8b949e] p-0.5 hover:text-white rounded"
                    >
                      {isCardExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Status Icon */}
                    {rec.isDestructive ? (
                      <AlertOctagon className="w-4 h-4 text-[#ff7b72] shrink-0" />
                    ) : rec.status === "error" ? (
                      <AlertTriangle className="w-4 h-4 text-[#f85149] shrink-0" />
                    ) : rec.status === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-[#3fb950] shrink-0" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-[#58a6ff] animate-spin shrink-0" />
                    )}

                    <span className="font-semibold text-white truncate">{rec.tool}</span>

                    {/* Destructive Warning Badge */}
                    {rec.isDestructive && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-[#ff7b72] text-black shrink-0">
                        DESTRUCTIVE
                      </span>
                    )}

                    {/* Terminal Tag */}
                    <span className="px-1.5 py-0.2 rounded bg-[#21262d] text-[#8b949e] font-mono text-[10px] shrink-0">
                      {rec.terminalId}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Duration Metric */}
                    {rec.durationMs !== undefined && (
                      <span className="flex items-center gap-0.5 text-[10px] text-[#8b949e] font-mono">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{rec.durationMs}ms</span>
                      </span>
                    )}

                    {/* Timestamp */}
                    <span className="text-[10px] text-[#8b949e] font-mono">
                      {new Date(rec.ts).toLocaleTimeString()}
                    </span>

                    {/* Copy Raw JSON Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(`json-${rec.id}`, rawJsonString);
                      }}
                      className="p-1 hover:bg-[#30363d] text-[#8b949e] hover:text-white rounded transition-colors"
                      title="Copy full JSON event"
                    >
                      {copiedKey === `json-${rec.id}` ? (
                        <Check className="w-3.5 h-3.5 text-[#3fb950]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Card Body (Collapsible or Preview) */}
                <div className={`px-3 pb-3 space-y-2 border-t border-[#30363d]/40 pt-2 ${isCardExpanded ? "block" : "hidden"}`}>
                  {/* Input Payload Block */}
                  {inputContent && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">
                        <span>Input / Arguments</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(`input-${rec.id}`, inputContent)}
                          className="flex items-center gap-1 text-[#58a6ff] hover:underline normal-case font-normal"
                        >
                          {copiedKey === `input-${rec.id}` ? (
                            <>
                              <Check className="w-3 h-3 text-[#3fb950]" />
                              <span className="text-[#3fb950]">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy Input</span>
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="p-2 bg-[#161b22] border border-[#30363d]/60 rounded-md font-mono text-[11px] overflow-x-auto text-[#c9d1d9] max-h-48 whitespace-pre-wrap break-all select-text">
                        {inputContent}
                      </pre>
                    </div>
                  )}

                  {/* Output Payload Block */}
                  {outputContent && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">
                        <span className={rec.status === "error" ? "text-[#f85149]" : ""}>
                          {rec.status === "error" ? "Error Output" : "Execution Result"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(`output-${rec.id}`, outputContent)}
                          className="flex items-center gap-1 text-[#58a6ff] hover:underline normal-case font-normal"
                        >
                          {copiedKey === `output-${rec.id}` ? (
                            <>
                              <Check className="w-3 h-3 text-[#3fb950]" />
                              <span className="text-[#3fb950]">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy Output</span>
                            </>
                          )}
                        </button>
                      </div>
                      <pre className={`p-2 rounded-md font-mono text-[11px] overflow-x-auto max-h-48 whitespace-pre-wrap break-all select-text border ${
                        rec.status === "error"
                          ? "bg-[#f85149]/10 text-[#ff7b72] border-[#f85149]/40"
                          : "bg-[#161b22] text-[#8b949e] border-[#30363d]/60"
                      }`}>
                        {outputContent}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info Strip */}
      <div className="px-4 py-2 border-t border-[#30363d] bg-[#161b22] flex items-center justify-between text-[11px] text-[#8b949e] shrink-0 font-mono">
        <span>Showing {filteredRecords.length} of {toolRecords.length} calls</span>
        <div className="flex items-center gap-3">
          {stats.destructive > 0 && (
            <span className="text-[#ff7b72]">
              {stats.destructive} destructive
            </span>
          )}
          <span>Wire protocol: claude-mod-events</span>
        </div>
      </div>
    </div>
  );
};
