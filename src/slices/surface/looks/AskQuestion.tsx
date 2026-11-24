import { useId } from "react";
import type { LayoutProps } from "../layout.ts";
import type { AskedQuestion } from "../typed/ask.ts";

interface AskQuestionProps {
  question: AskedQuestion;
  part: LayoutProps["part"];
  /** Draws the question above its inputs. A listed question is in its own line. */
  titled?: boolean;
}

/** One question's inputs, named by the question. */
export const AskQuestion = ({ question: { question, kind, parts }, part, titled = false }: AskQuestionProps) => {
  const titleId = useId();
  return (
    <div role="group" aria-label={titled ? undefined : question} aria-labelledby={titled ? titleId : undefined} className="flex min-w-0 flex-col gap-2.5">
      {titled && (
        // Drawn here and not by its Text part, because a question is plain text
        <p id={titleId} className="font-semibold wrap-anywhere whitespace-pre-wrap text-white">
          {question}
        </p>
      )}
      {kind !== "words" && part(parts.choice)}
      {part(parts.text)}
    </div>
  );
};
