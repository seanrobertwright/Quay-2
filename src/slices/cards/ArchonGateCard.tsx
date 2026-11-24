import { useState } from "react";
import { ShieldQuestion } from "lucide-react";
import { useGatePrompt } from "../archon/useGatePrompt.ts";
import { Button } from "../parts/Button.tsx";
import { TextField } from "../parts/TextField.tsx";
import { AttributedText } from "./AttributedText.tsx";
import { QuayCard } from "./QuayCard.tsx";

interface ArchonGateCardProps {
  runId: string;
  /** True while an answer is on its way. */
  busy: boolean;
  /** Answers the gate, with the operator's comment, empty for none. */
  onDecide: (decision: "approve" | "reject", comment: string) => Promise<void>;
  /** Opens the run lens on this run. */
  onOpenLens: () => void;
}

/**
 * An Archon run at an approval gate, a Quay card: the gate's prompt, a comment, and Approve or
 * Reject. While the prompt is being read it says so and asks neither. When there is none to show it
 * says so, with the reason if the read failed, and offers the run lens in place of Approve and
 * Reject. A comment belongs to the gate it was typed for.
 */
export const ArchonGateCard = ({ runId, busy, onDecide, onOpenLens }: ArchonGateCardProps) => {
  const { gatePrompt, readAgain } = useGatePrompt(runId);
  const [draft, setDraft] = useState<{ gate: string; text: string } | null>(null);
  return (
    <QuayCard title="This run waits for your approval." icon={ShieldQuestion}>
      {gatePrompt.state === "read" ? (
        <GateQuestion
          prompt={gatePrompt.prompt}
          comment={draft?.gate === gatePrompt.gate ? draft.text : ""}
          busy={busy}
          onComment={(text) => setDraft({ gate: gatePrompt.gate, text })}
          // Answered or refused, the run may be at another gate by now.
          onDecide={(decision, comment) => void onDecide(decision, comment).finally(readAgain)}
        />
      ) : (
        <>
          <p role="status">
            {gatePrompt.state === "reading"
              ? "Reading what the workflow asks…"
              : "Quay could not read what the workflow asks, so this card does not offer Approve or Reject."}
          </p>
          {gatePrompt.state === "unreadable" && gatePrompt.reason !== null && <AttributedText label="Why it could not be read" text={gatePrompt.reason} />}
          {gatePrompt.state === "unreadable" && <Button onClick={onOpenLens}>Graph and log</Button>}
        </>
      )}
    </QuayCard>
  );
};

interface GateQuestionProps {
  prompt: string;
  comment: string;
  busy: boolean;
  onComment: (text: string) => void;
  onDecide: (decision: "approve" | "reject", comment: string) => void;
}

const GateQuestion = ({ prompt, comment, busy, onComment, onDecide }: GateQuestionProps) => (
  <>
    <AttributedText kind="tall" label="The workflow asks" text={prompt} />
    <TextField label="Comment (optional)" rows={2} value={comment} onChange={onComment} />
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" disabled={busy} onClick={() => onDecide("approve", comment)}>
        Approve
      </Button>
      <Button disabled={busy} onClick={() => onDecide("reject", comment)}>
        Reject
      </Button>
    </div>
  </>
);
