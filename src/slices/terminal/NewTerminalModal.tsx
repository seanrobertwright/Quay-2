import { useState, useEffect, useId } from "react";
import { Terminal, Shield, AlertTriangle, X, Sliders } from "lucide-react";
import { RunKind, PermissionMode, SpawnTerminalRequest, isAgentRunKind } from "./types";
import {
  ClaudeIcon,
  AntigravityIcon,
  CodexIcon,
  PiIcon,
  GeminiIcon,
  GrokIcon,
  AiderIcon,
  KiroIcon,
  CopilotIcon,
  OpenCodeIcon,
  PowerShellIcon,
  CommandIcon,
} from "./AgentIcons";

interface NewTerminalModalProps {
  isOpen: boolean;
  projectPath: string;
  onClose: () => void;
  onSpawn: (request: SpawnTerminalRequest) => void;
}

interface ModelOption {
  label: string;
  /** CLI flags passed verbatim; "" means the agent's own default. */
  value: string;
  /** Renders as an <optgroup>; options without a group come first. */
  group?: string;
}

// Claude Code model ids. Retired ids (Claude 3.x) make Claude Code fail its first request
// and fall back to the account default, so only ids the API still serves belong here.
const CLAUDE_MODELS: ModelOption[] = [
  { label: "Default (your Claude Code /model setting)", value: "" },
  { label: "Claude Fable 5.1 (most capable)", value: "--model claude-fable-5-1", group: "Current" },
  { label: "Claude Opus 5.5", value: "--model claude-opus-5-5", group: "Current" },
  { label: "Claude Sonnet 5.5", value: "--model claude-sonnet-5-5", group: "Current" },
  { label: "Claude Haiku 5.5", value: "--model claude-haiku-5-5", group: "Current" },
  { label: "Latest Fable (alias: fable)", value: "--model fable", group: "Aliases (track the latest)" },
  { label: "Latest Opus (alias: opus)", value: "--model opus", group: "Aliases (track the latest)" },
  { label: "Latest Sonnet (alias: sonnet)", value: "--model sonnet", group: "Aliases (track the latest)" },
  { label: "Latest Haiku (alias: haiku)", value: "--model haiku", group: "Aliases (track the latest)" },
  { label: "Claude Fable 5", value: "--model claude-fable-5", group: "Previous generations" },
  { label: "Claude Opus 5", value: "--model claude-opus-5", group: "Previous generations" },
  { label: "Claude Opus 4.8", value: "--model claude-opus-4-8", group: "Previous generations" },
  { label: "Claude Opus 4.7", value: "--model claude-opus-4-7", group: "Previous generations" },
  { label: "Claude Opus 4.6", value: "--model claude-opus-4-6", group: "Previous generations" },
  { label: "Claude Opus 4.5", value: "--model claude-opus-4-5", group: "Previous generations" },
  { label: "Claude Sonnet 5", value: "--model claude-sonnet-5", group: "Previous generations" },
  { label: "Claude Sonnet 4.6", value: "--model claude-sonnet-4-6", group: "Previous generations" },
  { label: "Claude Sonnet 4.5", value: "--model claude-sonnet-4-5", group: "Previous generations" },
  { label: "Claude Haiku 4.5", value: "--model claude-haiku-4-5", group: "Previous generations" },
];

