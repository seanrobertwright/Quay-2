/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { edgePath, laneX, rowY, slotPaths, type EdgeGeometry } from "./graphPaths.ts";
import { OPEN_ROW } from "./graphPage.ts";

// Worked by hand from the findings' formulas with H = 28, W = 16, P = W/2 = 8 and k = 0.8, so
// lane l sits at x = 16 + 16·l, row r at y = 14 + 28·r in a window starting at row 0, and k·H = 22.4.
const win = { start: 0, end: 40 };

function edge(childRow: number, parentRow: number, childLane: number, lane: number, parentLane: number): EdgeGeometry {
  return { childRow, parentRow, childLane, lane, parentLane };
}

test("lanes and rows sit at P + l·W + W/2 and r·H + H/2, in window-local y", () => {
  assert.equal(laneX(0), 16);
  assert.equal(laneX(3), 64);
  assert.equal(rowY(0, 0), 14);
  assert.equal(rowY(1003, 1000), 98);
});

test("an edge that stays in its lane is one vertical run", () => {
  assert.equal(edgePath(edge(0, 3, 0, 0, 0), win), "M16,14V98");
});

test("a merge edge curves at its top end, then runs down its lane", () => {
  assert.equal(edgePath(edge(1, 4, 0, 1, 1), win), "M16,42C16,64.4 32,47.6 32,70V126");
});

test("a fork edge runs down its lane, then curves into the parent at its bottom end", () => {
  assert.equal(edgePath(edge(0, 3, 1, 1, 0), win), "M32,14V70C32,92.4 16,75.6 16,98");
});

test("a one-row lane change is a single S-curve with vertical ends", () => {
  assert.equal(edgePath(edge(0, 1, 0, 1, 1), win), "M16,14C16,36.4 32,19.6 32,42");
  assert.equal(edgePath(edge(0, 1, 1, 0, 0), win), "M32,14C32,36.4 16,19.6 16,42");
});

test("a ribbon with both ends off-screen is one vertical run clipped to the window", () => {
  // The window holds rows 1000 to 1039; the clip reaches one row pitch past each side.
  const deep = { start: 1000, end: 1040 };
  assert.equal(edgePath(edge(10, 5000, 2, 2, 2), deep), "M48,-28V1148");
  assert.equal(edgePath(edge(10, 5000, 0, 2, 2), deep), "M48,-28V1148");
});

test("an edge still open runs to the bottom of the window", () => {
  assert.equal(edgePath(edge(0, OPEN_ROW, 0, 0, 0), win), "M16,14V1148");
});

test("an edge wholly above or below the window draws nothing", () => {
  assert.equal(edgePath(edge(0, 3, 0, 0, 0), { start: 100, end: 140 }), "");
  assert.equal(edgePath(edge(500, 600, 0, 0, 0), win), "");
});

test("a curve whose end is clipped keeps only the part of the run on screen", () => {
  // The fork's curve into the parent at row 3000 lies far below the window.
  assert.equal(edgePath(edge(1, 3000, 1, 1, 0), win), "M32,42V1148");
});

test("edges batch into one path per color slot, and an octopus draws one curve per extra parent", () => {
  const edges = [
    { ...edge(0, 3, 0, 0, 0), slot: 0 },
    { ...edge(0, 1, 0, 1, 1), slot: 4 },
    { ...edge(0, 1, 0, 2, 2), slot: 4 },
    { ...edge(0, 1, 0, 3, 3), slot: 7 },
  ];
  const { slots: paths, stub } = slotPaths(edges, win);
  assert.equal(paths.length, 12);
  assert.equal(stub, "");
  assert.equal(paths[0], "M16,14V98");
  assert.equal(paths[4], "M16,14C16,36.4 32,19.6 32,42M16,14C16,36.4 48,19.6 48,42");
  assert.equal(paths[7], "M16,14C16,36.4 64,19.6 64,42");
  assert.equal(paths.filter((d) => d !== "").length, 3);
});

test("edges past the column's edge draw in the stub path, and a ribbon into the stub stays continuous", () => {
  // Lanes 3 and up collapse onto the stub in slot 3, at x = 64.
  const stubbed = { stubLane: 3 };
  const edges = [
    // A merge from lane 1 into lane 5: its curve ends at the stub, and the run carries on there.
    { ...edge(0, 3, 1, 5, 5), slot: 2 },
    // Runs wholly past the edge, in lanes 4 and 7.
    { ...edge(1, 2, 4, 4, 4), slot: 6 },
    { ...edge(2, 3, 7, 7, 7), slot: 9 },
    // A fork in lane 2, which still shows, keeps its color.
    { ...edge(0, 2, 2, 2, 0), slot: 5 },
  ];
  const { slots, stub } = slotPaths(edges, win, stubbed);
  assert.equal(stub, "M32,14C32,36.4 64,19.6 64,42V98M64,42V70M64,70V98");
  assert.equal(slots[5], "M48,14V42C48,64.4 16,47.6 16,70");
  assert.equal(slots.filter((d) => d !== "").length, 1);
});
