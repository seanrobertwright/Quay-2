// Bringing a card into view on the builder's canvases (#575): the graph canvas (GraphView.tsx) and
// the run canvas (RunCanvas.tsx) both call this one reveal. It pans, at the same zoom, to centre a
// rectangle on screen that isn't wholly in the canvas's box, and does nothing when it is. It never
// animates, so there is no motion for reduced motion to take away.
import type { ViewportHelperFunctions } from "@xyflow/react";
import { NODE_HEIGHT, NODE_WIDTH } from "./flow/layout.ts";
import type { XYPosition } from "./model.ts";

/** A rectangle on screen, in the page's pixels, as `getBoundingClientRect` gives one. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What a reveal needs of a canvas's React Flow instance: its view, and where a point on it is on screen. */
export type CanvasView = Pick<ViewportHelperFunctions, "getViewport" | "setViewport" | "flowToScreenPosition">;

/**
 * Pans `view`, at the same zoom and without animation, to centre `r` in `box`, the canvas's
 * element, when `r` isn't wholly inside it. Does nothing when it is, or with no box.
 */
export function reveal(box: Element | null, view: CanvasView, r: ScreenRect): void {
  const b = box?.getBoundingClientRect();
  if (!b) return;
  if (r.left >= b.left && r.top >= b.top && r.left + r.width <= b.right && r.top + r.height <= b.bottom) return;
  const vp = view.getViewport();
  void view.setViewport({
    x: vp.x + b.left + b.width / 2 - (r.left + r.width / 2),
    y: vp.y + b.top + b.height / 2 - (r.top + r.height / 2),
    zoom: vp.zoom,
  });
}

/**
 * The rectangle on screen of a card whose top-left corner is at `position` on the canvas, at its
 * measured size, or the layout's (flow/layout.ts) until it is measured: where React Flow draws
 * it, without its element, which a node just added doesn't have yet.
 */
export function cardRect(view: CanvasView, position: XYPosition, measured: { width?: number; height?: number } = {}): ScreenRect {
  const { zoom } = view.getViewport();
  const corner = view.flowToScreenPosition(position);
  return { left: corner.x, top: corner.y, width: (measured.width ?? NODE_WIDTH) * zoom, height: (measured.height ?? NODE_HEIGHT) * zoom };
}

/**
 * Reveals `target` when it is a card or an edge that took focus that shows (`:focus-visible`), as
 * focus from the keyboard does: a canvas box's focus handler. Focus from a click doesn't show, so
 * it moves nothing.
 */
export function revealFocused(box: Element | null, view: CanvasView, target: Element): void {
  if (target.matches(".react-flow__node:focus-visible, .react-flow__edge:focus-visible")) reveal(box, view, target.getBoundingClientRect());
}
