import { useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useOverlay } from "../overlay/useOverlay.ts";

interface BroadcastDialogProps {
  isOpen: boolean;
  /** The active project, whose running agents the line reaches. */
  project: string;
  onClose: () => void;
}

/**
 * Broadcast to all agents, opened from the palette: one line typed into every running agent of the
 * active project, as the operator. A worktree is its own project, as on the stage.
 */
export const BroadcastDialog = ({ isOpen, project, onClose }: BroadcastDialogProps) => {
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const { backdropProps, panelProps } = useOverlay({ isOpen, onClose, initialFocusRef: fieldRef });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isOpen) return null;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await invoke("a2a_broadcast_toast", { text, project });
      setText("");
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  };
  return (
    <div {...backdropProps} className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 p-4">
      <div
        {...panelProps}
        aria-label="Broadcast to all agents"
        className="focus:outline-hidden w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-4 space-y-3 text-[#c9d1d9]"
      >
        <h2 className="text-sm font-semibold text-white">Broadcast to all agents</h2>
        <p className="text-xs text-[#8b949e]">One line, typed into every running agent in this project.</p>
        <form onSubmit={send} className="flex items-center gap-2">
          <input
            ref={fieldRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Broadcast message"
            placeholder="Message every agent"
            className="min-w-0 flex-1 h-8 px-2 rounded-md border border-[#30363d] bg-[#0d1117] text-xs text-white placeholder-[#8b949e] focus:border-(--quay-accent) focus:outline-hidden"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="shrink-0 h-8 px-3 rounded-md border border-[#1f6feb] bg-[#1f6feb] text-xs font-medium text-white enabled:hover:bg-[#388bfd] disabled:opacity-50"
          >
            Broadcast
          </button>
        </form>
        {error && (
          <p role="alert" className="text-[11px] text-[#f85149]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};
