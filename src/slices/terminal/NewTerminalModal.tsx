import { useState, useEffect } from "react";
import { Terminal, Shield, Sparkles, Command as CommandIcon, AlertTriangle, X } from "lucide-react";
import { RunKind, PermissionMode, SpawnTerminalRequest } from "./types";

interface NewTerminalModalProps {
  isOpen: boolean;
  projectPath: string;
  onClose: () => void;
  onSpawn: (request: SpawnTerminalRequest) => void;
}

export const NewTerminalModal: React.FC<NewTerminalModalProps> = ({
  isOpen,
  projectPath,
  onClose,
  onSpawn,
}) => {
  const [runKind, setRunKind] = useState<RunKind>("claude");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("skip");
  const [commandText, setCommandText] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey) {
        if (runKind === "command" && !commandText.trim()) {
          return;
        }
        handleSubmit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, runKind, permissionMode, commandText, name, projectPath]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    onSpawn({
      project_path: projectPath,
      run_kind: runKind,
      permission_mode: runKind === "claude" ? permissionMode : undefined,
      command_text: runKind === "command" ? commandText : undefined,
      name: name.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-[520px] bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-6 text-[#c9d1d9] animate-in fade-in zoom-in-95 duration-100">
        <div className="flex items-center justify-between pb-4 border-b border-[#30363d]">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-[#58a6ff]" />
            <h2 className="text-lg font-semibold text-white">New Terminal</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#8b949e] hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5 pt-4">
          {/* Run Kind Selection */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-2">
              Run Kind
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setRunKind("claude")}
                className={`flex flex-col items-center gap-2 p-3 rounded-md border text-sm font-medium transition-all ${
                  runKind === "claude"
                    ? "bg-[#1f6feb]/20 border-[#58a6ff] text-white shadow-sm"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <Sparkles className="w-5 h-5 text-[#f0883e]" />
                Claude Code
              </button>

              <button
                type="button"
                onClick={() => setRunKind("powershell")}
                className={`flex flex-col items-center gap-2 p-3 rounded-md border text-sm font-medium transition-all ${
                  runKind === "powershell"
                    ? "bg-[#1f6feb]/20 border-[#58a6ff] text-white shadow-sm"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <Terminal className="w-5 h-5 text-[#58a6ff]" />
                PowerShell
              </button>

              <button
                type="button"
                onClick={() => setRunKind("command")}
                className={`flex flex-col items-center gap-2 p-3 rounded-md border text-sm font-medium transition-all ${
                  runKind === "command"
                    ? "bg-[#1f6feb]/20 border-[#58a6ff] text-white shadow-sm"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <CommandIcon className="w-5 h-5 text-[#3fb950]" />
                Command
              </button>
            </div>
          </div>

          {/* Claude Code Permission Modes */}
          {runKind === "claude" && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-2">
                Permission Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPermissionMode("skip")}
                  className={`flex items-center gap-2 p-2.5 rounded-md border text-sm font-medium transition-all ${
                    permissionMode === "skip"
                      ? "bg-[#ff7b72]/15 border-[#ff7b72] text-[#ff7b72]"
                      : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e]"
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 text-[#ff7b72]" />
                  <span>Skip Permissions (Default)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPermissionMode("normal")}
                  className={`flex items-center gap-2 p-2.5 rounded-md border text-sm font-medium transition-all ${
                    permissionMode === "normal"
                      ? "bg-[#3fb950]/15 border-[#3fb950] text-[#3fb950]"
                      : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e]"
                  }`}
                >
                  <Shield className="w-4 h-4 text-[#3fb950]" />
                  <span>Normal Mode</span>
                </button>
              </div>

              {permissionMode === "skip" && (
                <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-[#ff7b72]/10 border border-[#ff7b72]/30 rounded text-xs text-[#ff7b72]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Claude runs tools and bash commands without asking.</span>
                </div>
              )}
            </div>
          )}

          {/* Command text for Command Kind */}
          {runKind === "command" && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-2">
                Command Line
              </label>
              <input
                type="text"
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                placeholder="e.g. git status, cargo test, npm run dev"
                autoFocus
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md text-sm text-white focus:outline-hidden focus:border-[#58a6ff] transition-colors"
              />
            </div>
          )}

          {/* Optional Name */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-2">
              Terminal Label (Optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Architect, API Server, Vitest Watcher"
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md text-sm text-white focus:outline-hidden focus:border-[#58a6ff] transition-colors"
            />
          </div>

          <div className="text-xs text-[#8b949e] font-mono">
            Working directory: <span className="text-[#c9d1d9]">{projectPath}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[#30363d]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#8b949e] hover:text-white transition-colors"
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-sm font-medium rounded-md shadow-sm transition-colors"
          >
            Start Terminal (Enter)
          </button>
        </div>
      </div>
    </div>
  );
};
