// The text statistics SPEC.md specifies. Each function is a stub until builder-agent writes it.

/** The number of lines in `text`, as SPEC.md's Lines rule counts them. */
export function countLines(text: string): number {
  throw new Error("not implemented");
}

/** The number of words in `text`, as SPEC.md's Words rule counts them. */
export function countWords(text: string): number {
  throw new Error("not implemented");
}

/** The most frequent word in `text` and how often it appears, as SPEC.md's Top word rule finds it. */
export function topWord(text: string): { word: string; count: number } {
  throw new Error("not implemented");
}
