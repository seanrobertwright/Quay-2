// The pie menu's recognizer: where a stroke points, and what pressing, dragging, releasing,
// clicking and letters do to the menu. Expected values come from the spec's Pie menu section:
// a 26 px dead zone and eight 45° wedges with N straight up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOSED, DEAD_ZONE_PX, SECOND_RING_PX, aimedSlice, aimedWedge, stepPie, wedgeAt, type PieStep } from "./pieRecognizer.ts";

const pick = (s: PieStep) => [s.chosen, s.slice];

test("inside the 26 px dead zone a stroke points at no wedge", () => {
  assert.equal(DEAD_ZONE_PX, 26);
  assert.equal(wedgeAt(0, 0), null);
  assert.equal(wedgeAt(25, 0), null);
  assert.equal(wedgeAt(0, -25.9), null);
  assert.equal(wedgeAt(18, 18), null, "25.5 px on the diagonal");
});

test("past the dead zone a stroke points at one of eight wedges, N straight up", () => {
  const cases: [number, number, string][] = [
    [0, -40, "N"],
    [40, -40, "NE"],
    [40, 0, "E"],
    [40, 40, "SE"],
    [0, 40, "S"],
    [-40, 40, "SW"],
    [-40, 0, "W"],
    [-40, -40, "NW"],
    [26, 0, "E"],
  ];
  for (const [dx, dy, wedge] of cases) assert.equal(wedgeAt(dx, dy), wedge, `${dx},${dy}`);
});

test("each wedge spans 45°: 22° off N is still N, 23° off N is NE", () => {
  const at = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return wedgeAt(100 * Math.sin(rad), -100 * Math.cos(rad));
  };
  assert.equal(at(22), "N");
  assert.equal(at(23), "NE");
  assert.equal(at(-22), "N");
  assert.equal(at(-23), "NW");
  assert.equal(at(338), "N");
  assert.equal(at(337), "NW");
  assert.equal(at(180), "S");
});

// A ring where every wedge but NE applies; NE is dim and empty, as Merge is on an empty stage.
const RING = { N: { letter: "q" }, E: { letter: "s" }, SE: { letter: "z" }, S: { letter: "p" }, SW: { letter: "r" }, W: { letter: "n" }, NW: { letter: "f" } };
const at = { x: 500, y: 300 };

test("hold, drag toward a wedge and release chooses it, with the menu shown or not yet shown", () => {
  for (const delayMs of [0, 150]) {
    let s = stepPie(CLOSED, { type: "press", at, time: 1000 }, RING, delayMs);
    assert.equal(s.state.phase, "held");
    assert.equal(s.state.phase === "held" && s.state.shown, delayMs === 0, "shown at once only with no delay");
    s = stepPie(s.state, { type: "move", at: { x: 500, y: 240 } }, RING, delayMs);
    s = stepPie(s.state, { type: "release", at: { x: 500, y: 240 }, time: 1050 }, RING, delayMs);
    assert.equal(s.chosen, "N", `delay ${delayMs}`);
    assert.equal(s.state.phase, "closed");
  }
});

test("the menu draws once the display delay has passed while the button is held", () => {
  let s = stepPie(CLOSED, { type: "press", at, time: 1000 }, RING, 150);
  s = stepPie(s.state, { type: "tick", time: 1149 }, RING, 150);
  assert.equal(s.state.phase === "held" && s.state.shown, false);
  s = stepPie(s.state, { type: "tick", time: 1150 }, RING, 150);
  assert.equal(s.state.phase === "held" && s.state.shown, true);
});

test("a plain click, released inside the dead zone, leaves the menu open and shown", () => {
  let s = stepPie(CLOSED, { type: "press", at, time: 1000 }, RING, 150);
  s = stepPie(s.state, { type: "release", at: { x: 510, y: 305 }, time: 1040 }, RING, 150);
  assert.equal(s.chosen, null);
  assert.equal(s.state.phase, "open");
  // Once open it is read and picked with a click on a wedge.
  s = stepPie(s.state, { type: "click", at: { x: 400, y: 300 } }, RING, 150);
  assert.equal(s.chosen, "W");
  assert.equal(s.state.phase, "closed");
});

