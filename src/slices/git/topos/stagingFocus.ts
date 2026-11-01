// Where focus goes in a staging list when a stage, unstage or discard takes away the row it was on
// (#421): the next row that is still there, else the one before, else the list itself.

/**
 * The key of the row that should take focus after `before` became `after`, with focus on `focused`:
 * `focused` itself while it is still listed, otherwise the nearest row after it in `before` that
 * survived, otherwise the nearest one before it. Null means the list is empty and takes focus itself.
 */
export function focusAfterRemoval(before: readonly string[], focused: string, after: readonly string[]): string | null {
  const still = new Set(after);
  if (still.has(focused)) return focused;
  const at = before.indexOf(focused);
  if (at !== -1) {
    for (let i = at + 1; i < before.length; i++) if (still.has(before[i])) return before[i];
    for (let i = at - 1; i >= 0; i--) if (still.has(before[i])) return before[i];
  }
  return after.length === 0 ? null : after[Math.min(Math.max(at, 0), after.length - 1)];
}

/** The live region's newest sentence, its count and when it was set (ms, any monotonic clock). */
export interface Announcement {
  text: string;
  seq: number;
  at: number;
}

/**
 * How soon after a sentence a focus move is said with it rather than over it. A stage's "Staged
 * a.txt" and the focus move its new list causes land in the same render, so a second sentence would
 * replace the first before a screen reader reads it.
 */
export const FOLLOW_UP_MS = 250;

/** The announcement after `text` is said at `now`: appended to `prev` when that was just said. */
export function withFollowUp(prev: Announcement, text: string, now: number): Announcement {
  const joined = now - prev.at < FOLLOW_UP_MS && prev.text !== "" ? `${prev.text}${/[.!?]$/.test(prev.text) ? "" : "."} ${text}` : text;
  return { text: joined, seq: prev.seq + 1, at: now };
}

/** What a focus move says: the row it landed on, or that `listLabel` is empty and holds focus itself. */
export function focusMoveMessage(listLabel: string, path: string | null): string {
  return path === null ? `${listLabel} is empty, focus on the list` : `Focus on ${path}`;
}
