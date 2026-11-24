// A run's steps, as the parts that draw them take them.

const STATES = ["pending", "active", "done", "failed"] as const;

export type StepState = (typeof STATES)[number];

export interface Step {
  label: string;
  state: StepState;
  note?: string;
}

const isState = (state: unknown): state is StepState => STATES.some((known) => known === state);

/** The steps in `value`. What in it is no step is left out, and so is a note that is no text. */
export function stepsIn(value: unknown): Step[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): Step[] => {
    if (typeof item !== "object" || item === null) return [];
    const { label, state, note } = item as Record<string, unknown>;
    return typeof label === "string" && isState(state) ? [{ label, state, ...(typeof note === "string" ? { note } : {}) }] : [];
  });
}
