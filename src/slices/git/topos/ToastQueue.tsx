import React, { useEffect } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import type { Toast } from "./toasts";

/** How long a success stays before it fades, unless it sets its own; a failure stays until dismissed. */
const DONE_MS = 6000;

/** One toast; a success dismisses itself after its `ttlMs`, or [`DONE_MS`]. */
const ToastCard: React.FC<{ toast: Toast; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    if (toast.tone !== "done") return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.ttlMs ?? DONE_MS);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);
  const failed = toast.tone === "failed";
  const Icon = failed ? AlertTriangle : CheckCircle2;
  return (
    <li
      className={`pointer-events-auto flex items-start gap-2 w-80 px-3 py-2 rounded-md border shadow-lg bg-[#161b22] text-xs ${
        failed ? "border-[#f85149]/50" : "border-[#3fb950]/50"
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 mt-px ${failed ? "text-[#f85149]" : "text-[#3fb950]"}`} aria-hidden="true" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Text children only: ref names and paths are untrusted, so React escapes them. */}
        <p className="text-[#c9d1d9] break-words">{toast.text}</p>
        {toast.lines && toast.lines.length > 0 && (
          <ul className="font-mono text-[11px] text-[#8b949e]">
            {toast.lines.map((line) => (
              <li key={line} className="truncate" title={line}>
                {line}
              </li>
            ))}
          </ul>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.run();
              onDismiss(toast.id);
            }}
            className="self-start px-2 py-0.5 rounded border border-[#30363d] text-[#58a6ff] hover:bg-[#21262d] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="p-0.5 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </li>
  );
};

/**
 * Topos's toast queue (#367, #393, #394): the results of ref operations, bottom right, newest
 * last. The list sits in a `role="status"` live region, so each toast is announced as it arrives.
 */
export const ToastQueue: React.FC<{ toasts: readonly Toast[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => (
  <div role="status" aria-live="polite" aria-label="Topos notifications" className="pointer-events-none absolute bottom-10 right-4 z-40">
    <ul className="flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </ul>
  </div>
);