test("a dim wedge is never chosen: releasing or clicking on it leaves the menu open", () => {
  let s = stepPie(CLOSED, { type: "press", at, time: 0 }, RING, 0);
  s = stepPie(s.state, { type: "release", at: { x: 560, y: 240 }, time: 90 }, RING, 0);
  assert.equal(s.chosen, null);
  assert.equal(s.state.phase, "open");
  s = stepPie(s.state, { type: "click", at: { x: 560, y: 240 } }, RING, 0);
  assert.equal(s.chosen, null);
  assert.equal(s.state.phase, "open");
});

test("a click in the open menu's dead zone, or Escape, closes it with nothing chosen", () => {
  const open = stepPie(stepPie(CLOSED, { type: "press", at, time: 0 }, RING, 0).state, { type: "release", at, time: 50 }, RING, 0).state;
  const clicked = stepPie(open, { type: "click", at: { x: 505, y: 300 } }, RING, 0);
  assert.deepEqual([clicked.state.phase, clicked.chosen], ["closed", null]);
  const escaped = stepPie(open, { type: "key", key: "Escape" }, RING, 0);
  assert.deepEqual([escaped.state.phase, escaped.chosen], ["closed", null]);
});

test("a wedge's letter chooses it while the menu is held or open, in either case; other keys do nothing", () => {
  const held = stepPie(CLOSED, { type: "press", at, time: 0 }, RING, 150).state;
  assert.equal(stepPie(held, { type: "key", key: "p" }, RING, 150).chosen, "S");
  const open = stepPie(held, { type: "release", at, time: 50 }, RING, 150).state;
  assert.equal(stepPie(open, { type: "key", key: "Z" }, RING, 150).chosen, "SE");
  const other = stepPie(open, { type: "key", key: "x" }, RING, 150);
  assert.deepEqual([other.state.phase, other.chosen], ["open", null]);
});

test("the aimed wedge follows the pointer, and is null in the dead zone or on a dim wedge", () => {
  let s = stepPie(CLOSED, { type: "press", at, time: 0 }, RING, 0);
  assert.equal(aimedWedge(s.state, RING), null);
  s = stepPie(s.state, { type: "move", at: { x: 500, y: 360 } }, RING, 0);
  assert.equal(aimedWedge(s.state, RING), "S");
  s = stepPie(s.state, { type: "move", at: { x: 560, y: 240 } }, RING, 0);
  assert.equal(aimedWedge(s.state, RING), null, "NE is dim");
});

// The second ring, from the spec's Pie menu section and the second-ring prototype: it starts at
// 132 px, each parent has three 20° slices spanning its direction ±30°, and on crossing the first
// ring the stroke locks to the nearest parent within 30°, holding it until the pointer is more
// than 32° off it. Here N (Next wait), NE (Merge) and E (Split) are parents, side by side.
const SLICES = [{}, {}, {}];
const PARENTS = { N: { letter: "q", slices: SLICES }, NE: { letter: "m", slices: SLICES }, E: { letter: "s", slices: SLICES }, SE: { letter: "z" }, S: { letter: "p" } };

/** The point `r` px from `at` at `deg` clockwise from N. */
const out = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: at.x + r * Math.sin(rad), y: at.y - r * Math.cos(rad) };
};

/** Presses at `at`, moves through `path` and releases at its last point. */
function stroke(path: { x: number; y: number }[], ring = PARENTS) {
  let s = stepPie(CLOSED, { type: "press", at, time: 0 }, ring, 0);
  for (const p of path) s = stepPie(s.state, { type: "move", at: p }, ring, 0);
  return stepPie(s.state, { type: "release", at: path[path.length - 1], time: 500 }, ring, 0);
}

