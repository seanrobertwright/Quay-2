// PROTOTYPE (#711), throwaway. The two pure functions of quay_ask.

export interface AskArgs {
  context?: string;
  questions: {
    question: string;
    multiple?: boolean;
    options?: { label: string; description?: string; recommended?: boolean }[];
  }[];
}

/** The names of one question's parts. */
const partNames = (i: number) => ({ question: `q${i}_question`, choice: `q${i}_choice`, text: `q${i}_text` });

/** The questions of a surface that `expand` made, in order. */
export function questionsIn(surface: any) {
  const components = surface.componentsModel;
  const found: { parts: ReturnType<typeof partNames>; text: string; options: boolean; multiple: boolean }[] = [];
  for (let parts = partNames(0); components.has(parts.question); parts = partNames(found.length)) {
    const choice = components.get(parts.choice);
    const multiple = choice?.properties.variant === "multipleSelection";
    found.push({ parts, text: components.get(parts.question).properties.text, options: !!choice, multiple });
  }
  return found;
}

/** One `createSurface`: a root Column whose children are the ask's named parts. */
export function expand(ask: AskArgs, surfaceId: string, catalogId: string): object {
  const parts: object[] = [];
  const children: string[] = [];
  const add = (c: { id: string } & Record<string, unknown>) => {
    parts.push(c);
    children.push(c.id);
  };
  if (ask.context) add({ id: "context", component: "Text", text: ask.context });
  ask.questions.forEach((q, i) => {
    const names = partNames(i);
    add({ id: names.question, component: "Text", text: q.question });
    if (q.options)
      add({
        id: names.choice,
        component: "ChoicePicker",
        label: q.question,
        variant: q.multiple ? "multipleSelection" : "mutuallyExclusive",
        options: q.options.map((o) => ({ ...o, value: o.label })),
        value: { "@path": `/answers/${i}/chosen` },
      });
    add({
      id: names.text,
      component: "TextField",
      variant: "longText",
      label: q.options ? "Other, or a note" : "Your answer",
      value: { "@path": `/answers/${i}/text` },
    });
  });
  add({
    id: "send",
    component: "Button",
    variant: "primary",
    child: "send_label",
    "@checks": [{ condition: { "@path": "/frame/ready" }, message: "Open and answer every question first." }],
    action: {
      event: {
        name: "send",
        context: Object.fromEntries(
          ask.questions.flatMap((_, i) => [
            [`chosen${i}`, { "@path": `/answers/${i}/chosen` }],
            [`text${i}`, { "@path": `/answers/${i}/text` }],
          ]),
        ),
      },
    },
  });
  parts.push({ id: "send_label", component: "Text", text: "Send" });
  return {
    version: "1.0",
    createSurface: {
      surfaceId,
      catalogId,
      components: [{ id: "root", component: "Column", children }, ...parts],
      dataModel: { answers: ask.questions.map(() => ({ chosen: [], text: "" })) },
    },
  };
}

/** The tool's plain result from the send action's context. */
export function collapse(questions: readonly string[], context: Record<string, unknown>): object {
  return {
    answers: questions.map((question, i) => {
      const text = String(context[`text${i}`] ?? "");
      return { question, chosen: context[`chosen${i}`] ?? [], ...(text.trim() ? { text } : {}) };
    }),
  };
}
