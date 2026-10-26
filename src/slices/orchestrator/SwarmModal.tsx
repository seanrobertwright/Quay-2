import React, { useState, useEffect, useId, useRef } from "react";
import {
  SwarmPreset,
  SwarmAgentConfig,
  SwarmDraft,
  BUILTIN_SWARM_PRESETS,
  sameSwarmName,
  savedSwarmToPreset,
} from "./swarmTypes";
import { AgentIcon } from "../terminal/AgentIcons";
import { StageLayout, takesLaunchPrompt } from "../terminal/types";
import {
  X,
  Bot,
  Zap,
  Columns2,
  Rows2,
  LayoutGrid,
  Square,
  Play,
  Layers,
  Sparkles,
  Plus,
  Trash2,
  Save,
} from "lucide-react";

const NO_LAUNCH_PROMPT_HINT =
  "This CLI takes no launch prompt, so it starts without its role or team briefing. Paste its role by hand.";

/** Marks a roster row whose CLI starts without a launch prompt. */
const NoLaunchPromptNote: React.FC = () => (
  <span className="shrink-0 whitespace-nowrap text-[10px] text-[#d29922]" title={NO_LAUNCH_PROMPT_HINT}>
    No launch prompt
  </span>
);

interface SwarmModalProps {
  isOpen: boolean;
  activeProject: string;
  onClose: () => void;
  onLaunchSwarm: (preset: SwarmPreset) => Promise<void>;
  savedSwarms: SwarmPreset[];
  onSaveSwarm: (draft: SwarmDraft) => Promise<SwarmPreset>;
  onRemoveSwarm: (id: string) => Promise<void>;
}

const defaultAgent = (n: number): SwarmAgentConfig => ({
  role: `Agent ${n}`,
  name: `agent-${n}`,
  run_kind: "claude",
  custom_flags: "",
});

const DEFAULT_TITLE = "Custom Swarm";
const DEFAULT_LAYOUT: StageLayout = "split-horizontal";
const defaultRoster = () => [defaultAgent(1), defaultAgent(2)];

/** The next row number not already used by an `agent-N` session name. */
const nextAgentNumber = (agents: SwarmAgentConfig[]) => {
  let n = agents.length + 1;
  while (agents.some((a) => a.name === `agent-${n}`)) n++;
  return n;
};

/** The four parts of a role prompt, in the order a role prompt follows them. */
const ROLE_PROMPT_PLACEHOLDER = [
  "Who you are: …",
  "What you own: …",
  "What you leave to teammates: …",
  "How you work: …",
].join("\n");

/** How long an armed Remove? stays armed before it reverts to Remove. */
const REMOVE_CONFIRM_MS = 3000;

