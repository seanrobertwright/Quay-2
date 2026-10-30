// The sticky track strip's bound (#409). On a wide history hundreds of tracks pass the top row, and
// a jump replaces nearly all of them, so the strip names only the leftmost few inline and puts the
// rest behind a More menu, which is built only while it is open.

/** How many tracks the strip names inline; a history this narrow shows every track, as before. */
export const STRIP_LIMIT = 12;

/** The tracks the strip names inline, and the rest, left to right as given. */
export function splitStrip<T>(tracks: readonly T[]): { shown: T[]; more: T[] } {
  return { shown: tracks.slice(0, STRIP_LIMIT), more: tracks.slice(STRIP_LIMIT) };
}

/**
 * The item the More menu's `key` moves focus to from `index`, of `count` items, or null for a key
 * it doesn't handle. Arrows wrap, and Home and End go to either end.
 */
export function menuIndexByKey(index: number, count: number, key: string): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
