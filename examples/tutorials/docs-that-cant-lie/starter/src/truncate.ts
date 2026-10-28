export type TruncateOptions = {
  /** Put at the end of a shortened text. Default `"…"`, one character. */
  ellipsis?: string;
};

/**
 * Shortens `text` to at most `max` characters, counting each Unicode code point, such as an
 * emoji, as one. A text that already fits comes back as it is. A longer one is cut and ends with
 * `ellipsis`, which counts toward `max`.
 */
export function truncate(text: string, max: number, options: TruncateOptions = {}): string {
  const { ellipsis = "…" } = options;
  const ellipsisLength = Array.from(ellipsis).length;
  if (!Number.isInteger(max) || max < ellipsisLength) {
    throw new RangeError(`max must be a whole number no shorter than the ellipsis, got ${max}`);
  }
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max - ellipsisLength).join("") + ellipsis;
}