test("the second ring starts at 132 px: short of it a stroke picks the parent, past it one of its three 20° slices", () => {
  assert.equal(SECOND_RING_PX, 132);
  assert.deepEqual(pick(stroke([out(131, 0)])), ["N", null]);
  assert.deepEqual(pick(stroke([out(132, 0)])), ["N", 1]);
  assert.deepEqual(pick(stroke([out(160, -25)])), ["N", 0]);
  assert.deepEqual(pick(stroke([out(160, -9)])), ["N", 1]);
  assert.deepEqual(pick(stroke([out(160, 11)])), ["N", 2]);
  assert.deepEqual(pick(stroke([out(160, 90)])), ["E", 1]);
});

test("a stroke at a Merge-side slice locks to Merge on crossing and never picks Next wait", () => {
  // Aimed at Merge, it crosses the first ring, then drifts toward N into Merge's first slice:
  // 18° from N but 27° from Merge. The wedge under the pointer is N's; the lock holds Merge.
  const s = stroke([out(100, 40), out(140, 40), out(150, 18)]);
  assert.deepEqual(pick(s), ["NE", 0]);
  assert.equal(aimedWedge(stepPie(CLOSED, { type: "press", at, time: 0 }, PARENTS, 0).state, PARENTS), null);
});

test("on crossing, the ring locks to the nearest parent within 30°, not the wedge under the pointer", () => {
  // 115° is SE's wedge (Zoom, no second ring), 25° from E: the lock goes to E, its last slice.
  assert.deepEqual(pick(stroke([out(150, 115)])), ["E", 2]);
  // 165° is 30° from S, which has no second ring, and 75° from E: no parent within 30°, so the
  // first ring's wedge under the pointer is picked.
  assert.deepEqual(pick(stroke([out(150, 165)])), ["S", null]);
});

test("the lock holds to 32° off its parent, then goes to the nearest parent within 30°", () => {
  // Locked to N, the pointer swings to 31° (N's wedge no longer; NE is 14° away): still N's last slice.
  assert.deepEqual(pick(stroke([out(150, 0), out(150, 31)])), ["N", 2]);
  // At 33° the lock lets go and Merge, 12° away, takes it: its first slice.
  assert.deepEqual(pick(stroke([out(150, 0), out(150, 33)])), ["NE", 0]);
  // Back inside the second ring the lock is gone: crossing again locks afresh.
  assert.deepEqual(pick(stroke([out(150, 40), out(100, 5), out(150, 5)])), ["N", 1]);
});

test("the aimed wedge and slice follow the lock; a dim slice is never chosen and leaves the menu open", () => {
  let s = stepPie(CLOSED, { type: "press", at, time: 0 }, PARENTS, 0);
  s = stepPie(s.state, { type: "move", at: out(140, 40) }, PARENTS, 0);
  s = stepPie(s.state, { type: "move", at: out(150, 18) }, PARENTS, 0);
  assert.equal(aimedWedge(s.state, PARENTS), "NE");
  assert.equal(aimedSlice(s.state, PARENTS), 0);
  const ring = { ...PARENTS, N: { letter: "q", slices: [{}, null, null] } };
  const dim = stroke([out(150, 0)], ring);
  assert.deepEqual([dim.state.phase, dim.chosen], ["open", null]);
  assert.deepEqual(pick(stroke([out(150, -20)], ring)), ["N", 0]);
});

test("a click on a slice of the open menu chooses it", () => {
  let s = stepPie(CLOSED, { type: "press", at, time: 0 }, PARENTS, 0);
  s = stepPie(s.state, { type: "release", at, time: 50 }, PARENTS, 0);
  s = stepPie(s.state, { type: "move", at: out(150, 95) }, PARENTS, 0);
  s = stepPie(s.state, { type: "click", at: out(150, 95) }, PARENTS, 0);
  assert.deepEqual(pick(s), ["E", 1]);
});
