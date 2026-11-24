/** The line of a file `line` names, or undefined when it names none. */
export const lineOf = (line: unknown): number | undefined =>
  typeof line === "number" && Number.isInteger(line) && line > 0 && line <= 0xffffffff ? line : undefined;
