// The sticky track strip's bound (#409). On a wide history hundreds of tracks pass the top row, and
// a jump replaces nearly all of them, so the strip names only the leftmost few inline and puts the
// rest behind a More menu, which is built only while it is open.

/** How many tracks the strip names inline; a history this narrow shows every track, as before. */
export const STRIP_LIMIT = 12;

/** The tracks the strip names inline, and the rest, left to right as given. */
export function splitStrip<T>(tracks: readonly T[]): { shown: T[]; more: T[] } {
  return { shown: tracks.slice(0, STRIP_LIMIT), more: tracks.slice(STRIP_LIMIT) };
}
