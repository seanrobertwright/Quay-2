import { ShieldAlert } from "lucide-react";
import type { PermissionItem } from "../attention/attentionQueue.ts";
import type { AnswerPermission } from "../attention/useAttentionQueue.ts";
import { splitPermissionInput } from "../attention/permissionInput.ts";
import { Button } from "../parts/Button.tsx";
import { AttributedText } from "./AttributedText.tsx";
import { CodeBlock } from "./CodeBlock.tsx";
import { DangerButton } from "./DangerButton.tsx";
import { PermissionInputBox } from "./PermissionInputBox.tsx";
import { QuayCard } from "./QuayCard.tsx";
import { ScrollBox } from "./ScrollBox.tsx";

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
      <ScrollBox kind="line" label="Who asks">
        <p className="wrap-anywhere">
          {terminalName} asks to use <code className="text-white">{permission.tool}</code>
        </p>
      </ScrollBox>
      {summary && <CodeBlock label={`Summary of the ${permission.tool} input`} text={summary} />}
      {rest.length > 0 && <PermissionInputBox label={summary ? `Rest of the ${permission.tool} input` : `${permission.tool} input`} rest={rest} />}
      {permission.reason && <AttributedText label={`${terminalName} says`} text={permission.reason} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void onAnswer(permission.requestId, "allow", undefined, false)}>
          Allow once
        </Button>
        <Button onClick={() => void onAnswer(permission.requestId, "allow", undefined, true)}>Allow for session</Button>
        <DangerButton onClick={() => void onAnswer(permission.requestId, "deny")}>Deny</DangerButton>
      </div>
    </QuayCard>
  );
};
