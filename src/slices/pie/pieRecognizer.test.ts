// The pie menu's recognizer: where a stroke points, and what pressing, dragging, releasing,
// clicking and letters do to the menu. Expected values come from the spec's Pie menu section:
// a 26 px dead zone and eight 45° wedges with N straight up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOSED, DEAD_ZONE_PX, aimedWedge, stepPie, wedgeAt } from "./pieRecognizer.ts";

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
