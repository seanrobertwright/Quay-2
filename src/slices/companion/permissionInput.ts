import { summaryField, toolInputSummary } from "./activity.ts";

/** One top-level field of a permission request's input that its summary does not show. */
export interface InputField {
  /** The field's name, or null when the whole input is one value with no fields. */
  name: string | null;
  value: unknown;
}

/** A permission request's input: what its one-line summary shows, and what it does not. */
export interface PermissionInput {
  /** `toolInputSummary`'s result, or empty where that is the JSON of an input `rest` shows instead. */
  summary: string;
  /** What the summary does not show, fields in the order they arrived; empty when it shows all. */
  rest: InputField[];
}

/** The input's fields but the summarised one; an input with no fields of its own is one nameless value. */
function beyondSummary(input: unknown, summarised: string | null): InputField[] {
  if (input === undefined || input === null || typeof input === "string") return [];
  if (typeof input !== "object") return [{ name: null, value: input }];
  if (Array.isArray(input)) return input.length > 0 ? [{ name: null, value: input }] : [];
  return Object.entries(input)
    .filter(([name]) => name !== summarised)
    .map(([name, value]) => ({ name, value }));
}

/**
 * Splits a permission request's input into its one-line summary and the rest. `rest` is the rule
 * for whether there is more to show than the summary: the Activity view's request draws it, and a
 * lens's reply strip offers the way there while it is not empty.
 */
export function splitPermissionInput(input: unknown): PermissionInput {
  const summarised = summaryField(input);
  const rest = beyondSummary(input, summarised);
  return { summary: rest.length > 0 && summarised === null ? "" : toolInputSummary(input), rest };
}
