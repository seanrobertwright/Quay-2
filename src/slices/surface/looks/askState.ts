// What the operator has put in an ask so far, as its data model holds it. Which questions have been
// opened is the frame's own state, and is there too, under /frame.
import { useCallback, useSyncExternalStore } from "react";
import type { SurfaceData } from "../layout.ts";
import { ANSWERS, isAnswered, OPEN, OPENED, type AskedQuestion } from "../typed/ask.ts";

export interface QuestionState extends AskedQuestion {
  /** Whether it is the one drawn open. */
  open: boolean;
  chosen: string[];
  text: string;
  /** Whether it has been opened and is answered. */
  answered: boolean;
}

const listAt = (data: SurfaceData, path: string): unknown[] => {
  const value = data.get(path);
  return Array.isArray(value) ? value : [];
};

/** The questions that have been opened, by index. The first is open from the start. */
const openedIn = (data: SurfaceData) => new Set([0, ...listAt(data, OPENED)]);

export function readAsk(questions: readonly AskedQuestion[], data: SurfaceData): QuestionState[] {
  const answers = listAt(data, ANSWERS) as ({ chosen?: unknown; text?: unknown } | undefined)[];
  const opened = openedIn(data);
  const open = questions[Number(data.get(OPEN) ?? 0)] ?? questions[0];
  return questions.map((asked, i) => {
    const { chosen, text } = answers[i] ?? {};
    const answer = { chosen: Array.isArray(chosen) ? chosen.map(String) : [], text: typeof text === "string" ? text : "" };
    return { ...asked, ...answer, open: asked === open, answered: opened.has(i) && isAnswered(asked.kind, answer) };
  });
}

/** Opens question `i`, which folds the one that was open. */
export function openQuestion(i: number, data: SurfaceData): void {
  data.set(OPENED, [...openedIn(data).add(i)]);
  data.set(OPEN, i);
}

/** `readAsk`, drawn again as it changes. `questions` is the same list on every draw. */
export function useAsk(questions: readonly AskedQuestion[], data: SurfaceData): QuestionState[] {
  // As text, because the data model changes its lists in place
  const read = useCallback(() => JSON.stringify(readAsk(questions, data)), [questions, data]);
  return JSON.parse(useSyncExternalStore(data.subscribe, read)) as QuestionState[];
}
