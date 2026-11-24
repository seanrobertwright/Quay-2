import type { Ref } from "react";
import { Check } from "lucide-react";
import { Button } from "../../parts/Button.tsx";
import type { LayoutProps } from "../layout.ts";
import { inOneLine } from "../typed/ask.ts";
import { AskQuestion } from "./AskQuestion.tsx";
import type { QuestionState } from "./askState.ts";

interface AskRowProps {
  question: QuestionState;
  /** Its number, from 1. */
  number: number;
  part: LayoutProps["part"];
  /** The button that opens it. */
  ref: Ref<HTMLButtonElement>;
  onOpen: () => void;
  /** Opens the question after it, or null when it is the last. */
  onNext: (() => void) | null;
}

/** One question of several: its line, and its inputs while it is the open one. */
export const AskRow = ({ question, number, part, ref, onOpen, onNext }: AskRowProps) => {
  const { open } = question;
  const done = question.answered && !open;
  return (
    <li className={`rounded-md border ${open ? "border-[#484f58]" : "border-[#30363d]"}`}>
      <button
        ref={ref}
        type="button"
        aria-expanded={open}
        // One is always open, so a click on that one does nothing
        aria-disabled={open}
        onClick={open ? undefined : onOpen}
        className="flex w-full items-start gap-2 rounded-md p-2.5 text-left aria-[expanded=false]:hover:bg-[#161b22]"
      >
        <span
          aria-hidden="true"
          className={`mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${done ? "bg-[#238636] text-white" : "border border-[#484f58] text-[#8b949e]"}`}
        >
          {done ? <Check className="h-2.5 w-2.5" /> : number}
        </span>
        <span className="min-w-0 flex-1 wrap-anywhere">
          <span className={open ? "block font-semibold whitespace-pre-wrap text-white" : "line-clamp-2 text-[#c9d1d9]"}>{question.question}</span>
          {done && (
            <span className="line-clamp-2 text-[11px] text-[#58a6ff]">
              <span className="sr-only">Answered: </span>
              {inOneLine(question)}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-2.5 pb-2.5">
          <AskQuestion question={question} part={part} />
          {onNext && (
            <div>
              <Button onClick={onNext}>Next</Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
};
