// Which rows of the commit list are in the DOM (#351): a window around the viewport whose start
// moves in whole steps, so React re-renders once per step rather than once per scrolled pixel.

/** Row height in px (#351). */
export const ROW_HEIGHT = 28;
/** The window start is a multiple of this many rows. */
export const WINDOW_STEP = 8;

export interface RowWindow {
  /** First row in the DOM, a multiple of `WINDOW_STEP`. */
  start: number;
  /** One past the last row in the DOM. */
  end: number;
}

/**
 * The rows to render for a viewport at `scrollTop` that is `viewportHeight` px tall, over
 * `rowCount` rows: the visible rows plus one to two steps of overscan on each side.
 */
export function rowWindow(scrollTop: number, viewportHeight: number, rowCount: number): RowWindow {
  if (rowCount <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const height = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const firstVisible = Math.floor(top / ROW_HEIGHT);
  const lastVisible = Math.ceil((top + height) / ROW_HEIGHT);
  const start = Math.min(
    Math.max(0, (Math.floor(firstVisible / WINDOW_STEP) - 1) * WINDOW_STEP),
    Math.floor((rowCount - 1) / WINDOW_STEP) * WINDOW_STEP
  );
  const end = Math.min(rowCount, (Math.ceil(lastVisible / WINDOW_STEP) + 1) * WINDOW_STEP);
  return { start, end: Math.max(start, end) };
}

export function sameWindow(a: RowWindow, b: RowWindow): boolean {
  return a.start === b.start && a.end === b.end;
}