const AGENT_MODELS: Record<string, ModelOption[]> = {
  claude: CLAUDE_MODELS,
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
  pi: [
    { label: "Default (Smart Multi-Provider)", value: "" },
    { label: "Claude Sonnet, latest (Thinking High)", value: "--model sonnet:high" },
    { label: "High Thinking Mode", value: "--thinking high" },
    { label: "Max Thinking Mode", value: "--thinking max" },
    { label: "GPT-4o", value: "--model gpt-4o" },
    { label: "DeepSeek Reasoner", value: "--model deepseek-reasoner" },
  ],
  gemini: [
    { label: "Default (Gemini 2.5 Pro)", value: "" },
    { label: "Gemini 2.5 Pro", value: "--model gemini-2.5-pro" },
    { label: "Gemini 2.5 Flash", value: "--model gemini-2.5-flash" },
    { label: "Gemini 3.8 Flash (High)", value: "--model gemini-3.8-flash --effort high" },
  ],
  grok: [
    { label: "Default (Grok 2)", value: "" },
    { label: "Grok 2 Beta", value: "--model grok-beta" },
    { label: "Grok Vision", value: "--model grok-vision-beta" },
  ],
  aider: [
    { label: "Default (aider's configured model)", value: "" },
    { label: "Claude Sonnet 5.5", value: "--model anthropic/claude-sonnet-5-5" },
    { label: "Claude Opus 5.5", value: "--model anthropic/claude-opus-5-5" },
    { label: "DeepSeek R1", value: "--model openrouter/deepseek/deepseek-r1" },
    { label: "GPT-4o", value: "--model gpt-4o" },
  ],
  kiro: [
    { label: "Default (Auto Engine)", value: "" },
    { label: "Claude Opus 5.5 (1M context)", value: "--model claude-opus-5.5" },
    { label: "Claude Sonnet 5.5 (1M context)", value: "--model claude-sonnet-5.5" },
    { label: "Claude Opus 5 (1M context)", value: "--model claude-opus-5" },
    { label: "Claude Sonnet 5 (1M context)", value: "--model claude-sonnet-5" },
    { label: "OpenAI GPT 5.6 Sol (1M context)", value: "--model gpt-5.6-sol" },
    { label: "OpenAI GPT 5.6 Terra", value: "--model gpt-5.6-terra" },
    { label: "DeepSeek V3.2", value: "--model deepseek-3.2" },
    { label: "Qwen3 Coder Next", value: "--model qwen3-coder-next" },
    { label: "V3 Next-Gen Engine", value: "--v3" },
  ],
  copilot: [
    { label: "Default (GitHub Copilot CLI)", value: "" },
    { label: "Claude Sonnet 5.5 (Copilot)", value: "--model claude-sonnet-5.5" },
    { label: "GPT-4o (Copilot)", value: "--model gpt-4o" },
    { label: "o3-mini (Reasoning)", value: "--model o3-mini" },
  ],
  opencode: [
    { label: "Default (OpenCode TUI)", value: "" },
    { label: "Claude Sonnet 5.5 (Anthropic)", value: "-m anthropic/claude-sonnet-5-5" },
    { label: "Claude Opus 5.5 (Anthropic)", value: "-m anthropic/claude-opus-5-5" },
    { label: "OpenAI GPT-4o", value: "-m openai/gpt-4o" },
    { label: "Google Gemini 2.0 Flash", value: "-m google/gemini-2.0-flash" },
    { label: "DeepSeek Chat (DeepSeek)", value: "-m deepseek/deepseek-chat" },
    { label: "Continue Previous Session", value: "--continue" },
  ],
};

