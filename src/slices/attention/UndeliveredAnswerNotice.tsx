import { FC } from "react";
import { AlertCircle, X } from "lucide-react";
import type { TerminalInfo } from "../terminal/types";
import type { UndeliveredAnswer } from "./attentionQueue";

interface UndeliveredAnswerNoticeProps {
  answer: UndeliveredAnswer;
  terminals: TerminalInfo[];
  onDismiss: () => void;
}

/**
 * Tells the user that an answer they gave to a permission request reached no agent, because the
 * agent had stopped waiting for it. It stays until the user closes it or a newer one replaces it.
 */
export const UndeliveredAnswerNotice: FC<UndeliveredAnswerNoticeProps> = ({
  answer,
  terminals,
  onDismiss,
}) => {
  const terminal = terminals.find((t) => t.id === answer.terminalId);
  const request = answer.tool ? `The ${answer.tool} request` : "The permission request";
  const where = terminal ? ` in ${terminal.name}` : "";
  return (
    <div
      role="alert"
      className="fixed bottom-20 right-4 max-w-md bg-[#161b22] border border-[#f85149] text-white p-3 rounded-lg shadow-xl z-50 flex items-start gap-2.5 animate-in fade-in slide-in-from-bottom-2"
    >
      <AlertCircle className="w-5 h-5 text-[#f85149] shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 text-xs">
        <div className="font-semibold text-[#f85149]">Answer not delivered</div>
        <div className="text-[#c9d1d9] mt-0.5">
          {request}
          {where} had stopped waiting, so the agent did not get your answer.
        </div>
        <div className="text-[#8b949e] mt-1">{answer.error}</div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[#8b949e] hover:text-white p-0.5"
        aria-label="Dismiss undelivered answer notice"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
