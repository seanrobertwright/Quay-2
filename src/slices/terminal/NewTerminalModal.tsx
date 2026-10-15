import { useState, useEffect } from "react";
import { Terminal, Shield, AlertTriangle, X, Sliders } from "lucide-react";
import { RunKind, PermissionMode, SpawnTerminalRequest } from "./types";
import { ClaudeIcon, AntigravityIcon, CodexIcon, PowerShellIcon, CommandIcon } from "./AgentIcons";

interface NewTerminalModalProps {
  isOpen: boolean;
  projectPath: string;
  onClose: () => void;
  onSpawn: (request: SpawnTerminalRequest) => void;
}

const AGENT_MODELS: Record<"claude" | "antigravity" | "codex", { label: string; value: string }[]> = {
  claude: [
    { label: "Default (Claude 3.7 Sonnet)", value: "" },
    { label: "Claude 3.7 Sonnet", value: "--model claude-3-7-sonnet-20250219" },
    { label: "Claude 3.5 Sonnet", value: "--model claude-3-5-sonnet-20241022" },
    { label: "Claude 3.5 Haiku", value: "--model claude-3-5-haiku-20241022" },
  ],
  antigravity: [
    { label: "Default (Gemini 2.5 Pro)", value: "" },
    { label: "Gemini 2.5 Pro", value: "--model gemini-2.5-pro" },
    { label: "Gemini 2.5 Flash", value: "--model gemini-2.5-flash" },
    { label: "Gemini 3.8 Flash (High)", value: "--model gemini-3.8-flash --effort high" },
  ],
  codex: [
    { label: "Default (o3)", value: "" },
    { label: "o3 (Deep Reasoning)", value: "-m o3" },
    { label: "o4-mini (Fast Reasoning)", value: "-m o4-mini" },
    { label: "GPT-4.1", value: "-m gpt-4.1" },
    { label: "GPT-4o", value: "-m gpt-4o" },
  ],
};

