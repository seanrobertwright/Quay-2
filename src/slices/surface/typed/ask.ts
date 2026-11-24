// quay_ask's two pure functions: the surface its checked arguments make, and the result its action
// makes. The names of its parts are here too, for the layout that places them.
import type { CreateSurface, SurfaceAction, SurfaceComponent } from "../surfaceTypes.ts";
import { plainText } from "./plainText.ts";

/** A checked `quay_ask` call. Mirrors `Ask`. */
export interface AskArguments {
  questions: {
    question: string;
    options: { label: string; description?: string; recommended: boolean }[];
  }[];
}

/** One question's answer, as its agent gets it. */
export interface AskAnswer {
  question: string;
  chosen: string[];
  /** Left out when nothing was written. */
  text?: string;
}

/** The parts of question `i`. */
export const questionParts = (i: number) => ({ question: `q${i}_question`, choice: `q${i}_choice`, text: `q${i}_text` });

/** The part that sends the answer. */
export const SEND_PART = "send";

/** Where the answers are in the data model: a list of `chosen` and `text`, one per question. */
export const ANSWERS = "/answers";

/** The frame's own path in the data model that holds Send: true once every question is answered. */
export const READY = "/frame/ready";

/** A single choice is answered by an option or some text. */
export const isAnswered = (answer: { chosen?: unknown; text?: unknown } | undefined) =>
  (Array.isArray(answer?.chosen) && answer.chosen.length > 0) || (typeof answer?.text === "string" && answer.text.trim() !== "");

export function expand(ask: AskArguments, surfaceId: string): CreateSurface {
  const parts: SurfaceComponent[] = ask.questions.flatMap(({ question, options }, i): SurfaceComponent[] => {
    const names = questionParts(i);
    return [
      { id: names.question, component: "Text", text: plainText(question) },
      {
        id: names.choice,
        component: "ChoicePicker",
        variant: "mutuallyExclusive",
        label: question,
        options: options.map((option) => ({ ...option, value: option.label })),
        value: { "@path": `${ANSWERS}/${i}/chosen` },
      },
      { id: names.text, component: "TextField", variant: "longText", label: "Other, or a note", value: { "@path": `${ANSWERS}/${i}/text` } },
    ];
  });
  parts.push({
    id: SEND_PART,
    component: "Button",
    variant: "primary",
    child: "send_label",
    "@checks": [{ condition: { "@path": READY }, message: "Answer the question first." }],
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
  });
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
