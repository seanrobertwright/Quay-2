import { useEffect } from "react";
import { X } from "lucide-react";
import { focusTerminal } from "../terminal/terminalRequests.ts";
import { askForConnectRow, dismissNote, sayNotConnected, useNoteTerminal } from "./antigravity.ts";

interface ConnectNoteProps {
  /** An Antigravity terminal. */
  terminalId: string;
  /** Whether its pane is on the stage and its process has not exited. */
  shown: boolean;
}

/**
 * The line an Antigravity terminal shows while Antigravity is not connected, with a link to the
 * Connect row. One terminal shows it, once on this machine.
 */
export const ConnectNote = ({ terminalId, shown }: ConnectNoteProps) => {
  const noteTerminal = useNoteTerminal();

  useEffect(() => {
    if (!shown) return;
    let stillShown = true;
    void sayNotConnected(terminalId, () => stillShown);
    return () => {
      stillShown = false;
    };
  }, [terminalId, shown]);

  if (noteTerminal !== terminalId) return null;
  return (
    <div
      role="status"
      data-no-terminal-focus
      className="px-2.5 py-1 border-b border-[#30363d] bg-[#161b22] flex items-center gap-2 text-[11px] text-[#c9d1d9] shrink-0"
    >
      <p className="flex-1 min-w-0 leading-5">
        Antigravity is not connected to Quay, so it can't show you questions, reviews or boards.{" "}
        <button
          type="button"
          onClick={() => {
            dismissNote();
            askForConnectRow();
          }}
          className="text-[#58a6ff] hover:text-[#79c0ff] hover:underline cursor-pointer"
        >
          Connect Antigravity in Settings
        </button>
      </p>
      <button
        type="button"
        onClick={() => {
          dismissNote();
          focusTerminal(terminalId);
        }}
        aria-label="Dismiss the Connect note"
        title="Dismiss"
        className="p-0.5 rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