export const NewTerminalModal: React.FC<NewTerminalModalProps> = ({
  isOpen,
  projectPath,
  onClose,
  onSpawn,
}) => {
  const [runKind, setRunKind] = useState<RunKind>("claude");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("skip");
  const [selectedModelFlag, setSelectedModelFlag] = useState<string>("");
  const [customFlags, setCustomFlags] = useState("");
  const [commandText, setCommandText] = useState("");
  const [name, setName] = useState("");

  const isAgent = runKind === "claude" || runKind === "antigravity" || runKind === "codex";

  // Reset model flag when switching agent kinds
  useEffect(() => {
    setSelectedModelFlag("");
  }, [runKind]);

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
  }, [isOpen, runKind, permissionMode, commandText, name, projectPath, selectedModelFlag, customFlags]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const mergedFlags = [selectedModelFlag, customFlags].filter(Boolean).join(" ").trim() || undefined;

    onSpawn({
      project_path: projectPath,
      run_kind: runKind,
      permission_mode: isAgent ? permissionMode : undefined,
      command_text: runKind === "command" ? commandText : undefined,
      custom_flags: mergedFlags,
      name: name.trim() || undefined,
    });
    onClose();
  };

  const getAgentLabel = () => {
    switch (runKind) {
      case "claude":
        return "Claude Code (Anthropic)";
      case "antigravity":
        return "Antigravity CLI (Google)";
      case "codex":
        return "Codex CLI (OpenAI)";
      default:
        return "Agent";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-[580px] bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-6 text-[#c9d1d9] animate-in fade-in zoom-in-95 duration-100">
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

        <div className="space-y-4 pt-4">
          {/* Run Kind Selection with Official Icons */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-2">
              Agent / Shell Type
            </label>
            <div className="grid grid-cols-5 gap-2">
              {/* Claude Code */}
              <button
                type="button"
                onClick={() => setRunKind("claude")}
                className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-md border text-xs font-medium transition-all ${
                  runKind === "claude"
                    ? "bg-[#f0883e]/15 border-[#f0883e] text-white shadow-sm ring-1 ring-[#f0883e]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <ClaudeIcon className={`w-5 h-5 ${runKind === "claude" ? "text-[#f0883e]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Claude</span>
                <span className="text-[10px] text-[#8b949e] scale-90">Anthropic</span>
              </button>

              {/* Antigravity CLI */}
              <button
                type="button"
                onClick={() => setRunKind("antigravity")}
                className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-md border text-xs font-medium transition-all ${
                  runKind === "antigravity"
                    ? "bg-[#38bdf8]/15 border-[#38bdf8] text-white shadow-sm ring-1 ring-[#38bdf8]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <AntigravityIcon className={`w-5 h-5 ${runKind === "antigravity" ? "text-[#38bdf8]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Antigravity</span>
                <span className="text-[10px] text-[#8b949e] scale-90">Google</span>
              </button>

              {/* Codex CLI */}
              <button
                type="button"
                onClick={() => setRunKind("codex")}
                className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-md border text-xs font-medium transition-all ${
                  runKind === "codex"
                    ? "bg-[#10a37f]/15 border-[#10a37f] text-white shadow-sm ring-1 ring-[#10a37f]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <CodexIcon className={`w-5 h-5 ${runKind === "codex" ? "text-[#10a37f]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Codex</span>
                <span className="text-[10px] text-[#8b949e] scale-90">OpenAI</span>
              </button>

              {/* PowerShell */}
              <button
                type="button"
                onClick={() => setRunKind("powershell")}
                className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-md border text-xs font-medium transition-all ${
                  runKind === "powershell"
                    ? "bg-[#58a6ff]/15 border-[#58a6ff] text-white shadow-sm ring-1 ring-[#58a6ff]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <PowerShellIcon className={`w-5 h-5 ${runKind === "powershell" ? "text-[#58a6ff]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">PowerShell</span>
                <span className="text-[10px] text-[#8b949e] scale-90">Console</span>
              </button>

              {/* Custom Command */}
              <button
                type="button"
                onClick={() => setRunKind("command")}
                className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-md border text-xs font-medium transition-all ${
                  runKind === "command"
                    ? "bg-[#3fb950]/15 border-[#3fb950] text-white shadow-sm ring-1 ring-[#3fb950]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <CommandIcon className={`w-5 h-5 ${runKind === "command" ? "text-[#3fb950]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Command</span>
                <span className="text-[10px] text-[#8b949e] scale-90">Script</span>
              </button>
            </div>
          </div>

          {/* AI Agent Options (Claude, Antigravity, Codex) */}
          {isAgent && (
            <div className="space-y-3 p-3 bg-[#0d1117] border border-[#30363d] rounded-md">
              {/* Permission Modes */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-1.5">
                  Permission Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPermissionMode("skip")}
                    className={`flex items-center gap-2 p-2 rounded-md border text-xs font-medium transition-all ${
                      permissionMode === "skip"
                        ? "bg-[#ff7b72]/15 border-[#ff7b72] text-[#ff7b72]"
                        : "bg-[#161b22] border-[#30363d] text-[#8b949e] hover:border-[#8b949e]"
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-[#ff7b72] shrink-0" />
                    <span>Skip Permissions (Default)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPermissionMode("normal")}
                    className={`flex items-center gap-2 p-2 rounded-md border text-xs font-medium transition-all ${
                      permissionMode === "normal"
                        ? "bg-[#3fb950]/15 border-[#3fb950] text-[#3fb950]"
                        : "bg-[#161b22] border-[#30363d] text-[#8b949e] hover:border-[#8b949e]"
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />
                    <span>Interactive Approvals</span>
                  </button>
                </div>

                {permissionMode === "skip" && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-[#ff7b72]">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{getAgentLabel()} executes shell tools and edits autonomously.</span>
                  </div>
                )}
              </div>

              {/* Model Preset Selection */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-1">
                  Model Architecture
                </label>
                <select
                  value={selectedModelFlag}
                  onChange={(e) => setSelectedModelFlag(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-white focus:outline-hidden focus:border-[#58a6ff]"
                >
                  {AGENT_MODELS[runKind as keyof typeof AGENT_MODELS]?.map((m) => (
                    <option key={m.label} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Extra CLI Flags */}
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-1 flex items-center gap-1">
                  <Sliders className="w-3 h-3" />
                  <span>Custom CLI Arguments (Optional)</span>
                </label>
                <input
                  type="text"
                  value={customFlags}
                  onChange={(e) => setCustomFlags(e.target.value)}
                  placeholder={
                    runKind === "antigravity"
                      ? "e.g. --mode auto --effort max"
                      : runKind === "codex"
                      ? "e.g. --search -s danger-full-access"
                      : "e.g. --verbose"
                  }
                  className="w-full px-2.5 py-1 bg-[#161b22] border border-[#30363d] rounded text-xs text-white placeholder-[#8b949e] font-mono focus:outline-hidden focus:border-[#58a6ff]"
                />
              </div>
            </div>
          )}

          {/* Command text for Command Kind */}
          {runKind === "command" && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-1.5">
                Command Line
              </label>
              <input
                type="text"
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                placeholder="e.g. git status, cargo test, npm run dev"
                autoFocus
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md text-xs text-white focus:outline-hidden focus:border-[#58a6ff] transition-colors"
              />
            </div>
          )}

          {/* Optional Name */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-1">
              Terminal Label (Optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${
                runKind === "antigravity"
                  ? "Architect / Planner"
                  : runKind === "codex"
                  ? "Code Reviewer"
                  : runKind === "claude"
                  ? "Feature Implementer"
                  : "Build Watcher"
              }`}
              className="w-full px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-xs text-white focus:outline-hidden focus:border-[#58a6ff] transition-colors"
            />
          </div>

          <div className="text-[11px] text-[#8b949e] font-mono">
            Working directory: <span className="text-[#c9d1d9]">{projectPath}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 mt-5 pt-3 border-t border-[#30363d]">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs text-[#8b949e] hover:text-white transition-colors"
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold rounded-md shadow-sm transition-colors"
          >
            Start Terminal (Enter)
          </button>
        </div>
      </div>
    </div>
  );
};
