import { useState, useEffect, FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
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
} from "lucide-react";
import { TerminalInfo } from "../terminal/types";

interface A2AMessage {
  id: string;
  from_terminal: string;
  to_terminal: string;
  content: string;
  as_user: boolean;
  timestamp: number;
  status: "pending" | "dispatched" | "completed" | "failed";
  response?: string | null;
}

interface A2APanelProps {
  isOpen: boolean;
  terminals: TerminalInfo[];
  onClose: () => void;
}

export const A2APanel = ({
  isOpen,
  terminals,
  onClose,
}: A2APanelProps) => {
  const claudeTerminals = terminals.filter((t) => t.run_kind === "claude");
  const [fromTerminal, setFromTerminal] = useState(claudeTerminals[0]?.id || "");
  const [toTerminal, setToTerminal] = useState(claudeTerminals[1]?.id || "");
  const [prompt, setPrompt] = useState("");
  const [asUser, setAsUser] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [messages, setMessages] = useState<A2AMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (claudeTerminals.length > 0 && !fromTerminal) {
      setFromTerminal(claudeTerminals[0].id);
    }
    if (claudeTerminals.length > 1 && !toTerminal) {
      setToTerminal(claudeTerminals[1].id);
    }
  }, [claudeTerminals, fromTerminal, toTerminal]);

  useEffect(() => {
    if (!isOpen) return;

    loadMessages();
    const interval = setInterval(loadMessages, 1500);
    return () => clearInterval(interval);
  }, [isOpen]);

  const loadMessages = async () => {
    try {
      const msgs = await invoke<A2AMessage[]>("a2a_get_messages");
      setMessages(msgs);
    } catch (e) {
      console.error("Failed to load A2A messages:", e);
    }
  };

  const handleSendPrompt = async (e: FormEvent) => {
    e.preventDefault();
    if (!fromTerminal || !toTerminal || !prompt.trim()) return;

    setIsSending(true);
    try {
      await invoke("a2a_send_prompt", {
        request: {
          from_terminal: fromTerminal,
          to_terminal: toTerminal,
          prompt,
          as_user: asUser,
        },
      });
      setPrompt("");
      await loadMessages();
    } catch (err) {
      console.error("A2A dispatch error:", err);
    } finally {
      setIsSending(false);
    }
  };

  const handleBroadcast = async (e: FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;

    try {
      await invoke("a2a_broadcast_toast", { text: broadcastText });
      setBroadcastText("");
    } catch (err) {
      console.error("Broadcast toast error:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-[720px] max-h-[88vh] bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl flex flex-col text-[#c9d1d9] animate-in zoom-in-95 duration-150">
        <div className="h-14 px-6 border-b border-[#30363d] flex items-center justify-between shrink-0 bg-[#161b22]">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-[#58a6ff]" />
            <div>
              <h2 className="text-base font-semibold text-white leading-tight">
                A2A Orchestration Bus
              </h2>
              <p className="text-[11px] text-[#8b949e]">
                Autonomous Peer-to-Peer Agent Collaboration & MCP Server
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8b949e] hover:text-white p-1 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Active MCP Tools info banner */}
          <div className="p-3.5 bg-[#0d1117] border border-[#30363d] rounded-lg">
            <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2">
              <Cpu className="w-4 h-4 text-[#3fb950]" />
              <span>Injected Quay MCP Server (Active)</span>
            </div>
            <p className="text-xs text-[#8b949e] mb-2.5">
              Every Claude Code terminal is provisioned with the embedded <code className="text-[#58a6ff]">quay</code> MCP server. Agents can autonomously invoke these tools:
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2 bg-[#161b22] border border-[#30363d] rounded">
                <span className="text-[#58a6ff] font-bold">quay_list_agents</span>
                <p className="text-[10px] text-[#8b949e] font-sans mt-0.5">Discover peer agents & status</p>
              </div>
              <div className="p-2 bg-[#161b22] border border-[#30363d] rounded">
                <span className="text-[#58a6ff] font-bold">quay_send_message</span>
                <p className="text-[10px] text-[#8b949e] font-sans mt-0.5">Send task & await reply turn</p>
              </div>
              <div className="p-2 bg-[#161b22] border border-[#30363d] rounded">
                <span className="text-[#58a6ff] font-bold">quay_get_agent_status</span>
                <p className="text-[10px] text-[#8b949e] font-sans mt-0.5">Inspect turn state & actions</p>
              </div>
              <div className="p-2 bg-[#161b22] border border-[#30363d] rounded">
                <span className="text-[#58a6ff] font-bold">quay_broadcast</span>
                <p className="text-[10px] text-[#8b949e] font-sans mt-0.5">Broadcast toast to all agents</p>
              </div>
            </div>
          </div>

          {/* Manual Dispatch Section */}
          <div className="p-4 bg-[#0d1117] border border-[#30363d] rounded-lg">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] mb-3 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>Manual Agent Handoff / Test Dispatch</span>
            </h3>

            {claudeTerminals.length < 2 ? (
              <div className="text-xs text-[#8b949e] p-2 bg-[#161b22] rounded border border-[#30363d]">
                Launch at least 2 Claude Code terminals to dispatch inter-agent tasks.
              </div>
            ) : (
              <form onSubmit={handleSendPrompt} className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] text-[#8b949e] mb-1">From Agent</label>
                    <select
                      value={fromTerminal}
                      onChange={(e) => setFromTerminal(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-white"
                    >
                      {claudeTerminals.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <ArrowRight className="w-4 h-4 text-[#8b949e] mt-5 shrink-0" />

                  <div className="flex-1">
                    <label className="block text-[11px] text-[#8b949e] mb-1">To Agent</label>
                    <select
                      value={toTerminal}
                      onChange={(e) => setToTerminal(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-white"
                    >
                      {claudeTerminals
                        .filter((t) => t.id !== fromTerminal)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.id})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Task instruction or prompt to dispatch to peer agent..."
                    rows={2}
                    className="w-full p-2.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-white focus:outline-hidden focus:border-[#58a6ff]"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-[#8b949e] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={asUser}
                      onChange={(e) => setAsUser(e.target.checked)}
                      className="rounded bg-[#161b22] border-[#30363d]"
                    />
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Send as user's own prompt</span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSending || !prompt.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Dispatch Task</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Broadcast Section */}
          <div className="p-4 bg-[#0d1117] border border-[#30363d] rounded-lg">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] mb-2 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-[#3fb950]" />
              <span>Broadcast Notice to All Claude Sessions</span>
            </h3>

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
                disabled={!broadcastText.trim()}
                className="px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
              >
                Broadcast
              </button>
            </form>
          </div>

          {/* Messages History */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-[#a371f7]" />
                <span>Live A2A Message & Tool Call Trail ({messages.length})</span>
              </h3>
              <button
                onClick={loadMessages}
                className="text-[11px] text-[#58a6ff] hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>

            <div className="space-y-2.5 max-h-56 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="text-xs text-[#8b949e] text-center py-6 bg-[#0d1117] rounded border border-[#30363d]">
                  No inter-agent messages dispatched yet. When agents invoke <code className="text-[#58a6ff]">quay_send_message</code>, conversations appear here.
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 bg-[#0d1117] border border-[#30363d] rounded-md text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[11px] text-[#8b949e]">
                      <span className="font-semibold text-[#58a6ff]">
                        {m.from_terminal} → {m.to_terminal}
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
                        <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <div className="text-white text-xs font-mono bg-[#161b22] p-2 rounded border border-[#30363d]/50">
                      {m.content}
                    </div>

                    {m.response && (
                      <div className="mt-1 pl-2 border-l-2 border-[#3fb950] text-[#7ee787] text-[11px] font-mono">
                        <span className="text-[#8b949e] block font-sans text-[10px]">Reply:</span>
                        {m.response}
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
