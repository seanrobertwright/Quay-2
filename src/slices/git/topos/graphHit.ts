// Hit-testing for the Topos graph (#351, #376): arithmetic over the row pitch and the node's lane,
// so one pointermove handler serves the whole canvas with no per-node listeners or DOM queries.

import { LANE_WIDTH, laneX, rowY } from "./graphPaths.ts";
import { ROW_HEIGHT } from "./graphWindow.ts";

/** Half a lane pitch, so neighbouring nodes never share a hit area. */
const HIT_RADIUS = LANE_WIDTH / 2;

/**
 * The row whose node lies under (`x`, `y`), or null. `x` is from the graph column's left edge and
 * `y` from the top of the window starting at `win.start`; `laneOf` gives the lane slot a row's
 * node is drawn in, after any collapse onto the stub.
 */
export function hitNode(
  x: number,
  y: number,
  win: { start: number; end: number },
  laneOf: (row: number) => number
): number | null {
  if (y < 0) return null;
  const row = win.start + Math.floor(y / ROW_HEIGHT);
  if (row >= win.end) return null;
  const dx = x - laneX(laneOf(row));
  const dy = y - rowY(row, win.start);
  return dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS ? row : null;
}
