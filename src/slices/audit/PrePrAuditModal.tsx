import { useState, useEffect, useCallback, FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AuditReport, AuditViolation } from "./types";
import {
  X,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  RotateCw,
  Sparkles,
  FileCode,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react";

interface PrePrAuditModalProps {
  isOpen: boolean;
  projectPath: string;
  projectName: string;
  onClose: () => void;
  onFixWithClaude?: (violations: AuditViolation[]) => void;
}

export const PrePrAuditModal: FC<PrePrAuditModalProps> = ({
  isOpen,
  projectPath,
  projectName,
  onClose,
  onFixWithClaude,
}) => {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<"all" | "blocker" | "warning">("all");

  const runAudit = useCallback(async () => {
    if (!projectPath) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await invoke<AuditReport>("run_pre_pr_audit", {
        projectPath,
        baseBranch: null,
      });
      setReport(res);
    } catch (err: any) {
      console.error("Failed to run pre-PR audit:", err);
      setError(err?.toString() || "Failed to execute git diff audit");
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (isOpen) {
      runAudit();
    }
  }, [isOpen, runAudit]);

  // Handle ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const violations = report?.violations || [];
  const filteredViolations = violations.filter((v) => {
    if (filterSeverity === "all") return true;
    return v.severity === filterSeverity;
  });

  const handleCopyReport = () => {
    if (!report) return;
    const lines = [
      `Pre-PR Audit Report for ${projectName}`,
      `Status: ${report.passed ? "PASSED" : "BLOCKED"}`,
      `Files Scanned: ${report.files_scanned}`,
      `Blockers: ${report.blocker_count} | Warnings: ${report.warning_count}`,
      "",
      ...report.violations.map(
        (v) =>
          `[${v.severity.toUpperCase()}] ${v.file_path}${
            v.line_number ? `:${v.line_number}` : ""
          }: ${v.message}${v.snippet ? `\n  Snippet: ${v.snippet}` : ""}`
      ),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFix = () => {
    if (onFixWithClaude && violations.length > 0) {
      onFixWithClaude(violations);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#30363d] flex items-center justify-between bg-[#0d1117]/80 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-md border ${
                report?.passed
                  ? "bg-[#3fb950]/15 text-[#3fb950] border-[#3fb950]/30"
                  : report?.blocker_count
                  ? "bg-[#f85149]/15 text-[#ff7b72] border-[#f85149]/30"
                  : "bg-[#d29922]/15 text-[#d29922] border-[#d29922]/30"
              }`}
            >
              {report?.passed ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">Pre-PR Audit Gate</h2>
                <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#58a6ff] font-mono">
                  {projectName}
                </span>
                {report && (
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded font-mono ${
                      report.passed
                        ? "bg-[#3fb950]/20 text-[#3fb950] border border-[#3fb950]/30"
                        : "bg-[#f85149]/20 text-[#ff7b72] border border-[#f85149]/30 animate-pulse"
                    }`}
                  >
                    {report.passed ? "PASSED" : "AUDIT BLOCKED"}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#8b949e] mt-0.5">
                Scans diff for leaked personal usernames, absolute paths, credentials, and untracked artifacts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={runAudit}
              disabled={isLoading}
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors disabled:opacity-50"
              title="Re-run audit"
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

        {/* Audit Summary Bar */}
        {report && (
          <div className="px-5 py-2.5 bg-[#0d1117] border-b border-[#30363d] flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-4">
              <span className="text-[#8b949e]">
                Files Scanned: <strong className="text-white font-mono">{report.files_scanned}</strong>
              </span>
              <span className="text-[#30363d]">|</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#ff7b72]" />
                <span className="text-[#8b949e]">
                  Blockers: <strong className="text-[#ff7b72] font-mono">{report.blocker_count}</strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#d29922]" />
                <span className="text-[#8b949e]">
                  Warnings: <strong className="text-[#d29922] font-mono">{report.warning_count}</strong>
                </span>
              </div>
            </div>

            {/* Filter severity tabs */}
            <div className="flex items-center gap-1 bg-[#161b22] border border-[#30363d] rounded p-0.5">
              <button
                type="button"
                onClick={() => setFilterSeverity("all")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  filterSeverity === "all" ? "bg-[#21262d] text-white" : "text-[#8b949e]"
                }`}
              >
                All ({violations.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterSeverity("blocker")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  filterSeverity === "blocker" ? "bg-[#21262d] text-[#ff7b72]" : "text-[#8b949e]"
                }`}
              >
                Blockers ({report.blocker_count})
              </button>
              <button
                type="button"
                onClick={() => setFilterSeverity("warning")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  filterSeverity === "warning" ? "bg-[#21262d] text-[#d29922]" : "text-[#8b949e]"
                }`}
              >
                Warnings ({report.warning_count})
              </button>
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && (
            <div className="p-3 rounded-md bg-[#f85149]/10 border border-[#f85149]/30 text-xs text-[#ff7b72] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-xs text-[#8b949e]">
              <RotateCw className="w-6 h-6 animate-spin text-[#58a6ff]" />
              <span>Analyzing git diff for username leaks, secrets, and artifacts...</span>
            </div>
          ) : report && violations.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              <div className="p-3 rounded-full bg-[#3fb950]/15 text-[#3fb950] border border-[#3fb950]/30">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-bold text-white">Clean Bill of Health!</h3>
              <p className="text-xs text-[#8b949e] max-w-md">
                No personal paths, secrets, API tokens, or untracked artifacts were found in this branch's diff. Ready for PR submission.
              </p>
            </div>
          ) : (
            filteredViolations.map((v, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-md border text-xs transition-colors ${
                  v.severity === "blocker"
                    ? "bg-[#f85149]/10 border-[#f85149]/30 text-[#c9d1d9]"
                    : "bg-[#d29922]/10 border-[#d29922]/30 text-[#c9d1d9]"
                }`}
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-[#30363d]/40">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded font-mono uppercase ${
                        v.severity === "blocker"
                          ? "bg-[#f85149]/20 text-[#ff7b72] border border-[#f85149]/40"
                          : "bg-[#d29922]/20 text-[#d29922] border border-[#d29922]/40"
                      }`}
                    >
                      {v.severity}
                    </span>
                    <span className="font-semibold text-white">{v.message}</span>
                  </div>

                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#8b949e]">
                    <FileCode className="w-3.5 h-3.5" />
                    <span>
                      {v.file_path}
                      {v.line_number ? `:${v.line_number}` : ""}
                    </span>
                  </div>
                </div>

                {v.snippet && (
                  <div className="mt-2 font-mono text-[11px] p-2 bg-[#0d1117] rounded border border-[#30363d]/60 overflow-x-auto text-[#e6edf3]">
                    <code>{v.snippet}</code>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-[#30363d] bg-[#0d1117] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={handleCopyReport}
            disabled={!report}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white text-xs font-medium border border-[#30363d] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#3fb950]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copied" : "Copy Report"}</span>
          </button>

          <div className="flex items-center gap-2">
            {violations.length > 0 && onFixWithClaude && (
              <button
                type="button"
                onClick={handleFix}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#58a6ff] hover:bg-[#4094f7] text-[#0d1117] font-bold text-xs transition-colors cursor-pointer shadow-md"
              >
                <Sparkles className="w-3.5 h-3.5 fill-current" />
                <span>Fix Violations with Claude</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white text-xs font-medium border border-[#30363d] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
