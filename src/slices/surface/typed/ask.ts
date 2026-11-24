// quay_ask's two pure functions: the surface its checked arguments make, and the result its action
// makes. The names of its parts are here too, for the layout that places them.
import type { CreateSurface, SurfaceAction, SurfaceComponent } from "../surfaceTypes.ts";

/** A checked `quay_ask` call. Mirrors `Ask`. */
export interface AskArguments {
  /** Markdown. */
  context?: string;
  questions: {
    question: string;
    /** None for a question answered in words. */
    options: { label: string; description?: string; recommended: boolean }[];
    multiple: boolean;
  }[];
}

/** One question's answer, as its agent gets it. */
export interface AskAnswer {
  question: string;
  chosen: string[];
  /** Left out when nothing was written. */
  text?: string;
}

/** The part that says why the agent asks, when it does. */
export const CONTEXT_PART = "context";

/** The parts of question `i`. */
export const questionParts = (i: number) => ({ question: `q${i}_question`, choice: `q${i}_choice`, text: `q${i}_text` });

/** The part that sends the answer. */
export const SEND_PART = "send";

/** Where the answers are in the data model: a list of `chosen` and `text`, one per question. */
export const ANSWERS = "/answers";

/** The frame's own path in the data model that holds Send: true once every question has been opened and is answered. */
export const READY = "/frame/ready";

/** The frame's own path to the index of the question that is open. */
export const OPEN = "/frame/open";

/** The frame's own path to the indexes of the questions that have been opened. */
export const OPENED = "/frame/opened";

/** How a question is answered: with one option, with any number of them, or in words. Each takes words too. */
export type QuestionKind = "one" | "several" | "words";

/** A question, as the surface `expand` made holds it. */
export interface AskedQuestion {
  parts: ReturnType<typeof questionParts>;
  question: string;
  kind: QuestionKind;
}

/** The questions of a surface `expand` made, in order. */
export function questionsIn(components: readonly SurfaceComponent[]): AskedQuestion[] {
  const byId = new Map(components.map((component) => [component.id, component]));
  const questions: AskedQuestion[] = [];
  for (let parts = questionParts(0); byId.has(parts.question); parts = questionParts(questions.length)) {
    const choice = byId.get(parts.choice);
    const ofOptions = choice?.variant === "multipleSelection" ? "several" : "one";
    questions.push({ parts, question: String(byId.get(parts.question)?.text), kind: choice ? ofOptions : "words" });
  }
  return questions;
}

interface Given {
  chosen: readonly string[];
  text: string;
}

/** Whether what was given is an answer: an option or some text, or nothing at all when any number of options may be picked. */
export const isAnswered = (kind: QuestionKind, { chosen, text }: Given) => kind === "several" || chosen.length > 0 || text.trim() !== "";

/** What stands for an answer with nothing ticked and nothing written. */
export const NOTHING_GIVEN = "None of these";

/** An answer, in one line. */
export const inOneLine = ({ chosen, text }: Given) => [...chosen, text.trim()].filter((said) => said !== "").join(" · ") || NOTHING_GIVEN;

export function expand(ask: AskArguments, surfaceId: string): CreateSurface {
  const context: SurfaceComponent[] = ask.context?.trim() ? [{ id: CONTEXT_PART, component: "Text", text: ask.context }] : [];
  const questions = ask.questions.flatMap(({ question, options, multiple }, i): SurfaceComponent[] => {
    const names = questionParts(i);
    return [
      { id: names.question, component: "Text", text: question },
      ...(options.length > 0
        ? [
            {
              id: names.choice,
              component: "ChoicePicker",
              variant: multiple ? "multipleSelection" : "mutuallyExclusive",
              label: question,
              options: options.map((option) => ({ ...option, value: option.label })),
              value: { "@path": `${ANSWERS}/${i}/chosen` },
            },
          ]
        : []),
      {
        id: names.text,
        component: "TextField",
        variant: "longText",
        label: options.length > 0 ? "Other, or a note" : "Your answer",
        value: { "@path": `${ANSWERS}/${i}/text` },
      },
    ];
  });
  const send: SurfaceComponent = {
    id: SEND_PART,
    component: "Button",
    variant: "primary",
    child: "send_label",
    "@checks": [{ condition: { "@path": READY }, message: "Open and answer every question first." }],
    action: {
      event: {
        name: "send",
        context: Object.fromEntries(
          ask.questions.flatMap(({ question }, i) => [
            [`question${i}`, question],
            [`chosen${i}`, { "@path": `${ANSWERS}/${i}/chosen` }],
            [`text${i}`, { "@path": `${ANSWERS}/${i}/text` }],
          ]),
        ),
      },
    },
  };
  const parts = [...context, ...questions, send];
  return {
    version: "1.0",
    createSurface: {
      surfaceId,
      components: [
        { id: "root", component: "Column", children: parts.map((part) => part.id) },
        ...parts,
        { id: "send_label", component: "Text", text: "Send" },
      ],
      dataModel: { answers: ask.questions.map(() => ({ chosen: [], text: "" })) },
    },
  };
}

export function collapse({ context }: SurfaceAction): { answers: AskAnswer[] } {
  const fields = new Map(Object.entries(context));
  const answers: AskAnswer[] = [];
  for (let i = 0; fields.has(`question${i}`); i += 1) {
    const chosen = fields.get(`chosen${i}`);
    const text = fields.get(`text${i}`);
    answers.push({
      question: String(fields.get(`question${i}`)),
      chosen: Array.isArray(chosen) ? chosen.map(String) : [],
      ...(typeof text === "string" && text.trim() !== "" ? { text } : {}),
    });
  }
  return { answers };
}
