import { FC, useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  X,
  ExternalLink,
  Megaphone,
} from "lucide-react";
import { TerminalInfo } from "../terminal/types";
import { AgentIcon } from "../terminal/AgentIcons";
import type { TrailStatus } from "./trailEntry";

export interface A2ADispatchPayload {
  id: string;
  from_terminal: string;
  to_terminal: string;
  from_name?: string | null;
  to_name?: string | null;
  content: string;
  as_user?: boolean;
  broadcast?: boolean;
  timestamp: number;
  status: TrailStatus;
  response?: string | null;
}

/** The `a2a-toast` payload: a broadcast's notice and who sent it ("You" from Mission Control). */
export interface BroadcastToastPayload {
  text: string;
  from_name: string;
}

interface ToastItem {
  id: string;
  kind: "a2a" | "broadcast";
  fromTerminalId?: string;
  toTerminalId?: string;
  fromName?: string;
  toName?: string;
  content: string;
  response?: string | null;
  status?: TrailStatus;
  timestamp: number;
}

interface A2AToastProps {
  terminals: TerminalInfo[];
  onSelectTerminal?: (terminalId: string) => void;
}

export const A2AToast: FC<A2AToastProps> = ({ terminals, onSelectTerminal }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const resolveTerminalInfo = (idOrName?: string) => {
    if (!idOrName) return undefined;
    return terminals.find(
      (t) =>
        t.id === idOrName ||
        t.name.toLowerCase() === idOrName.toLowerCase() ||
        t.run_kind.toLowerCase() === idOrName.toLowerCase()
    );
  };

  useEffect(() => {
    // 1. Listen for A2A Message Dispatched
    const unlistenDispatchedPromise = listen<A2ADispatchPayload>(
      "a2a-message-dispatched",
      (event) => {
        const payload = event.payload;
        // Broadcasts are handled by the dedicated "a2a-toast" listener below
        if (payload.broadcast) return;

        const fromInfo = resolveTerminalInfo(payload.from_name || payload.from_terminal);
        const toInfo = resolveTerminalInfo(payload.to_name || payload.to_terminal);

        const newToast: ToastItem = {
          id: payload.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: "a2a",
          fromTerminalId: fromInfo?.id || payload.from_terminal,
          toTerminalId: toInfo?.id || payload.to_terminal,
          fromName: fromInfo?.name || payload.from_name || payload.from_terminal,
          toName: toInfo?.name || payload.to_name || payload.to_terminal,
          content: payload.content,
          response: payload.response,
          status: payload.status || "dispatched",
          timestamp: payload.timestamp || Date.now(),
        };

        setToasts((prev) => {
          const filtered = prev.filter((t) => t.id !== newToast.id);
          return [newToast, ...filtered].slice(0, 5);
        });

        // Auto-dismiss after 7 seconds
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
        }, 7000);
      }
    );

    // 2. Listen for A2A Message Updated (e.g. response received)
    const unlistenUpdatedPromise = listen<A2ADispatchPayload>(
      "a2a-message-updated",
      (event) => {
        const payload = event.payload;
        setToasts((prev) =>
          prev.map((t) => {
            if (t.id === payload.id) {
              return {
                ...t,
                status: payload.status,
                response: payload.response,
              };
            }
            return t;
          })
        );
      }
    );

    // 3. Listen for Swarm Broadcast Toast
    const unlistenBroadcastPromise = listen<BroadcastToastPayload>("a2a-toast", (event) => {
      const { text, from_name } = event.payload;
      const bToast: ToastItem = {
        id: `broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "broadcast",
        fromName: from_name,
        content: text,
        timestamp: Date.now(),
      };

      setToasts((prev) => [bToast, ...prev].slice(0, 5));

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== bToast.id));
      }, 7000);
    });

    return () => {
      unlistenDispatchedPromise.then((unlisten) => unlisten());
      unlistenUpdatedPromise.then((unlisten) => unlisten());
      unlistenBroadcastPromise.then((unlisten) => unlisten());
    };
  }, [terminals]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const fromTerm = resolveTerminalInfo(toast.fromTerminalId);
        const toTerm = resolveTerminalInfo(toast.toTerminalId);

        if (toast.kind === "broadcast") {
          return (
            <div
              key={toast.id}
              className="pointer-events-auto bg-[#161b22]/95 border border-[#3fb950]/50 shadow-2xl rounded-lg p-3 text-white backdrop-blur transition-all duration-300 animate-in fade-in slide-in-from-top-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#3fb950]">
                  <Megaphone className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />
                  <span>Swarm Broadcast from {toast.fromName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                  className="text-[#8b949e] hover:text-white p-0.5 rounded cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="mt-1.5 text-xs text-[#e6edf3] font-mono leading-relaxed bg-[#0d1117]/80 p-2 rounded border border-[#30363d]/60">
                {toast.content}
              </p>
            </div>
          );
        }

        return (
          <div
            key={toast.id}
            className="pointer-events-auto bg-[#161b22]/95 border border-[#1f6feb]/60 shadow-2xl rounded-lg p-3 text-white backdrop-blur transition-all duration-300 animate-in fade-in slide-in-from-top-3 flex flex-col gap-2"
          >
            {/* Top Bar: Live A2A Route and Status Tag */}
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#58a6ff] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#58a6ff]" />
                </span>

                <div className="flex items-center gap-1 text-xs min-w-0">
                  <div className="flex items-center gap-1 font-semibold text-[#c9d1d9] truncate">
                    <AgentIcon kind={fromTerm?.run_kind} className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[90px]">{toast.fromName}</span>
                  </div>

                  <ArrowRight className="w-3 h-3 text-[#58a6ff] shrink-0" />

                  <div className="flex items-center gap-1 font-semibold text-[#58a6ff] truncate">
                    <AgentIcon kind={toTerm?.run_kind} className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[90px]">{toast.toName}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {toast.status === "completed" ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    <span>DONE</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[#1f6feb]/20 text-[#58a6ff] border border-[#1f6feb]/40 animate-pulse">
                    <Clock className="w-2.5 h-2.5" />
                    <span>DISPATCHED</span>
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                  className="text-[#8b949e] hover:text-white p-0.5 rounded cursor-pointer transition-colors"
                  title="Dismiss notification"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Task Prompt Body */}
            <div className="text-xs font-mono text-[#c9d1d9] bg-[#0d1117] p-2 rounded border border-[#30363d]/60 max-h-20 overflow-y-auto leading-relaxed">
              <span className="text-[#8b949e] text-[10px] select-none block mb-0.5 font-sans font-medium">
                TASK DELEGATION:
              </span>
              <p className="line-clamp-2">{toast.content}</p>
            </div>

            {/* Response Preview if available */}
            {toast.response && (
              <div className="text-xs font-mono text-[#3fb950] bg-[#238636]/10 p-2 rounded border border-[#238636]/30 max-h-20 overflow-y-auto leading-relaxed">
                <span className="text-[#3fb950] text-[10px] select-none block mb-0.5 font-sans font-medium">
                  REPLY:
                </span>
                <p className="line-clamp-2">{toast.response}</p>
              </div>
            )}

            {/* Actions: View Receiving Terminal */}
            {toast.toTerminalId && onSelectTerminal && (
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (toast.toTerminalId) {
                      onSelectTerminal(toast.toTerminalId);
                      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1f6feb]/20 hover:bg-[#1f6feb]/30 text-[#58a6ff] hover:text-white rounded text-xs font-medium border border-[#1f6feb]/40 transition-colors cursor-pointer"
                >
                  <span>View Terminal</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
