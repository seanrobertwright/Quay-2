// How much of something counted is done.

export interface Amount {
  /** From 0 to `total`. */
  done: number;
  /** Above 0. */
  total: number;
  /** How much of it, from 0 to 1. */
  share: number;
  /** In words, such as "3 of 7". */
  words: string;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** `done` of `total`, or null when that is no amount. More than all of it is all of it, and less than none is none. */
export function amountOf(done: unknown, total: unknown): Amount | null {
  if (!isNumber(done) || !isNumber(total) || total <= 0) return null;
  const within = Math.min(Math.max(done, 0), total);
  return { done: within, total, share: within / total, words: `${within} of ${total}` };
}
