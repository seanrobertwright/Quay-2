import { useState, useEffect, useId, FormEvent, FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Network,
  Send,
  Radio,
  MessageSquare,
  X,
  ArrowRight,
  UserCheck,
  Cpu,
  CheckCircle2,
  Clock,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  Sparkles,
} from "lucide-react";
import { TerminalInfo, isAgentRunKind } from "../terminal/types";
import { isSamePath } from "../../utils/paths";

interface A2AMessage {
  id: string;
  from_terminal: string;
  to_terminal: string;
  from_name?: string | null;
  to_name?: string | null;
  content: string;
  as_user: boolean;
  timestamp: number;
  status: "pending" | "dispatched" | "completed" | "failed";
  response?: string | null;
}

interface A2APanelProps {
  isOpen: boolean;
  terminals: TerminalInfo[];
  activeProject: string;
  onClose: () => void;
}

// The sender recorded for a message dispatched as the user; the trail credits it to "You".
const USER_SENDER = "user";

export const A2APanel: FC<A2APanelProps> = ({
  isOpen,
  terminals,
  activeProject,
  onClose,
}) => {
  const agentTerminals = terminals.filter((t) => isAgentRunKind(t.run_kind));
  // From Agent and To Agent offer only the active project's agents, scoped the way the
  // stage scopes its terminals: a worktree counts as its own project.
  const projectAgents = agentTerminals.filter((t) => isSamePath(t.project_path, activeProject));
  const [fromTerminal, setFromTerminal] = useState(projectAgents[0]?.id || "");
  const [toTerminal, setToTerminal] = useState(projectAgents[1]?.id || "");
  const [prompt, setPrompt] = useState("");
  const [asUser, setAsUser] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fromSelectId = useId();
  const toSelectId = useId();
  const [broadcastText, setBroadcastText] = useState("");
  const [messages, setMessages] = useState<A2AMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const getTerminalLabel = (idOrName: string, nameFallback?: string | null) => {
    if (nameFallback) return nameFallback;
    const term = terminals.find((t) => t.id === idOrName || t.name === idOrName);
    return term ? term.name : idOrName;
  };

  // Keep From Agent and To Agent on agents of the active project. Unless the message is
  // dispatched as the user, To Agent never holds the agent From Agent holds: changing From
  // Agent to the agent To Agent holds moves To Agent to another peer.
  useEffect(() => {
    const inProject = (id: string) => projectAgents.some((t) => t.id === id);
    const from = inProject(fromTerminal) ? fromTerminal : projectAgents[0]?.id || "";
    const to =
      inProject(toTerminal) && (asUser || toTerminal !== from)
        ? toTerminal
        : projectAgents.find((t) => t.id !== from)?.id || "";
    if (from !== fromTerminal) setFromTerminal(from);
    if (to !== toTerminal) setToTerminal(to);
  }, [terminals, activeProject, asUser, fromTerminal, toTerminal]);

  useEffect(() => {
    if (!isOpen) return;

    loadMessages();

    // Listen for real-time message updates
    const unlistenUpdatedPromise = listen<A2AMessage>("a2a-message-updated", (event) => {
      const updated = event.payload;
      setMessages((prev) => {
        const index = prev.findIndex((m) => m.id === updated.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = updated;
          return next;
        } else {
          return [updated, ...prev];
        }
      });
    });

    const unlistenClearedPromise = listen("a2a-messages-cleared", () => {
      setMessages([]);
    });

    const interval = setInterval(loadMessages, 3000);

    return () => {
      clearInterval(interval);
      unlistenUpdatedPromise.then((unlisten) => unlisten());
      unlistenClearedPromise.then((unlisten) => unlisten());
    };
  }, [isOpen]);

  // Esc closes the panel. The listener exists only while the panel is open, and it
  // runs in the capture phase so the Esc never reaches the focused terminal pane,
  // where Claude Code would read it as "interrupt".
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onClose]);

  const loadMessages = async () => {
    try {
      const msgs = await invoke<A2AMessage[]>("a2a_get_messages");
      setMessages(msgs);
    } catch (e) {
      console.error("Failed to load A2A messages:", e);
    }
  };

  const handleSendPrompt = async (e?: FormEvent) => {
    e?.preventDefault();
    const from = asUser ? USER_SENDER : fromTerminal;
    if (!from || !toTerminal || !prompt.trim()) return;

    setIsSending(true);
    setSendError(null);
    try {
      await invoke("a2a_send_prompt", {
        request: {
          from_terminal: from,
          to_terminal: toTerminal,
          prompt,
          as_user: asUser,
        },
      });
      setPrompt("");
      await loadMessages();
    } catch (err) {
      console.error("A2A dispatch error:", err);
      setSendError(String(err));
    } finally {
      setIsSending(false);
    }
  };

  const handleBroadcast = async (e: FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim() || isBroadcasting) return;

    setIsBroadcasting(true);
    try {
      const dispatched = await invoke<A2AMessage[]>("a2a_broadcast_toast", { text: broadcastText });
      const count = dispatched?.length || agentTerminals.length;
      setBroadcastText("");
      setBroadcastSuccess(`Broadcast sent to ${count} agent${count === 1 ? "" : "s"}!`);
      setTimeout(() => setBroadcastSuccess(null), 3500);
      await loadMessages();
    } catch (err) {
      console.error("Broadcast toast error:", err);
    } finally {
      setIsBroadcasting(false);
    }
  };

  const handleClearMessages = async () => {
    try {
      await invoke("a2a_clear_messages");
      setMessages([]);
    } catch (err) {
      console.error("Failed to clear A2A messages:", err);
    }
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const applyTemplate = (templatePrompt: string) => {
    setPrompt(templatePrompt);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-[740px] max-h-[88vh] bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl flex flex-col text-[#c9d1d9] animate-in zoom-in-95 duration-150">
        {/* Panel Header */}
        <div className="h-14 px-6 border-b border-[#30363d] flex items-center justify-between shrink-0 bg-[#161b22]">
          <div className="flex items-center gap-2.5">
            <Network className="w-5 h-5 text-[#58a6ff]" />
            <div>
              <h2 className="text-base font-semibold text-white leading-tight">
                Mission Control
              </h2>
              <p className="text-[11px] text-[#8b949e]">
                Send messages to the agents on the A2A bus and follow their trail
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Mission Control"
            className="text-[#8b949e] hover:text-white p-1.5 hover:bg-[#21262d] rounded transition-colors"
            title="Close Panel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {/* Bus levels banner */}
          <div className="p-3.5 bg-[#0d1117] border border-[#30363d] rounded-lg">
            <div className="flex items-center gap-2 text-xs font-semibold text-white mb-1.5">
              <Cpu className="w-4 h-4 text-[#3fb950]" />
              <span>Peers on the A2A bus</span>
            </div>
            <p className="text-xs text-[#8b949e] mb-2 leading-relaxed">
              Every peer on the bus can be sent a message. What it can do back depends on its level:
            </p>
            <ul className="text-xs text-[#8b949e] mb-2.5 space-y-1 leading-relaxed">
              <li>
                <strong className="text-white">Full peer</strong>: sends messages, answers a sender who waits for its reply, and shows whether it is working or idle.
              </li>
              <li>
                <strong className="text-white">Responder</strong>: answers a sender who waits and shows whether it is working or idle, but can't send messages, so it never starts a conversation.
              </li>
              <li>
                <strong className="text-white">Listener</strong>: can be sent a message but can't answer. A sender who waits on a listener gets no reply.
              </li>
            </ul>
            <p className="text-xs text-[#8b949e] mb-2.5 leading-relaxed">
              Quay gives Claude Code terminals the <code className="text-[#58a6ff]">quay</code> MCP server and its tools. A Claude Code peer can't answer until Quay hears from its event-bridge plugin.
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2 bg-[#161b22] border border-[#30363d] rounded">
                <span className="text-[#58a6ff] font-bold">quay_list_agents</span>
                <p className="text-[10px] text-[#8b949e] font-sans mt-0.5">List Quay's terminals with their run kind and status</p>
              </div>
              <div className="p-2 bg-[#161b22] border border-[#30363d] rounded">
                <span className="text-[#58a6ff] font-bold">quay_send_message</span>
                <p className="text-[10px] text-[#8b949e] font-sans mt-0.5">Send a peer a message, optionally waiting for its reply</p>
              </div>
              <div className="p-2 bg-[#161b22] border border-[#30363d] rounded">
                <span className="text-[#58a6ff] font-bold">quay_broadcast</span>
                <p className="text-[10px] text-[#8b949e] font-sans mt-0.5">Type one line into every running agent terminal</p>
              </div>
              <div className="p-2 bg-[#161b22] border border-[#30363d] rounded">
                <span className="text-[#58a6ff] font-bold">quay_get_agent_status</span>
                <p className="text-[10px] text-[#8b949e] font-sans mt-0.5">Check one peer's status and auto-approved action count</p>
              </div>
            </div>
          </div>

          {/* Interactive Agent-to-Agent Dispatch */}
          <div className="p-4 bg-[#0d1117] border border-[#30363d] rounded-lg space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>Dispatch Prompt / Handoff Task</span>
            </h3>

            {projectAgents.length < 2 ? (
              <div className="p-3 bg-[#161b22] border border-[#30363d] rounded text-xs text-[#8b949e] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#d29922] shrink-0" />
                <span>
                  Spawn at least <strong>two AI agent terminals (Claude, Antigravity, or Codex)</strong> in the active project to test autonomous agent-to-agent messaging and task handoffs.
                </span>
              </div>
            ) : (
              <form onSubmit={handleSendPrompt} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label htmlFor={fromSelectId} className="block text-[11px] text-[#8b949e] mb-1 font-medium">From Agent</label>
                    <select
                      id={fromSelectId}
                      value={asUser ? USER_SENDER : fromTerminal}
                      disabled={asUser}
                      onChange={(e) => {
                        setFromTerminal(e.target.value);
                        setSendError(null);
                      }}
                      className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-white focus:outline-hidden focus:border-[#58a6ff] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {asUser ? (
                        <option value={USER_SENDER}>You</option>
                      ) : (
                        projectAgents.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.run_kind}) • [{t.claude_status.toUpperCase()}] {t.task_title ? `("${t.task_title}")` : ""}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <ArrowRight className="w-4 h-4 text-[#8b949e] mt-5 shrink-0" />

                  <div className="flex-1">
                    <label htmlFor={toSelectId} className="block text-[11px] text-[#8b949e] mb-1 font-medium">To Agent</label>
                    <select
                      id={toSelectId}
                      value={toTerminal}
                      onChange={(e) => {
                        setToTerminal(e.target.value);
                        setSendError(null);
                      }}
                      className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-white focus:outline-hidden focus:border-[#58a6ff]"
                    >
                      {projectAgents
                        .filter((t) => asUser || t.id !== fromTerminal)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.run_kind}) • [{t.claude_status.toUpperCase()}] {t.task_title ? `("${t.task_title}")` : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Prompt Templates */}
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="text-[#8b949e] flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-[#58a6ff]" />
                    <span>Templates:</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => applyTemplate("Please inspect the latest code changes in this workspace and provide a concise review summary.")}
                    className="px-2 py-0.5 rounded bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff] hover:text-white transition-colors"
                  >
                    Code Review
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTemplate("Please execute the test suite (cargo test / pnpm test), verify pass/fail status, and report results.")}
                    className="px-2 py-0.5 rounded bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff] hover:text-white transition-colors"
                  >
                    Run Tests
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTemplate("What task are you currently executing and what is your latest progress status?")}
                    className="px-2 py-0.5 rounded bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff] hover:text-white transition-colors"
                  >
                    Status Check
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTemplate("I have completed the backend APIs. Please implement matching frontend components and handlers.")}
                    className="px-2 py-0.5 rounded bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff] hover:text-white transition-colors"
                  >
                    Task Handoff
                  </button>
                </div>

                <div>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        handleSendPrompt();
                      }
                    }}
                    aria-label="Message to dispatch"
                    placeholder="Task instruction or prompt to dispatch to peer agent... (Ctrl+Enter to send)"
                    rows={2}
                    className="w-full p-2.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-white focus:outline-hidden focus:border-[#58a6ff]"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-[#8b949e] cursor-pointer hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      checked={asUser}
                      onChange={(e) => {
                        setAsUser(e.target.checked);
                        setSendError(null);
                      }}
                      className="rounded bg-[#161b22] border-[#30363d]"
                    />
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Dispatch as User</span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSending || !prompt.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSending ? "Dispatching..." : "Dispatch Task"}</span>
                  </button>
                </div>

                {sendError && (
                  <div
                    role="alert"
                    className="text-xs text-[#ff7b72] bg-[#da3633]/15 border border-[#da3633]/40 rounded px-2.5 py-1"
                  >
                    {sendError}
                  </div>
                )}
              </form>
            )}
          </div>

          {/* Broadcast Section */}
          <div className="p-4 bg-[#0d1117] border border-[#30363d] rounded-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#3fb950]" />
                <span>Broadcast Notice to All AI Agent Sessions</span>
              </h3>
              <span className="text-[11px]">
                {agentTerminals.length > 0 ? (
                  <span className="text-[#3fb950] font-mono">
                    {agentTerminals.length} target{agentTerminals.length === 1 ? "" : "s"} active
                  </span>
                ) : (
                  <span className="text-[#d29922]">No agent terminals active</span>
                )}
              </span>
            </div>

            <form onSubmit={handleBroadcast} className="flex gap-2">
              <input
                type="text"
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
                placeholder="Notice / Toast text (e.g. 'DB migration finished, pulling updates...')"
                className="flex-1 px-3 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-white focus:outline-hidden focus:border-[#58a6ff]"
              />
              <button
                type="submit"
                disabled={!broadcastText.trim() || isBroadcasting}
                className="px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 text-white rounded text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                {isBroadcasting ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Broadcasting...</span>
                  </>
                ) : (
                  <>
                    <Radio className="w-3 h-3" />
                    <span>Broadcast</span>
                  </>
                )}
              </button>
            </form>

            {broadcastSuccess && (
              <div className="flex items-center gap-1.5 text-xs text-[#3fb950] bg-[#238636]/15 border border-[#238636]/40 rounded px-2.5 py-1 animate-in fade-in">
                <Check className="w-3.5 h-3.5" />
                <span>{broadcastSuccess}</span>
              </div>
            )}
          </div>

          {/* Messages History */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-[#a371f7]" />
                <span>Live A2A Message Trail ({messages.length})</span>
              </h3>
              <div className="flex items-center gap-3">
                {messages.length > 0 && (
                  <button
                    onClick={handleClearMessages}
                    className="text-[11px] text-[#ff7b72] hover:underline flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear Trail</span>
                  </button>
                )}
                <button
                  onClick={loadMessages}
                  className="text-[11px] text-[#58a6ff] hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            <div className="space-y-2.5 max-h-56 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="text-xs text-[#8b949e] text-center py-6 bg-[#0d1117] rounded border border-[#30363d]">
                  No inter-agent messages dispatched yet. When agents invoke <code className="text-[#58a6ff]">quay_send_message</code> or you dispatch tasks above, conversations appear here live.
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 bg-[#0d1117] border border-[#30363d] rounded-md text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[11px] text-[#8b949e]">
                      <span className="font-semibold text-[#58a6ff]">
                        {getTerminalLabel(m.from_terminal, m.from_name)} → {getTerminalLabel(m.to_terminal, m.to_name)}
                        {m.as_user && (
                          <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded bg-[#30363d] text-[#c9d1d9] font-normal">
                            as user
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        {m.status === "completed" && (
                          <span className="flex items-center gap-1 text-[#3fb950] font-medium">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Completed</span>
                          </span>
                        )}
                        {m.status === "dispatched" && (
                          <span className="flex items-center gap-1 text-[#58a6ff]">
                            <Clock className="w-3 h-3 animate-spin" />
                            <span>Working</span>
                          </span>
                        )}
                        {m.status === "failed" && (
                          <span className="flex items-center gap-1 text-[#ff7b72]">
                            <span>Failed</span>
                          </span>
                        )}
                        <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>

                    <div className="text-white text-xs font-mono bg-[#161b22] p-2 rounded border border-[#30363d]/50 relative group">
                      <div className="pr-6">{m.content}</div>
                      <button
                        type="button"
                        onClick={() => handleCopy(`content-${m.id}`, m.content)}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[#58a6ff] absolute top-2 right-2 p-1 text-[#8b949e] hover:text-white rounded bg-[#21262d] transition-opacity"
                        title="Copy message"
                        aria-label="Copy message"
                      >
                        {copiedKey === `content-${m.id}` ? (
                          <Check className="w-3 h-3 text-[#3fb950]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    {m.response && (
                      <div className="mt-1 pl-2.5 border-l-2 border-[#3fb950] text-[#7ee787] text-[11px] font-mono relative group">
                        <div className="flex items-center justify-between text-[10px] text-[#8b949e] font-sans mb-0.5">
                          <span>Reply:</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(`resp-${m.id}`, m.response!)}
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[#58a6ff] rounded text-[#58a6ff] hover:underline flex items-center gap-0.5"
                          >
                            {copiedKey === `resp-${m.id}` ? (
                              <span className="text-[#3fb950]">Copied!</span>
                            ) : (
                              <span>Copy Reply</span>
                            )}
                          </button>
                        </div>
                        <div className="whitespace-pre-wrap">{m.response}</div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
