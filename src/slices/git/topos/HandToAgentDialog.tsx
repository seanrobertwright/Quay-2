import React, { useEffect, useId, useRef } from "react";
import { AlertTriangle, Bot, Loader2, Plus } from "lucide-react";
import { useDialogFocus, usePopupLayer } from "../../overlay/useOverlay";
import { filesWord, NEW_AGENT_RUN_KIND } from "./handOff";
import type { HandOffChoice, HandOffPicker } from "./useHandToAgent";

export interface HandToAgentDialogProps {
  picker: HandOffPicker | null;
  onChoose: (choice: HandOffChoice) => void;
  onCancel: () => void;
}

/**
 * The Hand to agent picker (#352, #392): the live agent terminals whose cwd is this worktree, each
 * a button in a labelled list, then "New agent here". With none running, the list says so and New
 * agent here is the choice. Focus is trapped inside and starts on the first choice; Escape cancels
 * it before it closes Topos. File and agent names are untrusted and shown only as text.
 */
export const HandToAgentDialog: React.FC<HandToAgentDialogProps> = ({ picker, onChoose, onCancel }) => {
  const titleId = useId();
  const detailId = useId();
  const listId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const open = picker !== null;
  usePopupLayer(open, onCancel, panel);
  useDialogFocus(open, panel);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  if (picker === null) return null;
  const { paths, agents, sending, failure } = picker;
  const files = filesWord(paths);
  const choiceClass =
    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-xs text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60";

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        aria-busy={sending}
        className="w-full max-w-md bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-4 flex flex-col gap-3"
      >
        <h3 id={titleId} className="text-sm font-semibold text-white break-words">
          Hand {files} to an agent
        </h3>
        <p id={detailId} className="text-xs text-[#8b949e] break-words">
          The agent is told to resolve and git add only, never to continue, commit or push. Topos leaves the {paths.length === 1 ? "file" : "files"} alone
          until the agent stages {paths.length === 1 ? "it" : "them"} or you take {paths.length === 1 ? "it" : "them"} back.
        </p>
        <h4 id={listId} className="text-[11px] font-semibold uppercase tracking-wide text-[#8b949e]">
          Agent terminals in this worktree
        </h4>
        {agents.length === 0 ? (
          <p className="text-xs text-[#c9d1d9]">No agent terminal is running in this worktree. Start a new one here.</p>
        ) : (
          <ul aria-labelledby={listId} className="flex flex-col gap-1 max-h-60 overflow-y-auto">
            {agents.map((agent, n) => (
              <li key={agent.terminalId}>
                <button
                  ref={n === 0 ? first : undefined}
                  type="button"
                  disabled={sending}
                  onClick={() => onChoose({ kind: "agent", agent })}
                  className={choiceClass}
                >
                  <Bot className="w-3.5 h-3.5 shrink-0 text-[#06B6D4]" aria-hidden="true" />
                  <span className="flex-1 min-w-0 truncate">{agent.name}</span>
                  <span className="shrink-0 text-[11px] text-[#8b949e]">{agent.runKind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          ref={agents.length === 0 ? first : undefined}
          type="button"
          disabled={sending}
          onClick={() => onChoose({ kind: "new" })}
          className={choiceClass}
        >
          <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">New agent here</span>
          <span className="shrink-0 text-[11px] text-[#8b949e]">{NEW_AGENT_RUN_KIND}</span>
        </button>
        {failure !== null && (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-[#ff7b72] break-words">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{failure}</span>
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {sending && (
            <span role="status" className="mr-auto inline-flex items-center gap-1.5 text-xs text-[#8b949e]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Handing off…
            </span>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="px-3 py-1.5 rounded-md text-xs text-[#c9d1d9] hover:bg-[#21262d] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
