import { ShieldAlert } from "lucide-react";
import type { PermissionItem } from "../attention/attentionQueue.ts";
import type { AnswerPermission } from "../attention/useAttentionQueue.ts";
import { splitPermissionInput } from "../attention/permissionInput.ts";
import { AttributedText } from "./AttributedText.tsx";
import { CodeBlock } from "./CodeBlock.tsx";
import { PermissionInputBox } from "./PermissionInputBox.tsx";
import { QuayCard } from "./QuayCard.tsx";

const BUTTON = "h-7 shrink-0 px-3 rounded-md border text-xs font-medium";

interface PermissionCardProps {
  permission: PermissionItem;
  /** The name of the terminal that asks. */
  terminalName: string;
  onAnswer: AnswerPermission;
}

/**
 * A pending permission request, a Quay card: which terminal asks to use which tool, what on, the
 * input its summary leaves out, the agent's reason, and the three answers.
 */
export const PermissionCard = ({ permission, terminalName, onAnswer }: PermissionCardProps) => {
  const { summary, rest } = splitPermissionInput(permission.input);
  return (
    <QuayCard title="Permission request" icon={ShieldAlert}>
      {/* Neither name is Quay's, so a long one scrolls too. */}
      <p className="max-h-12 overflow-y-auto wrap-anywhere">
        {terminalName} asks to use <code className="text-white">{permission.tool}</code>
      </p>
      {summary && <CodeBlock label={`Summary of the ${permission.tool} input`} text={summary} />}
      {rest.length > 0 && <PermissionInputBox tool={permission.tool} rest={rest} />}
      {permission.reason && <AttributedText label={`${terminalName} says`} text={permission.reason} />}
      <div className="flex flex-wrap gap-2">
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
      </div>
    </QuayCard>
  );
};
