import React, { useState, useEffect, useId } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

export interface WorktreeRemovalPrompt {
  repoPath: string;
  worktreePath: string;
  /** Git's error, shown verbatim. */
  message: string;
}

interface RemoveWorktreeDialogProps {
  prompt: WorktreeRemovalPrompt | null;
  onCancel: () => void;
  /** Runs the forced remove; a rejection is shown in the dialog. */
  onRemoveAnyway: (prompt: WorktreeRemovalPrompt) => Promise<void>;
}

/** Shows why git would not remove a worktree and offers Remove anyway. */
export const RemoveWorktreeDialog: React.FC<RemoveWorktreeDialogProps> = ({
  prompt,
  onCancel,
  onRemoveAnyway,
}) => {
  const titleId = useId();
  const messageId = useId();
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsRemoving(false);
    setError(null);
  }, [prompt]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && prompt && !isRemoving) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prompt, isRemoving, onCancel]);

  if (!prompt) return null;

  const handleRemoveAnyway = async () => {
    setIsRemoving(true);
    setError(null);
    try {
      await onRemoveAnyway(prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="px-5 py-4 border-b border-[#30363d] flex items-center gap-3 bg-[#0d1117]/80">
          <div className="p-2 rounded-md bg-[#d29922]/15 text-[#d29922] border border-[#d29922]/30">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-bold text-white">
              Worktree not removed
            </h2>
            <p className="text-xs text-[#8b949e] mt-0.5 font-mono truncate" title={prompt.worktreePath}>
              {prompt.worktreePath}
            </p>
          </div>
        </div>

        <div className="p-5 space-y-3">
          <pre
            id={messageId}
            className="p-3 text-xs bg-[#0d1117] border border-[#30363d] text-[#ff7b72] rounded-md whitespace-pre-wrap break-words max-h-64 overflow-auto font-mono"
          >
            {prompt.message}
          </pre>
          <p className="text-xs text-[#8b949e]">
            Remove anyway runs <code className="font-mono">git worktree remove --force</code>, which
            discards the worktree's uncommitted changes and closes its terminals.
          </p>
          {error && (
            <pre
              role="alert"
              className="p-3 text-xs bg-[#f85149]/10 border border-[#f85149]/30 text-[#ff7b72] rounded-md whitespace-pre-wrap break-words max-h-40 overflow-auto font-mono"
            >
              {error}
            </pre>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#30363d] flex items-center justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            disabled={isRemoving}
            className="px-3.5 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d] rounded-md transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRemoveAnyway}
            disabled={isRemoving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#da3633] hover:bg-[#f85149] text-white rounded-md shadow-sm transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isRemoving ? "Removing..." : "Remove anyway"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
