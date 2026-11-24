import type { AskAnswer } from "../typed/ask.ts";

/** An answered ask: each question with what the operator sent. */
export const AskSettled = ({ answer }: { answer: unknown }) => {
  // The store hands back what `collapse` made of the operator's action.
  const { answers } = answer as { answers: AskAnswer[] };
  return (
    <dl className="flex min-w-0 flex-col gap-2 wrap-anywhere">
      {answers.map(({ question, chosen, text }) => (
        <div key={question}>
          <dt className="text-[11px] text-[#8b949e]">{question}</dt>
          {chosen.map((label) => (
            <dd key={label} className="text-white">
              {label}
            </dd>
          ))}
          {text !== undefined && <dd className="whitespace-pre-wrap text-white">{text}</dd>}
        </div>
      ))}
    </dl>
  );
};
