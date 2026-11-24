import { useEffect, useMemo, useRef } from "react";
import type { LayoutProps } from "../layout.ts";
import { CONTEXT_PART, questionsIn, READY, SEND_PART } from "../typed/ask.ts";
import { AskQuestion } from "./AskQuestion.tsx";
import { AskRow } from "./AskRow.tsx";
import { openQuestion, readAsk, useAsk } from "./askState.ts";
import { Fold } from "./Fold.tsx";

/**
 * An ask: one question drawn open, or several listed with one of them open, over Send. Send is held
 * until every question has been opened and is answered.
 */
export const AskLayout = ({ part, components, data }: LayoutProps) => {
  const asked = useMemo(() => questionsIn(components), [components]);
  const questions = useAsk(asked, data);
  const rows = useRef(new Map<number, HTMLButtonElement>());
  useEffect(() => {
    const hold = () => {
      const ready = readAsk(asked, data).every(({ answered }) => answered);
      if (data.get(READY) !== ready) data.set(READY, ready);
    };
    hold();
    return data.subscribe(hold);
  }, [asked, data]);
  const next = (i: number) => {
    // The Next that was clicked leaves the screen, and would take the focus with it
    rows.current.get(i)?.focus();
    openQuestion(i, data);
  };
  const several = questions.length > 1;
  return (
    // What takes the focus is not scrolled to beneath the foot
    <div className="flex min-w-0 flex-col gap-2.5 [&_:is(button,input,textarea)]:scroll-mb-14">
      {components.some(({ id }) => id === CONTEXT_PART) && (
        <div className="text-[#8b949e]">
          <Fold>{part(CONTEXT_PART)}</Fold>
        </div>
      )}
      {several ? (
        <ol className="flex min-w-0 flex-col gap-2">
          {questions.map((question, i) => (
            <AskRow
              key={question.parts.question}
              question={question}
              number={i + 1}
              part={part}
              ref={(row) => {
                if (row) rows.current.set(i, row);
                else rows.current.delete(i);
              }}
              onOpen={() => openQuestion(i, data)}
              onNext={i + 1 < questions.length ? () => next(i + 1) : null}
            />
          ))}
        </ol>
      ) : (
        questions.map((question) => <AskQuestion key={question.parts.question} question={question} part={part} titled />)
      )}
      {/* Held at the foot of what is on screen while the questions above it scroll. */}
      <div data-foot className="sticky bottom-0 z-10 -mx-3 -mb-3 flex items-center gap-2 border-t border-[#30363d] bg-[#161b22] px-3 py-2">
        {part(SEND_PART)}
        {several && (
          <span role="status" className="text-[11px] text-[#8b949e]">
            {questions.filter(({ answered }) => answered).length} of {questions.length} answered
          </span>
        )}
      </div>
    </div>
  );
};
