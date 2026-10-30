// Scaled scrolling (#370, #377). Chromium stops an element's height at about 11.18M px, roughly
// 400k rows at 28 px, so the commit list's spacer can't always be as tall as its content. Up to
// `MAX_SPACER_HEIGHT` the list scrolls natively; above it the spacer is capped there and the
// content offset, in content pixels, is the source of truth. The scrollbar maps onto it
// proportionally.

import { ROW_HEIGHT } from "./graphWindow.ts";

/** The tallest spacer the list renders, safely under Chromium's height limit (#370). */
export const MAX_SPACER_HEIGHT = 8_000_000;

export interface ScrollScale {
  /** True when the content is taller than `MAX_SPACER_HEIGHT`. */
  scaled: boolean;
  /** The spacer's height in px. */
  spacerHeight: number;
  /** Content pixels per scrollbar pixel; 1 when scrolling natively. */
  ratio: number;
  /** The largest content offset: the content height less the viewport. */
  maxOffset: number;
}

/** How a list with `contentHeight` px of rows maps onto a spacer, in a viewport `viewportHeight` px tall. */
export function scrollScale(contentHeight: number, viewportHeight: number): ScrollScale {
  const content = Math.max(0, finite(contentHeight));
  const viewport = Math.max(0, finite(viewportHeight));
  const maxOffset = Math.max(0, content - viewport);
  if (content <= MAX_SPACER_HEIGHT) return { scaled: false, spacerHeight: content, ratio: 1, maxOffset };
  const maxScrollTop = Math.max(1, MAX_SPACER_HEIGHT - viewport);
  return { scaled: true, spacerHeight: MAX_SPACER_HEIGHT, ratio: Math.max(1, maxOffset / maxScrollTop), maxOffset };
}

/** `offset` pulled into the content's range. */
export function clampOffset(scale: ScrollScale, offset: number): number {
  return Math.min(scale.maxOffset, Math.max(0, finite(offset)));
}

/** The scroll container's `scrollTop` that shows content offset `offset`. */
export function scrollTopFor(scale: ScrollScale, offset: number): number {
  return clampOffset(scale, offset) / scale.ratio;
}

/**
 * The content offset after the container scrolled to `scrollTop`, from `offset`. Natively they
 * are the same. Scaled, a scroll the list set itself lands within a pixel of `scrollTopFor(offset)`
 * and leaves `offset` alone; anything else (the scrollbar, a drag, a fling) maps proportionally.
 */
export function offsetAfterScroll(scale: ScrollScale, offset: number, scrollTop: number): number {
  if (!scale.scaled) return clampOffset(scale, scrollTop);
  if (Math.abs(finite(scrollTop) - scrollTopFor(scale, offset)) < 1) return clampOffset(scale, offset);
  return clampOffset(scale, finite(scrollTop) * scale.ratio);
}

/**
 * The spacer y, in px, of the row window starting at row `windowStart`, so that content offset
 * `offset` shows at the top of a viewport scrolled to `scrollTop`. Natively that is the window's
 * own content y.
 */
export function windowTop(scrollTop: number, offset: number, windowStart: number): number {
  return scrollTop - offset + windowStart * ROW_HEIGHT;
}

/** WheelEvent.deltaMode values. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/**
 * The content offset after a wheel event: exactly `deltaY` px further, or that many rows or
 * viewports for a line or page delta, kept inside the content.
 */
export function wheelOffset(
  scale: ScrollScale,
  offset: number,
  deltaY: number,
  deltaMode: number,
  viewportHeight: number
): number {
  const unit = deltaMode === DOM_DELTA_LINE ? ROW_HEIGHT : deltaMode === DOM_DELTA_PAGE ? viewportHeight : 1;
  return clampOffset(scale, offset + finite(deltaY) * unit);
}

/** How far an arrow key scrolls, as in Chromium. */
const ARROW_STEP = 40;

/**
 * The content offset a scroll key moves to, or null for any other key. A page keeps one row of
 * the last view in sight; Space pages down, and Shift+Space up.
 */
export function keyOffset(
  scale: ScrollScale,
  offset: number,
  key: string,
  shiftKey: boolean,
  viewportHeight: number
): number | null {
  const page = Math.max(ROW_HEIGHT, viewportHeight - ROW_HEIGHT);
  switch (key) {
    case "ArrowDown":
      return clampOffset(scale, offset + ARROW_STEP);
    case "ArrowUp":
      return clampOffset(scale, offset - ARROW_STEP);
    case "PageDown":
      return clampOffset(scale, offset + page);
    case "PageUp":
      return clampOffset(scale, offset - page);
    case " ":
      return clampOffset(scale, offset + (shiftKey ? -page : page));
    case "Home":
      return 0;
    case "End":
      return scale.maxOffset;
    default:
      return null;
  }
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}
