/** How many lines, words and characters a text holds. */
export type Tally = { lines: number; words: number; chars: number };

/**
 * Counts the lines, words and characters in `text`.
 *
 * A line is a run of text ended by a newline, or by the end of the text, so a final newline adds
 * no empty line. A word is a run of characters that are not whitespace. A character is one
 * Unicode code point, so an emoji counts as one.
 */
export function tally(text: string): Tally {
  if (text === "") return { lines: 0, words: 0, chars: 0 };
  const newlines = text.split("\n").length - 1;
  const lines = text.endsWith("\n") ? newlines : newlines + 1;
  const words = text.split(/\s+/).filter((word) => word !== "").length;
  const chars = [...text].length;
  return { lines, words, chars };
}
