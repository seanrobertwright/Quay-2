import { X, ShieldAlert, CheckCircle2, AlertOctagon, Terminal as TerminalIcon } from "lucide-react";
import { Envelope } from "./useBridgeEvents";

interface ActionLogDrawerProps {
  isOpen: boolean;
  terminalId: string | null;
  events: Envelope[];
  onClose: () => void;
}

export const ActionLogDrawer: React.FC<ActionLogDrawerProps> = ({
  isOpen,
  terminalId,
  events,
  onClose,
}) => {
  if (!isOpen) return null;

  // Filter tool events for this terminal
  const toolEvents = events.filter(
    (e) =>
      e.tag === terminalId &&
      (e.type === "tool.started" || e.type === "tool.finished")
  );

  const isDestructive = (input: any) => {
    if (!input) return false;
    const str = typeof input === "string" ? input : JSON.stringify(input);
    return (
      str.includes("rm -rf") ||
      str.includes("git push --force") ||
      str.includes("git reset --hard") ||
      str.includes("drop database") ||
      str.includes("del /f")
    );
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 bg-[#161b22] border-l border-[#30363d] shadow-2xl flex flex-col text-[#c9d1d9] animate-in slide-in-from-right duration-150">
      <div className="h-12 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-4 h-4 text-[#58a6ff]" />
          <h2 className="text-sm font-semibold text-white">
            Action Log: {terminalId}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="text-[#8b949e] hover:text-white p-1 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {toolEvents.length === 0 ? (
          <div className="text-center py-12 text-xs text-[#8b949e]">
            No tool calls recorded yet for this terminal session.
          </div>
        ) : (
          toolEvents.map((e, idx) => {
            const destructive = isDestructive(e.data?.input);
            const isFinished = e.type === "tool.finished";

            return (
              <div
                key={`${e.seq}-${idx}`}
                className={`p-3 rounded-md border text-xs transition-colors ${
                  destructive
                    ? "bg-[#ff7b72]/10 border-[#ff7b72]/50 text-white"
                    : "bg-[#0d1117] border-[#30363d] text-[#c9d1d9]"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    {destructive ? (
                      <AlertOctagon className="w-3.5 h-3.5 text-[#ff7b72]" />
                    ) : isFinished ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#3fb950]" />
                    ) : (
                      <ShieldAlert className="w-3.5 h-3.5 text-[#d29922]" />
                    )}
                    <span>{e.data?.tool || "Tool"}</span>
                    {destructive && (
                      <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-[#ff7b72] text-black">
                        DESTRUCTIVE
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#8b949e] font-mono">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                </div>

                {e.data?.input && (
                  <pre className="mt-1 p-2 bg-[#161b22] rounded text-[11px] font-mono overflow-x-auto text-[#8b949e] max-h-32">
                    {typeof e.data.input === "string"
                      ? e.data.input
                      : JSON.stringify(e.data.input, null, 2)}
                  </pre>
                )}

                {isFinished && e.data?.durationMs && (
                  <div className="mt-1.5 text-[10px] text-[#8b949e] flex justify-between font-mono">
                    <span>Status: {e.data.status}</span>
                    <span>{e.data.durationMs}ms</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