/** Ungrouped options first, then one <optgroup> per group in first-seen order. */
const renderModelOptions = (options: ModelOption[]) => {
  const ungrouped = options.filter((o) => !o.group);
  const groups = Array.from(new Set(options.filter((o) => o.group).map((o) => o.group as string)));
  return (
    <>
      {ungrouped.map((m) => (
        <option key={m.label} value={m.value}>
          {m.label}
        </option>
      ))}
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {options
            .filter((o) => o.group === g)
            .map((m) => (
              <option key={m.label} value={m.value}>
                {m.label}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
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
  const modelSelectId = useId();

  const isAgent = isAgentRunKind(runKind);

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

    // Explicitly blur any input/button in the modal so focus smoothly transfers to new terminal
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

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
      case "pi":
        return "Pi Coding Agent (Earendil Works)";
      case "gemini":
        return "Gemini CLI (Google)";
      case "grok":
        return "Grok CLI (xAI)";
      case "aider":
        return "Aider Pair Programmer (Paul Gauthier)";
      case "kiro":
        return "Kiro CLI (AWS & Multi-Model Engine)";
      case "copilot":
        return "GitHub Copilot CLI (GitHub & Microsoft)";
      case "opencode":
        return "OpenCode CLI (Multi-Provider Terminal Agent)";
      default:
        return "Agent";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-[660px] bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-6 text-[#c9d1d9] animate-in fade-in zoom-in-95 duration-100 max-h-[90vh] overflow-y-auto">
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
              Autonomous AI Agents
            </label>
            <div className="grid grid-cols-5 sm:grid-cols-5 gap-2 mb-3">
              {/* Claude Code */}
              <button
                type="button"
                onClick={() => setRunKind("claude")}
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
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
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
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
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
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

              {/* Pi Coding Agent */}
              <button
                type="button"
                onClick={() => setRunKind("pi")}
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
                  runKind === "pi"
                    ? "bg-[#a855f7]/15 border-[#a855f7] text-white shadow-sm ring-1 ring-[#a855f7]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <PiIcon className={`w-5 h-5 ${runKind === "pi" ? "text-[#c084fc]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Pi Agent</span>
                <span className="text-[10px] text-[#8b949e] scale-90">Earendil</span>
              </button>

              {/* Gemini CLI */}
              <button
                type="button"
                onClick={() => setRunKind("gemini")}
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
                  runKind === "gemini"
                    ? "bg-[#3b82f6]/15 border-[#3b82f6] text-white shadow-sm ring-1 ring-[#3b82f6]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <GeminiIcon className={`w-5 h-5 ${runKind === "gemini" ? "text-[#60a5fa]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Gemini</span>
                <span className="text-[10px] text-[#8b949e] scale-90">Google</span>
              </button>

              {/* Grok CLI */}
              <button
                type="button"
                onClick={() => setRunKind("grok")}
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
                  runKind === "grok"
                    ? "bg-white/15 border-white text-white shadow-sm ring-1 ring-white/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <GrokIcon className={`w-5 h-5 ${runKind === "grok" ? "text-[#f1f5f9]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Grok</span>
                <span className="text-[10px] text-[#8b949e] scale-90">xAI</span>
              </button>

              {/* Aider CLI */}
              <button
                type="button"
                onClick={() => setRunKind("aider")}
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
                  runKind === "aider"
                    ? "bg-[#10b981]/15 border-[#10b981] text-white shadow-sm ring-1 ring-[#10b981]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <AiderIcon className={`w-5 h-5 ${runKind === "aider" ? "text-[#34d399]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Aider</span>
                <span className="text-[10px] text-[#8b949e] scale-90">Pair</span>
              </button>

              {/* Kiro CLI */}
              <button
                type="button"
                onClick={() => setRunKind("kiro")}
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
                  runKind === "kiro"
                    ? "bg-[#a855f7]/15 border-[#a855f7] text-white shadow-sm ring-1 ring-[#a855f7]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <KiroIcon className={`w-5 h-5 ${runKind === "kiro" ? "text-[#a855f7]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Kiro</span>
                <span className="text-[10px] text-[#8b949e] scale-90">AWS/Multi</span>
              </button>

              {/* GitHub Copilot CLI */}
              <button
                type="button"
                onClick={() => setRunKind("copilot")}
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
                  runKind === "copilot"
                    ? "bg-[#38bdf8]/15 border-[#38bdf8] text-white shadow-sm ring-1 ring-[#38bdf8]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <CopilotIcon className={`w-5 h-5 ${runKind === "copilot" ? "text-[#38bdf8]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">Copilot</span>
                <span className="text-[10px] text-[#8b949e] scale-90">GitHub</span>
              </button>

              {/* OpenCode CLI */}
              <button
                type="button"
                onClick={() => setRunKind("opencode")}
                className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs font-medium transition-all ${
                  runKind === "opencode"
                    ? "bg-[#f97316]/15 border-[#f97316] text-white shadow-sm ring-1 ring-[#f97316]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <OpenCodeIcon className={`w-5 h-5 ${runKind === "opencode" ? "text-[#f97316]" : "text-[#8b949e]"}`} />
                </div>
                <span className="font-semibold text-center leading-tight">OpenCode</span>
                <span className="text-[10px] text-[#8b949e] scale-90">SST</span>
              </button>
            </div>

            <label className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-2 mt-2">
              Shells & Commands
            </label>
            <div className="grid grid-cols-2 gap-2">
              {/* PowerShell */}
              <button
                type="button"
                onClick={() => setRunKind("powershell")}
                className={`flex items-center justify-center gap-2 p-2 rounded-md border text-xs font-medium transition-all ${
                  runKind === "powershell"
                    ? "bg-[#58a6ff]/15 border-[#58a6ff] text-white shadow-sm ring-1 ring-[#58a6ff]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <PowerShellIcon className={`w-4 h-4 ${runKind === "powershell" ? "text-[#58a6ff]" : "text-[#8b949e]"}`} />
                <span className="font-semibold">PowerShell Console</span>
              </button>

              {/* Custom Command */}
              <button
                type="button"
                onClick={() => setRunKind("command")}
                className={`flex items-center justify-center gap-2 p-2 rounded-md border text-xs font-medium transition-all ${
                  runKind === "command"
                    ? "bg-[#3fb950]/15 border-[#3fb950] text-white shadow-sm ring-1 ring-[#3fb950]/50"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <CommandIcon className={`w-4 h-4 ${runKind === "command" ? "text-[#3fb950]" : "text-[#8b949e]"}`} />
                <span className="font-semibold">Custom Command</span>
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
                <label
                  htmlFor={modelSelectId}
                  className="block text-xs font-medium uppercase tracking-wider text-[#8b949e] mb-1"
                >
                  Model
                </label>
                <select
                  id={modelSelectId}
                  value={selectedModelFlag}
                  onChange={(e) => setSelectedModelFlag(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-white focus:outline-hidden focus:border-[#58a6ff]"
                >
                  {renderModelOptions(AGENT_MODELS[runKind] ?? [])}
                </select>
                <p className="mt-1 text-[10px] font-mono text-[#8b949e]">
                  {selectedModelFlag
                    ? `Launches with ${selectedModelFlag}`
                    : "No --model flag: the agent uses its own configured default"}
                </p>
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
