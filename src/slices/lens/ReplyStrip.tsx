import type { PermissionItem } from "../attention/attentionQueue.ts";
import type { AnswerPermission } from "../attention/useAttentionQueue.ts";
import { splitPermissionInput, toolInputSummary } from "../attention/permissionInput.ts";

interface ReplyStripProps {
  /** The selected terminal's name. */
  terminalName: string;
  /** The terminal's newest waiting permission request, or null when it asks nothing. */
  permission: PermissionItem | null;
  onAnswer: AnswerPermission;
  /** Shows the selected terminal's Activity view in the companion, for the request's whole input. */
  onShowActivity: () => void;
}

const BUTTON = "h-7 shrink-0 px-3 rounded-md border text-xs font-medium";

/**
 * The strip at a lens's foot: the selected terminal's last question and its reply buttons, so the
 * operator answers the agent without leaving the lens. The question is the terminal's newest
 * waiting permission request; its replies are the attention queue's Allow once, Allow for session
 * and Deny. While the permission card in the Activity view draws input beside its summary
 * (`splitPermissionInput`), Whole input shows that view, even where the strip's one line is already
 * that input's JSON, cut to the strip's width.
 */
export const ReplyStrip = ({ terminalName, permission, onAnswer, onShowActivity }: ReplyStripProps) => (
  <footer
    aria-label="Reply strip"
    className="shrink-0 flex items-center gap-2 min-h-11 px-3 py-1.5 border-t border-[#30363d] bg-[#161b22] text-xs"
  >
    <b className="shrink-0 text-white">{terminalName}</b>
    {permission ? (
      <>
        <span className="min-w-0 flex-1 truncate text-[#c9d1d9]" title={toolInputSummary(permission.input)}>
          <span className="text-[#e3b341]">{permission.tool}</span>{" "}
          <code>{toolInputSummary(permission.input)}</code>
          {permission.reason && <span className="text-[#8b949e]"> · {permission.reason}</span>}
        </span>
        {splitPermissionInput(permission.input).rest.length > 0 && (
          <button
            type="button"
            onClick={onShowActivity}
            className={`${BUTTON} border-[#30363d] bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]`}
          >
            Whole input
          </button>
        )}
        <button
          type="button"
          onClick={() => void onAnswer(permission.requestId, "allow", undefined, false)}
          className={`${BUTTON} border-[#2ea043] bg-[#238636] text-white hover:bg-[#2ea043]`}
        >
          Allow once
        </button>
        <button
          type="button"
          onClick={() => void onAnswer(permission.requestId, "allow", undefined, true)}
          className={`${BUTTON} border-[#30363d] bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]`}
        >
          Allow for session
        </button>
        <button
          type="button"
          onClick={() => void onAnswer(permission.requestId, "deny")}
          className={`${BUTTON} border-[#da3633] bg-[#da3633] text-white hover:bg-[#f85149]`}
        >
          Deny
        </button>
      </>
    ) : (
      <span className="text-[#8b949e]">{terminalName} is not asking anything.</span>
    )}
  </footer>
);