export const SwarmModal: React.FC<SwarmModalProps> = ({
  isOpen,
  activeProject,
  onClose,
  onLaunchSwarm,
  savedSwarms,
  onSaveSwarm,
  onRemoveSwarm,
}) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(BUILTIN_SWARM_PRESETS[0].id);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [removeArmedId, setRemoveArmedId] = useState<string | null>(null);
  const removeTimer = useRef<number | null>(null);
  const nameInputId = useId();
  const nameErrorId = useId();
  const rolePromptIdBase = useId();

  // Custom preset form state
  const [customTitle, setCustomTitle] = useState(DEFAULT_TITLE);
  const [customLayout, setCustomLayout] = useState<StageLayout>(DEFAULT_LAYOUT);
  const [customAgents, setCustomAgents] = useState<SwarmAgentConfig[]>(defaultRoster);

  const clearRemoveTimer = () => {
    if (removeTimer.current !== null) {
      window.clearTimeout(removeTimer.current);
      removeTimer.current = null;
    }
  };

  useEffect(() => clearRemoveTimer, []);

  // The form opens on its defaults each time the launcher does, not on the last swarm loaded.
  useEffect(() => {
    if (isOpen) return;
    setCustomTitle(DEFAULT_TITLE);
    setCustomLayout(DEFAULT_LAYOUT);
    setCustomAgents(defaultRoster());
    setNameError(null);
  }, [isOpen]);

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

  const presets = [...savedSwarms, ...BUILTIN_SWARM_PRESETS];
  const selectedPreset = presets.find((p) => p.id === selectedPresetId) || BUILTIN_SWARM_PRESETS[0];
  const projectName = activeProject.split(/[/\\]/).filter(Boolean).pop() || "Workspace";
  const matchingSaved = savedSwarms.find((p) => sameSwarmName(p.title, customTitle));

  const selectPreset = (preset: SwarmPreset) => {
    setSelectedPresetId(preset.id);
    // A custom card opens in the form, so editing is select, change, Update.
    if (savedSwarms.some((p) => p.id === preset.id)) {
      setCustomTitle(preset.title);
      setCustomLayout(preset.layout);
      setCustomAgents(preset.agents.map((a) => ({ ...a })));
      setNameError(null);
      setIsCustomMode(true);
    }
  };

  const handleSave = async () => {
    // The store refuses a blank or built-in name; its message shows under the field.
    setNameError(null);
    setIsSaving(true);
    try {
      const saved = await onSaveSwarm({
        title: customTitle.trim(),
        layout: customLayout,
        agents: customAgents,
      });
      setCustomTitle(saved.title);
      setSelectedPresetId(saved.id);
    } catch (err) {
      setNameError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const disarmRemove = () => {
    clearRemoveTimer();
    setRemoveArmedId(null);
  };

  const handleRemoveClick = async (preset: SwarmPreset) => {
    if (removeArmedId !== preset.id) {
      clearRemoveTimer();
      setRemoveArmedId(preset.id);
      removeTimer.current = window.setTimeout(() => {
        removeTimer.current = null;
        setRemoveArmedId(null);
      }, REMOVE_CONFIRM_MS);
      return;
    }
    disarmRemove();
    try {
      await onRemoveSwarm(preset.id);
      if (selectedPresetId === preset.id) setSelectedPresetId(BUILTIN_SWARM_PRESETS[0].id);
    } catch (err) {
      console.error("Failed to remove saved swarm:", err);
    }
  };

  // Launch runs the form as it stands and saves nothing; only Save adds to the catalog.
  const handleLaunch = async () => {
    setIsLaunching(true);
    try {
      if (isCustomMode) {
        await onLaunchSwarm(
          savedSwarmToPreset({
            id: "custom-unsaved",
            title: customTitle.trim() || DEFAULT_TITLE,
            layout: customLayout,
            agents: customAgents,
          })
        );
      } else {
        await onLaunchSwarm(selectedPreset);
      }
      onClose();
    } catch (err) {
      console.error("Failed to launch swarm:", err);
    } finally {
      setIsLaunching(false);
    }
  };

  const getLayoutIcon = (layout: string) => {
    switch (layout) {
      case "split-horizontal":
        return <Columns2 className="w-4 h-4" />;
      case "split-vertical":
        return <Rows2 className="w-4 h-4" />;
      case "grid":
        return <LayoutGrid className="w-4 h-4" />;
      default:
        return <Square className="w-4 h-4" />;
    }
  };

  const renderPresetCard = (preset: SwarmPreset, removable: boolean) => {
    const isSelected = preset.id === selectedPresetId;
    const isRemoveArmed = removeArmedId === preset.id;
    return (
      <div
        key={preset.id}
        role="button"
        tabIndex={0}
        onClick={() => selectPreset(preset)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            selectPreset(preset);
          }
        }}
        className={`p-4 rounded-lg border cursor-pointer transition-all flex flex-col justify-between ${
          isSelected
            ? "bg-[#1f2937]/70 border-[#58a6ff] shadow-md shadow-[#58a6ff]/5"
            : "bg-[#0d1117] border-[#30363d] hover:border-[#8b949e]/50 hover:bg-[#161b22]"
        }`}
      >
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#58a6ff]" />
              <h3 className="text-sm font-bold text-white">{preset.title}</h3>
            </div>
            <div className="flex items-center gap-1.5">
              {preset.badge && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-mono font-semibold"
                  style={{
                    backgroundColor: `${preset.tagColor || "#58a6ff"}20`,
                    color: preset.tagColor || "#58a6ff",
                  }}
                >
                  {preset.badge}
                </span>
              )}
              <div
                className="p-1 rounded bg-[#21262d] text-[#8b949e]"
                title={`Layout: ${preset.layout}`}
              >
                {getLayoutIcon(preset.layout)}
              </div>
              {removable && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveClick(preset);
                  }}
                  onBlur={disarmRemove}
                  aria-label={isRemoveArmed ? `Confirm removing ${preset.title}` : `Remove ${preset.title}`}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    isRemoveArmed
                      ? "bg-[#f85149]/15 text-[#f85149] border border-[#f85149]/40"
                      : "text-[#8b949e] hover:text-[#f85149]"
                  }`}
                >
                  {isRemoveArmed ? "Remove?" : "Remove"}
                </button>
              )}
            </div>
          </div>

          <p className="text-xs text-[#8b949e] leading-relaxed mb-3">
            {preset.description}
          </p>
        </div>

        {/* Agent Member Pills */}
        <div className="space-y-1.5 pt-2 border-t border-[#30363d]/60">
          <span className="text-[10px] uppercase font-semibold text-[#8b949e] tracking-wider block">
            Team Roster ({preset.agents.length}):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {preset.agents.map((agent) => (
              <div
                key={agent.name}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#21262d] border border-[#30363d] text-[11px]"
              >
                <AgentIcon kind={agent.run_kind} className="w-3.5 h-3.5 shrink-0" />
                <span className="font-medium text-white">{agent.role}</span>
                <span className="text-[#8b949e] font-mono text-[10px]">
                  ({agent.name})
                </span>
                {!takesLaunchPrompt(agent.run_kind) && <NoLaunchPromptNote />}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-3xl bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#30363d] flex items-center justify-between bg-[#0d1117]/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-[#d29922]/15 text-[#d29922] border border-[#d29922]/30">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Multi-Agent Swarm Launcher</span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#58a6ff] font-mono">
                  {projectName}
                </span>
              </h2>
              <p className="text-xs text-[#8b949e] mt-0.5">
                Launch a pre-configured team of specialized AI agents (Claude, Antigravity, Codex) & shell terminals with automatic split layout
              </p>
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

        {/* Mode Toggle Bar */}
        <div className="px-5 py-2.5 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCustomMode(false)}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                !isCustomMode
                  ? "bg-[#21262d] text-white shadow-xs"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              Preset Catalog
            </button>
            <button
              type="button"
              onClick={() => setIsCustomMode(true)}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                isCustomMode
                  ? "bg-[#21262d] text-white shadow-xs"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              Create Custom Swarm
            </button>
          </div>

          <span className="text-[11px] text-[#8b949e] flex items-center gap-1 font-mono">
            <Layers className="w-3.5 h-3.5 text-[#58a6ff]" />
            <span>Target: {projectName}</span>
          </span>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {!isCustomMode ? (
            /* Presets Grid: Your swarms first, when any are saved, then the built-ins */
            <div className="space-y-5">
              {savedSwarms.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-[11px] uppercase font-semibold text-[#8b949e] tracking-wider">
                    Your swarms
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {savedSwarms.map((preset) => renderPresetCard(preset, true))}
                  </div>
                </section>
              )}
              <section className="space-y-2">
                {savedSwarms.length > 0 && (
                  <h3 className="text-[11px] uppercase font-semibold text-[#8b949e] tracking-wider">
                    Built-in presets
                  </h3>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {BUILTIN_SWARM_PRESETS.map((preset) => renderPresetCard(preset, false))}
                </div>
              </section>
            </div>
          ) : (
            /* Custom Swarm Form */
            <div className="space-y-4 max-w-xl mx-auto">
              <div className="space-y-1.5">
                <label htmlFor={nameInputId} className="text-xs font-semibold text-[#c9d1d9]">
                  Swarm Name
                </label>
                <input
                  id={nameInputId}
                  type="text"
                  value={customTitle}
                  onChange={(e) => {
                    setCustomTitle(e.target.value);
                    setNameError(null);
                  }}
                  placeholder="e.g. Audit & Refactor Pair"
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? nameErrorId : undefined}
                  className={`w-full px-3 py-2 bg-[#0d1117] border rounded-md text-xs text-white focus:outline-hidden focus:border-[#58a6ff] ${
                    nameError ? "border-[#f85149]" : "border-[#30363d]"
                  }`}
                />
                {nameError && (
                  <p id={nameErrorId} role="alert" className="text-[11px] text-[#f85149]">
                    {nameError}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-[#c9d1d9]">Layout Arrangement</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "split-horizontal", label: "Side-by-Side Split", icon: Columns2 },
                    { id: "split-vertical", label: "Stacked Split", icon: Rows2 },
                    { id: "grid", label: "2x2 Quad Grid", icon: LayoutGrid },
                  ].map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setCustomLayout(l.id as any)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
                        customLayout === l.id
                          ? "bg-[#21262d] border-[#58a6ff] text-white"
                          : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-[#c9d1d9]"
                      }`}
                    >
                      <l.icon className="w-4 h-4 text-[#58a6ff]" />
                      <span>{l.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#c9d1d9]">
                    Agents Roster ({customAgents.length})
                  </label>
                  {customAgents.length < 4 && (
                    <button
                      type="button"
                      onClick={() =>
                        setCustomAgents((prev) => [...prev, defaultAgent(nextAgentNumber(prev))])
                      }
                      className="flex items-center gap-1 text-xs text-[#58a6ff] hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Agent</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {customAgents.map((ag, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-[#0d1117] border border-[#30363d] rounded-md space-y-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <AgentIcon kind={ag.run_kind} className="w-3.5 h-3.5 shrink-0" />
                        <select
                          aria-label={`CLI for agent ${idx + 1}`}
                          value={ag.run_kind}
                          onChange={(e) =>
                            setCustomAgents((prev) =>
                              prev.map((a, i) =>
                                i === idx ? { ...a, run_kind: e.target.value as any } : a
                              )
                            )
                          }
                          className="px-2 py-1 bg-[#161b22] border border-[#30363d] rounded text-white font-mono text-[11px]"
                        >
                          <option value="claude">Claude Code</option>
                          <option value="antigravity">Antigravity CLI</option>
                          <option value="codex">Codex CLI</option>
                          <option value="pi">Pi Coding Agent</option>
                          <option value="gemini">Gemini CLI</option>
                          <option value="grok">Grok CLI</option>
                          <option value="aider">Aider CLI</option>
                          <option value="kiro">Kiro CLI</option>
                          <option value="copilot">GitHub Copilot</option>
                          <option value="opencode">OpenCode CLI</option>
                          <option value="pig">PiG (Pi in Go)</option>
                          <option value="powershell">PowerShell</option>
                          <option value="command">Custom Command</option>
                        </select>

                        <input
                          type="text"
                          aria-label={`Role for agent ${idx + 1}`}
                          value={ag.role}
                          onChange={(e) =>
                            setCustomAgents((prev) =>
                              prev.map((a, i) => (i === idx ? { ...a, role: e.target.value } : a))
                            )
                          }
                          placeholder="Role / Title"
                          className="flex-1 px-2.5 py-1 bg-[#161b22] border border-[#30363d] rounded text-white"
                        />

                        <input
                          type="text"
                          aria-label={`Session name for agent ${idx + 1}`}
                          value={ag.name}
                          onChange={(e) =>
                            setCustomAgents((prev) =>
                              prev.map((a, i) => (i === idx ? { ...a, name: e.target.value } : a))
                            )
                          }
                          placeholder="session-name"
                          className="w-28 px-2.5 py-1 bg-[#161b22] border border-[#30363d] rounded text-[#58a6ff] font-mono text-[11px]"
                        />

                        {!takesLaunchPrompt(ag.run_kind) && <NoLaunchPromptNote />}

                        {customAgents.length > 2 && (
                          <button
                            type="button"
                            aria-label={`Remove agent ${idx + 1}`}
                            onClick={() =>
                              setCustomAgents((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1 text-[#8b949e] hover:text-[#f85149]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label
                          htmlFor={`${rolePromptIdBase}-${idx}`}
                          className="block text-[11px] font-semibold text-[#8b949e]"
                        >
                          Role prompt <span className="font-normal">(optional)</span>
                        </label>
                        <textarea
                          id={`${rolePromptIdBase}-${idx}`}
                          value={ag.role_prompt ?? ""}
                          onChange={(e) =>
                            setCustomAgents((prev) =>
                              prev.map((a, i) =>
                                i === idx ? { ...a, role_prompt: e.target.value } : a
                              )
                            )
                          }
                          placeholder={ROLE_PROMPT_PLACEHOLDER}
                          rows={4}
                          className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-white leading-relaxed resize-y placeholder:text-[#6e7681]"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#30363d] flex items-center justify-between bg-[#0d1117]/80">
          <div className="flex items-center gap-2 text-xs text-[#8b949e]">
            <Sparkles className="w-4 h-4 text-[#d29922]" />
            <span>
              Spawns{" "}
              <strong className="text-white font-semibold">
                {isCustomMode ? customAgents.length : selectedPreset.agents.length} terminals
              </strong>{" "}
              in <strong className="text-white">{projectName}</strong> with full A2A message bus
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d] rounded-md transition-colors"
            >
              Cancel
            </button>

            {isCustomMode && (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-white rounded-md transition-colors disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? "Saving..." : matchingSaved ? "Update" : "Save"}</span>
              </button>
            )}

            <button
              type="button"
              disabled={isLaunching}
              onClick={handleLaunch}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white rounded-md shadow-sm transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isLaunching ? "Launching Swarm..." : "Launch Swarm Now"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
