import { inOneLine, NOTHING_GIVEN, questionParts, type AskAnswer } from "../typed/ask.ts";

/** What the operator sent to an ask, in a line. */
export const askAnswerInLine = (answer: unknown): string =>
  (answer as { answers: AskAnswer[] }).answers.map(({ chosen, text = "" }) => inOneLine({ chosen, text })).join("; ");

/** An answered ask: each question with what the operator sent. */
export const AskSettled = ({ answer }: { answer: unknown }) => {
  // The store hands back what `collapse` made of the operator's action.
  const { answers } = answer as { answers: AskAnswer[] };
  return (
    <dl className="flex min-w-0 flex-col gap-2 wrap-anywhere">
      {answers.map(({ question, chosen, text }, i) => (
        // Two questions may have the same words, so each goes by its part's name
        <div key={questionParts(i).question}>
          <dt className="text-[11px] text-[#8b949e]">{question}</dt>
          {chosen.map((label) => (
            <dd key={label} className="text-white">
              {label}
            </dd>
          ))}
          {text !== undefined && <dd className="whitespace-pre-wrap text-white">{text}</dd>}
          {chosen.length === 0 && text === undefined && <dd className="text-[#8b949e]">{NOTHING_GIVEN}</dd>}
        </div>
      ))}
    </dl>
  );
};
