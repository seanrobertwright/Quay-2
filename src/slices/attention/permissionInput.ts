/** The fields that name what a tool call works on, the first that holds a string being its summary. */
const SUMMARY_FIELDS = ["command", "file_path", "path", "url", "pattern"];

/** The field that names what the input works on, with its text, or null when no field does. */
function summaryField(input: unknown): { name: string; text: string } | null {
  if (!input || typeof input !== "object") return null;
  const fields = input as Record<string, unknown>;
  for (const name of SUMMARY_FIELDS) {
    const text = fields[name];
    if (typeof text === "string") return { name, text };
  }
  return null;
}

/** What a tool call's arguments name, on one line: a command, a file, a URL, else the arguments. */
export function toolInputSummary(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") return summaryField(input)?.text ?? JSON.stringify(input);
  return "";
}

/** One top-level field of a permission request's input that its summary does not show. */
export interface InputField {
  /** The field's name, or null when the whole input is one value with no fields. */
  name: string | null;
  value: unknown;
}

/** A permission request's input as its Activity view request shows it: one line, and the rest. */
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
 * Splits a permission request's input into the Activity view's one-line summary and the rest.
 * `rest` is the rule for whether there is more to show than that summary: the Activity view's
 * request draws it, and a lens's reply strip offers the way there while it is not empty. The
 * strip's own line is not this summary: for an input with no summarised field it is the JSON, cut
 * to the strip's width, and the strip still offers the way to the fields drawn in full.
 */
export function splitPermissionInput(input: unknown): PermissionInput {
  const summarised = summaryField(input)?.name ?? null;
  const rest = beyondSummary(input, summarised);
  return { summary: rest.length > 0 && summarised === null ? "" : toolInputSummary(input), rest };
}
