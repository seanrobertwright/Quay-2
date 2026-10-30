// The resizable graph column (#351, #376). The operator sets its width; lanes past its edge
// collapse onto one stub column, drawn as a grey dashed line in the column's last lane slot.

import { GRAPH_PADDING, LANE_WIDTH } from "./graphPaths.ts";

/** The prototype's default, which shows 12 lanes (#351). */
export const DEFAULT_COLUMN_WIDTH = 220;
/** Room for lane 0 and the stub. */
export const MIN_COLUMN_WIDTH = 2 * GRAPH_PADDING + 2 * LANE_WIDTH;
/** Room for 40 lane slots. */
export const MAX_COLUMN_WIDTH = 2 * GRAPH_PADDING + 40 * LANE_WIDTH;
/** How far PageUp and PageDown, or Shift with an arrow, move the handle. */
const BIG_STEP = 4 * LANE_WIDTH;

export interface ColumnLayout {
  /** The column's width in px, clamped. */
  width: number;
  /** The lane slot every lane at or past it collapses onto, or null when every lane fits. */
  stubLane: number | null;
}

export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COLUMN_WIDTH;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

/** The layout of a column `width` px wide over a history needing `peakLanes` lanes. */
export function columnLayout(width: number, peakLanes: number): ColumnLayout {
  const clamped = clampColumnWidth(width);
  const slots = Math.floor((clamped - 2 * GRAPH_PADDING) / LANE_WIDTH);
  return { width: clamped, stubLane: peakLanes > slots ? slots - 1 : null };
}

/**
 * The width the resize handle's `key` moves the column to, or null for a key it doesn't handle.
 * Arrows step one lane, Shift+arrow and PageUp/PageDown four, and Home and End go to either end.
 */
export function resizeByKey(width: number, key: string, shift: boolean): number | null {
  const step = shift ? BIG_STEP : LANE_WIDTH;
  switch (key) {
    case "ArrowRight":
      return clampColumnWidth(width + step);
    case "ArrowLeft":
      return clampColumnWidth(width - step);
    case "PageUp":
      return clampColumnWidth(width + BIG_STEP);
    case "PageDown":
      return clampColumnWidth(width - BIG_STEP);
    case "Home":
      return MIN_COLUMN_WIDTH;
    case "End":
      return MAX_COLUMN_WIDTH;
    default:
      return null;
  }
}
