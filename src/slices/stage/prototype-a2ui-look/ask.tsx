// PROTOTYPE (#696), throwaway. The question card, three layouts: A every question in one scroll,
// B one at a time, C every question listed with one open.
import { useId, useState } from "react";
import { Check } from "lucide-react";
import { PRIMARY, SECONDARY } from "../../companion/buttonStyles.ts";
import type { Ask, Question } from "./content.ts";
import { Frame, Settled, type Key } from "./frame.tsx";
import { Md } from "./md.tsx";

interface Answer {
  chosen: string[];
  text: string;
  /** Shown to the operator. A multiple choice may be sent with nothing ticked, but not unseen. */
  seen: boolean;
}
const answered = (q: Question, a: Answer) => (q.multiple ? a.seen : a.chosen.length > 0 || a.text.trim() !== "");
const said = (a: Answer) => [...a.chosen, a.text.trim()].filter(Boolean).join(" · ") || "None of these";

const Body = ({ q, a, set, showQuestion = true }: { q: Question; a: Answer; set: (a: Answer) => void; showQuestion?: boolean }) => {
  const id = useId();
  return (
    <fieldset className="min-w-0 flex flex-col gap-1.5">
      <legend className={showQuestion ? "text-[13px] leading-[18px] font-semibold text-[#f0f6fc] mb-1.5 break-words" : "sr-only"}>{q.question}</legend>
      {q.options?.map((o) => {
        const on = a.chosen.includes(o.label);
        return (
          <label
            key={o.label}
            className={`flex items-start gap-2 px-2.5 py-2 rounded-md border cursor-pointer ${on ? "border-[#58a6ff] bg-[#1f6feb26]" : "border-[#30363d] hover:bg-[#21262d]"}`}
          >
            <input
              type={q.multiple ? "checkbox" : "radio"}
              name={id}
              checked={on}
              onChange={() => set({ ...a, seen: true, chosen: q.multiple ? (on ? a.chosen.filter((c) => c !== o.label) : [...a.chosen, o.label]) : [o.label] })}
              className="mt-0.5 accent-[#58a6ff] shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-2 text-xs text-[#f0f6fc]">
                <span className="min-w-0 flex-1 break-words">{o.label}</span>
                {o.recommended && <span className="shrink-0 px-1.5 rounded-full text-[10px] text-[#d2a8ff] border border-[#a371f7]/50">agent's pick</span>}
              </span>
              {o.description && <span className="block text-[11px] leading-4 text-[#8b949e] break-words">{o.description}</span>}
            </span>
          </label>
        );
      })}
      <label className="sr-only" htmlFor={`${id}-t`}>
        {q.options ? "Other, or a note" : "Your answer"}
      </label>
      <textarea
        id={`${id}-t`}
        rows={q.options ? 1 : 3}
        value={a.text}
        onChange={(e) => set({ ...a, seen: true, text: e.target.value })}
        placeholder={q.options ? "Other, or a note" : "Your answer"}
        className="w-full px-2 py-1.5 rounded-md bg-[#010409] border border-[#30363d] text-xs text-[#c9d1d9] placeholder:text-[#8b949e] resize-y"
      />
    </fieldset>
  );
};

export const AskCard = ({ ask, layout, onSend, onDismiss }: { ask: Ask; layout: Key; onSend: (text: string) => void; onDismiss: () => void }) => {
  const [answers, setAnswers] = useState<Answer[]>(ask.questions.map((_, i) => ({ chosen: [], text: "", seen: layout === "A" || i === 0 })));
  const [at, setAt] = useState(0);
  const [sent, setSent] = useState(false);
  const [more, setMore] = useState(false);
  const set = (i: number) => (a: Answer) => setAnswers((all) => all.map((x, j) => (j === i ? a : x)));
  const go = (i: number) => {
    setAt(i);
    setAnswers((all) => all.map((x, j) => (j === i ? { ...x, seen: true } : x)));
  };
  const n = ask.questions.length;
  const done = ask.questions.filter((q, i) => answered(q, answers[i])).length;
  const send = () => {
    setSent(true);
    onSend(ask.questions.map((q, i) => `${q.question.slice(0, 40)}: ${said(answers[i])}`).join(" | "));
  };
  const long = (ask.context?.length ?? 0) > 320;
  const context = ask.context && (
    <div className="text-xs leading-[18px]">
      <div className={long && !more ? "max-h-[5.5rem] overflow-hidden [mask-image:linear-gradient(black_60%,transparent)]" : ""}>
        <Md text={ask.context} tone="text-[#8b949e]" />
      </div>
      {long && (
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="text-[11px] text-[#58a6ff] hover:underline">
          {more ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
  const sendRow = (
    <div className="flex items-center gap-2">
      <button type="button" disabled={done < n} onClick={send} className={PRIMARY}>
        Send
      </button>
      {n > 1 && (
        <span className="text-[11px] text-[#8b949e]">
          {done} of {n} answered
        </span>
      )}
    </div>
  );
  const pinned = !sent && n > 1 && layout !== "B";
  return (
    <Frame
      terminal="fix-75"
      cli="claude"
      kind="ask"
      title={null}
      onDismiss={onDismiss}
      footer={pinned ? <div className="sticky -bottom-2.5 z-10 px-3 py-2 border-t border-[#30363d] bg-[#161b22] rounded-b-lg">{sendRow}</div> : undefined}
    >
      {sent ? (
        <Settled lines={ask.questions.map((q, i) => [q.question, said(answers[i])])} />
      ) : (
        <>
          {context}
          {layout === "A" && ask.questions.map((q, i) => <Body key={q.question} q={q} a={answers[i]} set={set(i)} />)}
          {layout === "B" && (
            <>
              {n > 1 && (
                <div className="flex items-center gap-1">
                  {ask.questions.map((q, i) => (
                    <span key={q.question} className={`h-1 flex-1 rounded-full ${i === at ? "bg-[#58a6ff]" : answered(q, answers[i]) ? "bg-[#238636]" : "bg-[#30363d]"}`} />
                  ))}
                  <span className="ml-1 text-[10px] text-[#8b949e]">
                    {at + 1} of {n}
                  </span>
                </div>
              )}
              <Body key={at} q={ask.questions[at]} a={answers[at]} set={set(at)} />
              <div className="flex items-center gap-2">
                {n > 1 && (
                  <button type="button" disabled={at === 0} onClick={() => go(at - 1)} className={SECONDARY}>
                    Back
                  </button>
                )}
                {at < n - 1 ? (
                  <button type="button" disabled={!answered(ask.questions[at], answers[at])} onClick={() => go(at + 1)} className={SECONDARY}>
                    Next
                  </button>
                ) : (
                  sendRow
                )}
              </div>
            </>
          )}
          {layout === "C" && n === 1 && <Body q={ask.questions[0]} a={answers[0]} set={set(0)} />}
          {layout === "C" &&
            n > 1 &&
            ask.questions.map((q, i) => {
              const open = i === at;
              const ok = answered(q, answers[i]);
              return (
                <div key={q.question} className={`rounded-md border ${open ? "border-[#484f58]" : "border-[#30363d]"}`}>
                  <button type="button" aria-expanded={open} onClick={() => go(i)} className="w-full p-2.5 flex items-start gap-2 text-left hover:bg-[#161b22] rounded-md">
                    <span className={`mt-px w-4 h-4 shrink-0 rounded-full grid place-items-center text-[10px] ${ok && !open ? "bg-[#238636] text-white" : "border border-[#484f58] text-[#8b949e]"}`}>
                      {ok && !open ? <Check className="w-2.5 h-2.5" aria-label="answered" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] leading-[18px] break-words ${open ? "font-semibold text-[#f0f6fc]" : "text-[#c9d1d9] line-clamp-2"}`}>{q.question}</span>
                      {!open && ok && <span className="block text-[11px] text-[#58a6ff] truncate">{said(answers[i])}</span>}
                    </span>
                  </button>
                  {open && (
                    <div className="px-2.5 pb-2.5 flex flex-col gap-2">
                      <Body q={q} a={answers[i]} set={set(i)} showQuestion={false} />
                      {i < n - 1 && (
                        <button type="button" disabled={!ok} onClick={() => go(i + 1)} className={`${SECONDARY} self-start`}>
                          Next
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          {n === 1 && layout !== "B" && sendRow}
        </>
      )}
    </Frame>
  );
};
