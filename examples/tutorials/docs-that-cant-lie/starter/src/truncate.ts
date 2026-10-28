export type TruncateOptions = {
  /** Put at the end of a shortened text. Default `"…"`, one character. */
  ellipsis?: string;
};

/**
 * Shortens `text` to at most `max` characters. A text that already fits comes back as it is.
 * A longer one is cut and ends with `ellipsis`, which counts toward `max`.
 */
export function truncate(text: string, max: number, options: TruncateOptions = {}): string {
  const { ellipsis = "…" } = options;
  if (!Number.isInteger(max) || max < ellipsis.length) {
    throw new RangeError(`max must be a whole number no shorter than the ellipsis, got ${max}`);
  }
  if (text.length <= max) return text;
  return text.slice(0, max - ellipsis.length) + ellipsis;
}
