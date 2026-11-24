import { useEffect } from "react";
import type { LayoutProps } from "../layout.ts";
import { ANSWERS, isAnswered, questionParts, READY, SEND_PART } from "../typed/ask.ts";

/** A question, drawn open, over Send. Send is held until it is answered. */
export const AskLayout = ({ part, data }: LayoutProps) => {
  useEffect(() => {
    const hold = () => {
      const answers = data.get(ANSWERS);
      const ready = Array.isArray(answers) && answers.every(isAnswered);
      if (data.get(READY) !== ready) data.set(READY, ready);
    };
    hold();
    return data.subscribe(hold);
  }, [data]);
  const names = questionParts(0);
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="font-semibold text-white">{part(names.question)}</div>
      {part(names.choice)}
      {part(names.text)}
      <div>{part(SEND_PART)}</div>
    </div>
  );
};
