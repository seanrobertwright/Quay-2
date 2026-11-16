// The pie's stroke log, kept so overshoot between neighbouring parents can be checked in use: the
// spec says to switch the second ring to Turn if those errors pass 1 in 15. Each stroke chosen
// with the pointer is logged; one that ends in a parent's second ring within 30° of a neighbouring
// parent is flagged with that neighbour. N (Next wait), NE (Merge) and E (Split) are parents here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LOGGED_STROKES, logStroke, pieStrokeLog, strokeRecord, strokeSummary, type PieStrokeRecord } from "./pieStrokeLog.ts";

const SLICES = [{}, {}, {}];
const RING = { N: { letter: "q", slices: SLICES }, NE: { letter: "m", slices: SLICES }, E: { letter: "s", slices: SLICES }, SE: { letter: "z" } };
const origin = { x: 500, y: 300 };
const out = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: origin.x + r * Math.sin(rad), y: origin.y - r * Math.cos(rad) };
};

test("a second-ring pick released within 30° of a neighbouring parent is flagged with that parent", () => {
  // Merge's first slice, 18° from Next wait.
  assert.deepEqual(strokeRecord(RING, { chosen: "NE", slice: 0 }, origin, out(150, 18), 1000), {
    time: 1000,
    wedge: "NE",
    slice: 0,
    distancePx: 150,
    bearingDeg: 18,
    neighbour: "N",
  });
  // Next wait's last slice at 25°, 20° from Merge.
  assert.equal(strokeRecord(RING, { chosen: "N", slice: 2 }, origin, out(150, 25), 0)?.neighbour, "NE");
  // Next wait's middle slice, 45° from Merge: no neighbour.
  assert.equal(strokeRecord(RING, { chosen: "N", slice: 1 }, origin, out(150, 0), 0)?.neighbour, null);
  // A first-ring pick is logged, never flagged.
  assert.deepEqual(strokeRecord(RING, { chosen: "N", slice: null }, origin, out(100, 20), 5), {
    time: 5,
    wedge: "N",
    slice: null,
    distancePx: 100,
    bearingDeg: 20,
    neighbour: null,
  });
  assert.equal(strokeRecord(RING, { chosen: null, slice: null }, origin, out(10, 0), 0), null, "nothing chosen");
});

test("the summary counts strokes on parents, those that went to a second ring, and those between parents", () => {
  const log: PieStrokeRecord[] = [
    { time: 0, wedge: "N", slice: null, distancePx: 90, bearingDeg: 0, neighbour: null },
    { time: 1, wedge: "N", slice: 1, distancePx: 150, bearingDeg: 0, neighbour: null },
    { time: 2, wedge: "NE", slice: 0, distancePx: 150, bearingDeg: 18, neighbour: "N" },
    { time: 3, wedge: "SE", slice: null, distancePx: 90, bearingDeg: 135, neighbour: null },
  ];
  assert.deepEqual(strokeSummary(log, RING), { parentStrokes: 3, secondRing: 2, betweenParents: 1 });
});

test("the log keeps the newest strokes, oldest dropped first, and survives a restart", () => {
  const items = new Map<string, string>();
  const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
  const record = (time: number): PieStrokeRecord => ({ time, wedge: "N", slice: null, distancePx: 90, bearingDeg: 0, neighbour: null });
  let log: PieStrokeRecord[] = [];
  for (let t = 0; t < MAX_LOGGED_STROKES + 2; t++) log = logStroke(log, record(t));
  assert.equal(log.length, MAX_LOGGED_STROKES);
  assert.equal(log[0].time, 2);
  assert.equal(log[log.length - 1].time, MAX_LOGGED_STROKES + 1);

  pieStrokeLog(storage).add(record(7));
  pieStrokeLog(storage).add(record(8));
  assert.deepEqual(
    pieStrokeLog(storage).read().map((r) => r.time),
    [7, 8]
  );
  items.set([...items.keys()][0], "not json");
  assert.deepEqual(pieStrokeLog(storage).read(), []);
});
