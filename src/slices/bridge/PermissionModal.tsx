import { FC, useState, useEffect } from "react";
import {
  ShieldAlert,
  Check,
  X,
  Copy,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Command as CommandIcon,
  CheckCheck,
} from "lucide-react";
import { TerminalInfo } from "../terminal/types";

export interface PermissionRequestPayload {
  requestId: string;
  sessionId: string;
  tag?: string;
  tool: string;
  input: any;
  reason?: string;
}

interface PermissionModalProps {
  pendingRequests: PermissionRequestPayload[];
  terminals: TerminalInfo[];
  onResolve: (
    requestId: string,
    decision: "allow" | "deny",
    reason?: string,
    rememberForSession?: boolean
  ) => void;
}

export const PermissionModal: FC<PermissionModalProps> = ({
  pendingRequests,
  terminals,
  onResolve,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [denyReason, setDenyReason] = useState("");
  const [copied, setCopied] = useState(false);

  // Keep index within valid bounds
  useEffect(() => {
    if (currentIndex >= pendingRequests.length && pendingRequests.length > 0) {
      setCurrentIndex(pendingRequests.length - 1);
    }
  }, [pendingRequests.length, currentIndex]);

  if (pendingRequests.length === 0) return null;

  const currentReq = pendingRequests[currentIndex] || pendingRequests[0];
  const targetTerminal = terminals.find((t) => t.id === currentReq.tag);

  // Format tool arguments / payload
  const renderInputPayload = () => {
    const input = currentReq.input;
    if (!input) return <span className="text-[#8b949e] italic">No parameters provided</span>;

    if (currentReq.tool === "Bash" || currentReq.tool === "bash") {
      const cmd = typeof input === "object" ? input.command || JSON.stringify(input) : String(input);
      return (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
            Command to Execute:
          </div>
          <div className="p-3 bg-[#0d1117] border border-[#30363d] rounded-md font-mono text-xs text-[#58a6ff] overflow-x-auto whitespace-pre-wrap break-all">
            {cmd}
          </div>
        </div>
      );
    }

    if (currentReq.tool === "Edit" || currentReq.tool === "Write" || currentReq.tool === "edit") {
      const path = typeof input === "object" ? input.file_path || input.path || "" : "";
      const content =
        typeof input === "object"
          ? input.new_string || input.content || input.patch || JSON.stringify(input, null, 2)
          : String(input);
      return (
        <div className="space-y-2">
          {path && (
            <div className="flex items-center gap-1.5 text-xs text-[#c9d1d9] font-mono bg-[#0d1117] px-2.5 py-1.5 border border-[#30363d] rounded">
              <span className="text-[#8b949e]">Target:</span>
              <strong className="text-white">{path}</strong>
            </div>
          )}
          <div className="p-3 bg-[#0d1117] border border-[#30363d] rounded-md font-mono text-xs text-[#c9d1d9] max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
            {content}
          </div>
        </div>
      );
    }

    return (
      <div className="p-3 bg-[#0d1117] border border-[#30363d] rounded-md font-mono text-xs text-[#c9d1d9] max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
        {typeof input === "object" ? JSON.stringify(input, null, 2) : String(input)}
      </div>
    );
  };

  const copyPayload = () => {
    const raw =
      typeof currentReq.input === "object"
        ? currentReq.input.command || JSON.stringify(currentReq.input, null, 2)
        : String(currentReq.input);
    navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAllowOnce = () => {
    onResolve(currentReq.requestId, "allow", undefined, false);
    setDenyReason("");
  };

  const handleAllowForSession = () => {
    onResolve(currentReq.requestId, "allow", undefined, true);
    setDenyReason("");
  };

  const handleDeny = () => {
    const reason = denyReason.trim() || "User rejected tool execution";
    onResolve(currentReq.requestId, "deny", reason, false);
    setDenyReason("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in select-none">
      <div className="w-full max-w-lg bg-[#161b22] border border-[#d29922]/50 shadow-2xl rounded-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 bg-[#21262d] border-b border-[#30363d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-full bg-[#d29922]/20 text-[#d29922]">
              <ShieldAlert className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>Security Gatekeeper: Tool Approval</span>
                {targetTerminal && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-[#30363d] text-[#c9d1d9]">
                    {targetTerminal.name}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-[#8b949e]">
                Claude Code is waiting for permission before proceeding
              </p>
            </div>
          </div>

          {/* Queue Navigation if multiple requests */}
          {pendingRequests.length > 1 && (
            <div className="flex items-center gap-1.5 text-xs text-[#8b949e]">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                className="p-1 hover:bg-[#30363d] text-[#c9d1d9] disabled:opacity-30 rounded cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-mono text-[11px] text-white">
                {currentIndex + 1} of {pendingRequests.length}
              </span>
              <button
                type="button"
                disabled={currentIndex === pendingRequests.length - 1}
                onClick={() =>
                  setCurrentIndex((prev) => Math.min(pendingRequests.length - 1, prev + 1))
                }
                className="p-1 hover:bg-[#30363d] text-[#c9d1d9] disabled:opacity-30 rounded cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-3.5 text-xs">
          {/* Tool Badge & Description */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/30 font-mono text-xs font-semibold flex items-center gap-1.5">
                <CommandIcon className="w-3.5 h-3.5" />
                <span>Tool: {currentReq.tool}</span>
              </span>

              {currentReq.reason && (
                <span className="text-[#8b949e] italic truncate max-w-[260px]" title={currentReq.reason}>
                  "{currentReq.reason}"
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={copyPayload}
              className="flex items-center gap-1 text-[11px] text-[#8b949e] hover:text-white px-2 py-1 rounded hover:bg-[#30363d] transition-colors cursor-pointer"
              title="Copy payload to clipboard"
            >
              {copied ? (
                <>
                  <CheckCheck className="w-3.5 h-3.5 text-[#3fb950]" />
                  <span className="text-[#3fb950]">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* Payload Display */}
          {renderInputPayload()}

          {/* Optional Denial Reason input */}
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between text-[11px] text-[#8b949e]">
              <span>Feedback on Deny (optional):</span>
              <span className="text-[10px] text-[#6e7681]">Sent back to Claude</span>
            </div>
            <input
              type="text"
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder="e.g. Please avoid modifying production build files"
              className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-xs text-[#c9d1d9] focus:outline-hidden focus:border-[#58a6ff] placeholder:text-[#484f58]"
            />
          </div>
        </div>

        {/* Modal Actions */}
        <div className="px-4 py-3 bg-[#0d1117] border-t border-[#30363d] flex items-center justify-between">
          <button
            type="button"
            onClick={handleDeny}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#da3633] hover:bg-[#f85149] text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Deny</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAllowForSession}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] hover:border-[#58a6ff]/40 rounded-md text-xs font-semibold transition-colors cursor-pointer"
              title="Auto-approve this tool for the rest of this session"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Allow for Session</span>
            </button>

            <button
              type="button"
              onClick={handleAllowOnce}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md text-xs font-semibold transition-colors shadow-sm cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Allow Once</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
