// The Bézier path builder for Topos ribbons (#348, #351, #375), written fresh from the
// `topos-lane-geometry` findings. An edge is a straight vertical run in the lane it owns plus an
// S-curve over one row pitch at each end whose node sits in another lane: a merge curves at its
// top, a fork or a first-parent edge that joins another lane at its bottom. Only an edge whose
// merge lane loses its parent to another lane needs both. Every y is local to the rendered window.

import { OPEN_ROW } from "./graphPage.ts";
import { SLOT_COUNT } from "./laneColors.ts";
import { ROW_HEIGHT } from "./graphWindow.ts";

/** Lane pitch in px (#351). */
export const LANE_WIDTH = 16;
/** Node radius in px (#351). */
export const NODE_RADIUS = 4.5;
/** Left padding before lane 0. */
export const GRAPH_PADDING = LANE_WIDTH / 2;
/** How far along the row pitch each control point sits (#351). */
export const CURVE_K = 0.8;

const H = ROW_HEIGHT;
const KH = CURVE_K * H;

export function laneX(lane: number): number {
  return GRAPH_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/** The y of `row` in a window whose first row is `windowStart`. */
export function rowY(row: number, windowStart: number): number {
  return (row - windowStart) * H + H / 2;
}

export interface EdgeGeometry {
  childRow: number;
  /** `OPEN_ROW` while the parent hasn't loaded. */
  parentRow: number;
  /** The lane the vertical run lives in. */
  lane: number;
  childLane: number;
  parentLane: number;
}

/** The rows in the DOM: `start` up to, not including, `end`. */
export interface PathWindow {
  start: number;
  end: number;
}

/** Rounds away float noise such as 19.599999999999998. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** An S-curve over one row pitch from (x0, y0) down to (x1, y0 + H), vertical at both ends. */
function curve(x0: number, y0: number, x1: number): string {
  return `C${n(x0)},${n(y0 + KH)} ${n(x1)},${n(y0 + H - KH)} ${n(x1)},${n(y0 + H)}`;
}

/**
 * The SVG path of one edge in `win`. The run is clipped to one row pitch past each side of the
 * window, so a ribbon whose ends are both off-screen is one short vertical run; a curve is drawn
 * only when its row band reaches the clip. Returns "" for an edge wholly outside it.
 */
export function edgePath(e: EdgeGeometry, win: PathWindow): string {
  const top = -H;
  const bottom = (win.end - win.start) * H + H;
  const yc = rowY(e.childRow, win.start);
  const open = e.parentRow === OPEN_ROW;
  const yp = open ? Infinity : rowY(e.parentRow, win.start);
  if (yp < top || yc > bottom) return "";
  const xc = laneX(e.childLane);
  const xl = laneX(e.lane);
  const xp = open ? xl : laneX(e.parentLane);

  if (!open && e.parentRow === e.childRow + 1) {
    return xc === xp ? `M${n(xc)},${n(yc)}V${n(yp)}` : `M${n(xc)},${n(yc)}${curve(xc, yc, xp)}`;
  }

  let d = "";
  // Where the pen is, when the next piece can carry on from it.
  let pen: number | null = null;
  const topCurve = xc !== xl;
  const bottomCurve = xp !== xl;
  if (topCurve && yc + H >= top) {
    d += `M${n(xc)},${n(yc)}${curve(xc, yc, xl)}`;
    pen = yc + H;
  }
  const runFrom = Math.max(topCurve ? yc + H : yc, top);
  const runTo = Math.min(bottomCurve ? yp - H : yp, bottom);
  if (runTo > runFrom) {
    d += (pen === runFrom ? "" : `M${n(xl)},${n(runFrom)}`) + `V${n(runTo)}`;
    pen = runTo;
  }
  if (bottomCurve && yp - H <= bottom) {
    d += (pen === yp - H ? "" : `M${n(xl)},${n(yp - H)}`) + curve(xl, yp - H, xp);
  }
  return d;
}

/** Edges batched into one path per color slot, so the edge layer is at most 12 elements. */
export function slotPaths(edges: Iterable<EdgeGeometry & { slot: number }>, win: PathWindow): string[] {
  const paths: string[] = Array.from({ length: SLOT_COUNT }, () => "");
  for (const e of edges) paths[e.slot] += edgePath(e, win);
  return paths;
}
