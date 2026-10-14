import React, { useState, useEffect } from "react";
import { Project } from "./types";
import {
  X,
  Settings,
  Plus,
  Trash2,
  FolderGit2,
  Eye,
  EyeOff,
  Save,
  Terminal,
  Variable,
  Check,
} from "lucide-react";

interface WorkspaceSettingsModalProps {
  isOpen: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (
    path: string,
    envVars: Record<string, string>,
    defaultFlags?: string | null
  ) => Promise<void>;
}

interface EnvRow {
  id: string;
  key: string;
  value: string;
  masked: boolean;
}

const COMMON_FLAGS = [
  { label: "Claude 3.7 Sonnet", flag: "--model claude-3-7-sonnet-20250219" },
  { label: "Skip Permissions", flag: "--dangerously-skip-permissions" },
  { label: "Verbose", flag: "--verbose" },
  { label: "Print Output", flag: "--print" },
];

const SUGGESTED_KEYS = [
  "ANTHROPIC_API_KEY",
  "NODE_ENV",
  "DEBUG",
  "CLAUDE_LOG_LEVEL",
  "HTTP_PROXY",
  "CARGO_TERM_COLOR",
];

export const WorkspaceSettingsModal: React.FC<WorkspaceSettingsModalProps> = ({
  isOpen,
  project,
  onClose,
  onSave,
}) => {
  const [defaultFlags, setDefaultFlags] = useState("");
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setDefaultFlags(project.default_flags || "");
      const rows: EnvRow[] = Object.entries(project.env_vars || {}).map(
        ([key, value], idx) => ({
          id: `env-${idx}-${Date.now()}`,
          key,
          value,
          masked: key.toUpperCase().includes("KEY") || key.toUpperCase().includes("SECRET") || key.toUpperCase().includes("TOKEN"),
        })
      );
      setEnvRows(rows);
      setError(null);
      setSavedSuccess(false);
    }
  }, [project, isOpen]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !project) return null;

  const handleAddRow = () => {
    setEnvRows((prev) => [
      ...prev,
      {
        id: `env-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        key: "",
        value: "",
        masked: false,
      },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    setEnvRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleRowChange = (id: string, field: "key" | "value", val: string) => {
    setEnvRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: val };
        if (field === "key") {
          const upper = val.toUpperCase();
          if (upper.includes("KEY") || upper.includes("SECRET") || upper.includes("TOKEN")) {
            updated.masked = true;
          }
        }
        return updated;
      })
    );
  };

  const toggleMask = (id: string) => {
    setEnvRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, masked: !r.masked } : r))
    );
  };

  const handleAppendFlag = (flag: string) => {
    setDefaultFlags((prev) => {
      if (!prev) return flag;
      if (prev.includes(flag)) return prev;
      return `${prev.trim()} ${flag}`;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const envRecord: Record<string, string> = {};
      for (const row of envRows) {
        const trimmedKey = row.key.trim();
        if (trimmedKey) {
          envRecord[trimmedKey] = row.value;
        }
      }

      await onSave(
        project.path,
        envRecord,
        defaultFlags.trim() ? defaultFlags.trim() : null
      );

      setSavedSuccess(true);
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err: any) {
      setError(err?.toString() || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#30363d] flex items-center justify-between bg-[#0d1117]/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-[#58a6ff]/10 text-[#58a6ff] border border-[#58a6ff]/20">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Workspace Settings</span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#58a6ff] font-mono font-normal">
                  {project.name}
                </span>
              </h2>
              <div className="flex items-center gap-1.5 text-xs text-[#8b949e] mt-0.5 font-mono truncate max-w-lg">
                <FolderGit2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate" title={project.path}>
                  {project.path}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-6">
          {error && (
            <div className="p-3 text-xs bg-[#f85149]/10 border border-[#f85149]/30 text-[#ff7b72] rounded-md">
              {error}
            </div>
          )}

          {/* Section 1: Default CLI Launch Flags */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#c9d1d9] flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#58a6ff]" />
                <span>Default Claude CLI Flags</span>
              </label>
              <span className="text-[11px] text-[#8b949e]">
                Appended when spawning sessions in this workspace
              </span>
            </div>

            <input
              type="text"
              value={defaultFlags}
              onChange={(e) => setDefaultFlags(e.target.value)}
              placeholder="e.g. --model claude-3-7-sonnet-20250219 --dangerously-skip-permissions"
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md text-xs font-mono text-[#c9d1d9] placeholder-[#484f58] focus:outline-hidden focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff]"
            />

            {/* Quick Flag Badges */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] text-[#8b949e] mr-1">Quick add:</span>
              {COMMON_FLAGS.map((f) => (
                <button
                  key={f.flag}
                  type="button"
                  onClick={() => handleAppendFlag(f.flag)}
                  className="px-2 py-0.5 rounded text-[11px] bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#58a6ff] font-mono border border-[#30363d] transition-colors"
                >
                  +{f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Section 2: Environment Variables */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-[#c9d1d9] flex items-center gap-1.5">
                  <Variable className="w-3.5 h-3.5 text-[#3fb950]" />
                  <span>Workspace Environment Variables</span>
                </label>
                <p className="text-[11px] text-[#8b949e] mt-0.5">
                  Injected into the ConPTY process for Claude Code and PowerShell sessions
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddRow}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] hover:text-white rounded border border-[#30363d] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Variable</span>
              </button>
            </div>

            {/* Suggested Keys */}
            {envRows.length === 0 && (
              <div className="p-3 bg-[#0d1117] border border-[#30363d] rounded-md text-xs text-[#8b949e] space-y-2">
                <p>No environment variables configured yet. Click "Add Variable" or pick a suggestion:</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setEnvRows((prev) => [
                          ...prev,
                          {
                            id: `env-${Date.now()}-${k}`,
                            key: k,
                            value: "",
                            masked: k.includes("KEY") || k.includes("SECRET"),
                          },
                        ]);
                      }}
                      className="px-2 py-0.5 rounded bg-[#161b22] hover:bg-[#21262d] text-[#c9d1d9] font-mono text-[11px] border border-[#30363d]"
                    >
                      +{k}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Rows Table */}
            {envRows.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {envRows.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    {/* Key Input */}
                    <input
                      type="text"
                      value={row.key}
                      onChange={(e) => handleRowChange(row.id, "key", e.target.value)}
                      placeholder="VARIABLE_NAME"
                      className="w-1/3 px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-xs font-mono text-[#58a6ff] placeholder-[#484f58] focus:outline-hidden focus:border-[#58a6ff]"
                    />

                    {/* Value Input */}
                    <div className="flex-1 relative">
                      <input
                        type={row.masked ? "password" : "text"}
                        value={row.value}
                        onChange={(e) => handleRowChange(row.id, "value", e.target.value)}
                        placeholder="value..."
                        className="w-full px-2.5 py-1.5 pr-8 bg-[#0d1117] border border-[#30363d] rounded text-xs font-mono text-[#c9d1d9] placeholder-[#484f58] focus:outline-hidden focus:border-[#58a6ff]"
                      />
                      <button
                        type="button"
                        onClick={() => toggleMask(row.id)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8b949e] hover:text-white"
                        title={row.masked ? "Show value" : "Hide value"}
                      >
                        {row.masked ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* Delete Row Button */}
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(row.id)}
                      className="p-1.5 text-[#8b949e] hover:text-[#f85149] hover:bg-[#21262d] rounded transition-colors"
                      title="Remove variable"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-[#30363d] flex items-center justify-between">
            <span className="text-[11px] text-[#8b949e]">
              Saved to <code className="text-[#c9d1d9]">%LOCALAPPDATA%\Quay2\workspaces.json</code>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d] rounded-md transition-colors"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSaving}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md shadow-sm transition-colors ${
                  savedSuccess
                    ? "bg-[#3fb950] text-[#0d1117]"
                    : "bg-[#238636] hover:bg-[#2ea043] text-white"
                }`}
              >
                {savedSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? "Saving..." : "Save Workspace"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
