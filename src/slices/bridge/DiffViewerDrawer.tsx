import React, { useState, useMemo, useEffect } from "react";
import { Envelope } from "./useBridgeEvents";
import { TerminalInfo } from "../terminal/types";
import { computeLineDiff, FileChangeRecord } from "./diffUtils";
import { useOverlay } from "../overlay/useOverlay";
import {
  X,
  GitCompare,
  FileCode,
  Copy,
  Check,
  Search,
  Plus,
  Minus,
  Maximize2,
  Minimize2,
} from "lucide-react";

interface DiffViewerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  events: Envelope[];
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
}

export const DiffViewerDrawer: React.FC<DiffViewerDrawerProps> = ({
  isOpen,
  onClose,
  events,
  terminals,
  activeTerminalId,
}) => {
  const [selectedTerminalFilter, setSelectedTerminalFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [copiedPatch, setCopiedPatch] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Sync terminal filter on open if activeTerminalId provided
  useEffect(() => {
    if (isOpen && activeTerminalId) {
      setSelectedTerminalFilter("all");
    }
  }, [isOpen, activeTerminalId]);

  const { backdropProps, panelProps } = useOverlay({ isOpen, onClose });

  // Extract all file mutation events
  const fileChanges = useMemo<FileChangeRecord[]>(() => {
    const records: FileChangeRecord[] = [];

    // Filter events for tool execution with edit/write
    events.forEach((env, idx) => {
      const tool = (env.data?.tool || "").toLowerCase();
      const input = env.data?.input;

      if (!input || typeof input !== "object") return;

      const filePath = input.file_path || input.path || input.filePath;
      if (!filePath || typeof filePath !== "string") return;

      const isEdit =
        tool === "edit" ||
        tool.includes("edit") ||
        (input.old_string !== undefined && input.new_string !== undefined);
      const isWrite =
        tool === "write" ||
        tool.includes("write") ||
        (input.content !== undefined && !isEdit);

      if (!isEdit && !isWrite) return;

      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      const oldString = input.old_string ?? "";
      const newString = input.new_string ?? "";
      const content = input.content ?? "";

      let additions = 0;
      let deletions = 0;

      if (isEdit) {
        const diff = computeLineDiff(oldString, newString);
        additions = diff.additions;
        deletions = diff.deletions;
      } else if (isWrite) {
        additions = content ? content.split(/\r?\n/).length : 0;
        deletions = 0;
      }

      records.push({
        id: `change-${env.sessionId}-${env.seq}-${idx}`,
        filePath,
        fileName,
        tool: isEdit ? "Edit" : "Write",
        terminalId: env.tag || "unknown",
        ts: env.ts || Date.now(),
        oldString: isEdit ? oldString : undefined,
        newString: isEdit ? newString : undefined,
        content: isWrite ? content : undefined,
        additions,
        deletions,
      });
    });

    return records;
  }, [events]);

  // Filter changes
  const filteredChanges = useMemo(() => {
    return fileChanges.filter((change) => {
      if (selectedTerminalFilter !== "all" && change.terminalId !== selectedTerminalFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          change.fileName.toLowerCase().includes(q) ||
          change.filePath.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [fileChanges, selectedTerminalFilter, searchQuery]);

  // Keep selected change valid
  useEffect(() => {
    if (filteredChanges.length > 0) {
      if (!selectedChangeId || !filteredChanges.some((c) => c.id === selectedChangeId)) {
        setSelectedChangeId(filteredChanges[0].id);
      }
    } else {
      setSelectedChangeId(null);
    }
  }, [filteredChanges, selectedChangeId]);

  const selectedChange = useMemo(() => {
    return fileChanges.find((c) => c.id === selectedChangeId) || null;
  }, [fileChanges, selectedChangeId]);

  // Compute active diff lines for selected change
  const activeDiff = useMemo(() => {
    if (!selectedChange) return null;
    if (selectedChange.tool === "Edit") {
      return computeLineDiff(selectedChange.oldString || "", selectedChange.newString || "");
    }
    return null;
  }, [selectedChange]);

  // Copy full unified patch
  const handleCopyPatch = () => {
    if (!selectedChange) return;
    let patchText = `--- a/${selectedChange.filePath}\n+++ b/${selectedChange.filePath}\n`;

    if (activeDiff) {
      activeDiff.lines.forEach((l) => {
        if (l.type === "added") patchText += `+ ${l.content}\n`;
        else if (l.type === "removed") patchText += `- ${l.content}\n`;
        else patchText += `  ${l.content}\n`;
      });
    } else if (selectedChange.content) {
      patchText += selectedChange.content;
    }

    navigator.clipboard.writeText(patchText);
    setCopiedPatch(true);
    setTimeout(() => setCopiedPatch(false), 1500);
  };

  // Copy file path
  const handleCopyPath = () => {
    if (!selectedChange) return;
    navigator.clipboard.writeText(selectedChange.filePath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1500);
  };

  if (!isOpen) return null;

  const totalAdditions = fileChanges.reduce((acc, c) => acc + c.additions, 0);
  const totalDeletions = fileChanges.reduce((acc, c) => acc + c.deletions, 0);

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
    >
      <div
        {...panelProps}
        aria-label="Diff Inspector"
        className={`focus:outline-hidden bg-[#0d1117] border-l border-[#30363d] shadow-2xl flex flex-col h-full transition-all duration-200 ${
          isExpanded ? "w-full" : "w-full max-w-5xl"
        }`}
      >
        {/* Drawer Header */}
        <div className="h-12 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-md bg-[#3fb950]/15 text-[#3fb950] border border-[#3fb950]/30">
              <GitCompare className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">Visual Diff & File Changes</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#21262d] text-[#8b949e] font-mono">
                  {fileChanges.length} changes
                </span>
                {totalAdditions > 0 && (
                  <span className="text-[10px] text-[#3fb950] font-mono">+{totalAdditions}</span>
                )}
                {totalDeletions > 0 && (
                  <span className="text-[10px] text-[#f85149] font-mono">-{totalDeletions}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors"
              title={isExpanded ? "Restore width" : "Maximize drawer"}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
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

        {/* Main Content: Left Files List & Right Diff Viewer */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Column: Changed Files List */}
          <div className="w-80 border-r border-[#30363d] flex flex-col bg-[#161b22]/50 shrink-0">
            {/* Filter by Terminal & Search */}
            <div className="p-3 border-b border-[#30363d] space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter files..."
                  className="w-full pl-8 pr-2.5 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder-[#8b949e] focus:outline-hidden focus:border-[#58a6ff]"
                />
              </div>

              <select
                value={selectedTerminalFilter}
                onChange={(e) => setSelectedTerminalFilter(e.target.value)}
                className="w-full px-2 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-[#8b949e] font-mono"
              >
                <option value="all">All Terminals</option>
                {terminals.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-[#30363d]/40 p-1.5">
              {filteredChanges.length === 0 ? (
                <div className="py-12 px-4 text-center text-xs text-[#8b949e] space-y-2">
                  <FileCode className="w-8 h-8 text-[#30363d] mx-auto" />
                  <p>No file modifications recorded yet.</p>
                  <p className="text-[11px] text-[#484f58]">
                    When Claude agents execute Edit or Write tools, diffs will automatically appear here.
                  </p>
                </div>
              ) : (
                filteredChanges.map((change) => {
                  const isSelected = change.id === selectedChangeId;
                  const term = terminals.find((t) => t.id === change.terminalId);
                  return (
                    <button
                      key={change.id}
                      type="button"
                      onClick={() => setSelectedChangeId(change.id)}
                      className={`w-full text-left p-2.5 rounded-md cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-[#21262d] border border-[#58a6ff]/40 text-white"
                          : "text-[#c9d1d9] hover:bg-[#161b22]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileCode className="w-3.5 h-3.5 text-[#58a6ff] shrink-0" />
                          <span className="text-xs font-semibold truncate" title={change.filePath}>
                            {change.fileName}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-medium ${
                            change.tool === "Edit"
                              ? "bg-[#d29922]/20 text-[#d29922]"
                              : "bg-[#3fb950]/20 text-[#3fb950]"
                          }`}
                        >
                          {change.tool}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-[#8b949e] mt-1 font-mono">
                        <span className="truncate max-w-[150px]" title={change.filePath}>
                          {change.filePath}
                        </span>
                        <div className="flex items-center gap-1">
                          {change.additions > 0 && (
                            <span className="text-[#3fb950]">+{change.additions}</span>
                          )}
                          {change.deletions > 0 && (
                            <span className="text-[#f85149]">-{change.deletions}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-[#8b949e] mt-1 pt-1 border-t border-[#30363d]/30">
                        <span className="truncate">{term?.name || change.terminalId.slice(0, 8)}</span>
                        <span>{new Date(change.ts).toLocaleTimeString()}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Diff & Content Viewer */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#0d1117] overflow-hidden">
            {selectedChange ? (
              <>
                {/* File Header Bar */}
                <div className="h-10 px-4 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between text-xs shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-white truncate max-w-md font-mono text-xs">
                      {selectedChange.filePath}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyPath}
                      className="p-1 text-[#8b949e] hover:text-white rounded"
                      title="Copy File Path"
                    >
                      {copiedPath ? (
                        <Check className="w-3.5 h-3.5 text-[#3fb950]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* View Mode Switcher for Edits */}
                    {selectedChange.tool === "Edit" && (
                      <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded p-0.5">
                        <button
                          type="button"
                          onClick={() => setViewMode("unified")}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                            viewMode === "unified"
                              ? "bg-[#21262d] text-white"
                              : "text-[#8b949e] hover:text-[#c9d1d9]"
                          }`}
                        >
                          Unified
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode("split")}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                            viewMode === "split"
                              ? "bg-[#21262d] text-white"
                              : "text-[#8b949e] hover:text-[#c9d1d9]"
                          }`}
                        >
                          Side-by-Side
                        </button>
                      </div>
                    )}

                    {/* Copy Patch */}
                    <button
                      type="button"
                      onClick={handleCopyPatch}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-xs font-medium text-[#c9d1d9] border border-[#30363d] transition-colors"
                    >
                      {copiedPatch ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#3fb950]" />
                          <span>Copied Patch</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Patch</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Diff Viewer Body */}
                <div className="flex-1 overflow-auto font-mono text-xs select-text">
                  {selectedChange.tool === "Edit" && activeDiff ? (
                    viewMode === "unified" ? (
                      /* Unified Diff View */
                      <div className="divide-y divide-[#30363d]/20 min-w-full">
                        {activeDiff.lines.map((line, idx) => (
                          <div
                            key={idx}
                            className={`flex items-start py-0.5 px-3 leading-relaxed ${
                              line.type === "added"
                                ? "bg-[#3fb950]/15 text-[#7ee787]"
                                : line.type === "removed"
                                ? "bg-[#f85149]/15 text-[#ff7b72]"
                                : "text-[#c9d1d9] hover:bg-[#161b22]/50"
                            }`}
                          >
                            {/* Old Line # */}
                            <span className="w-10 text-right pr-3 select-none text-[#8b949e]/60 shrink-0">
                              {line.oldLineNumber || ""}
                            </span>
                            {/* New Line # */}
                            <span className="w-10 text-right pr-3 select-none text-[#8b949e]/60 shrink-0">
                              {line.newLineNumber || ""}
                            </span>
                            {/* +/- symbol */}
                            <span className="w-4 select-none font-bold shrink-0">
                              {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                            </span>
                            {/* Code text */}
                            <span className="whitespace-pre-wrap break-all flex-1">
                              {line.content || " "}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      /* Side-by-Side Split Diff View */
                      <div className="grid grid-cols-2 divide-x divide-[#30363d] h-full">
                        {/* Original */}
                        <div className="p-3 overflow-auto bg-[#161b22]/30">
                          <div className="text-[11px] font-semibold text-[#f85149] uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Minus className="w-3 h-3" />
                            <span>Original Content</span>
                          </div>
                          <pre className="whitespace-pre-wrap text-[#ff7b72] leading-relaxed bg-[#f85149]/5 p-2 rounded border border-[#f85149]/20">
                            {selectedChange.oldString || "(empty)"}
                          </pre>
                        </div>
                        {/* Modified */}
                        <div className="p-3 overflow-auto bg-[#161b22]/30">
                          <div className="text-[11px] font-semibold text-[#3fb950] uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Plus className="w-3 h-3" />
                            <span>Modified Content</span>
                          </div>
                          <pre className="whitespace-pre-wrap text-[#7ee787] leading-relaxed bg-[#3fb950]/5 p-2 rounded border border-[#3fb950]/20">
                            {selectedChange.newString || "(empty)"}
                          </pre>
                        </div>
                      </div>
                    )
                  ) : (
                    /* Full Written File View */
                    <div className="p-4">
                      <div className="text-xs text-[#8b949e] mb-2 font-mono flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#3fb950]/20 text-[#3fb950] font-semibold">
                          File Written
                        </span>
                        <span>{selectedChange.content?.length || 0} bytes</span>
                      </div>
                      <pre className="whitespace-pre-wrap bg-[#161b22] p-3 rounded-md border border-[#30363d] text-[#c9d1d9] leading-relaxed overflow-x-auto">
                        {selectedChange.content || "(empty file)"}
                      </pre>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-[#8b949e]">
                Select a file from the list to view diff
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
