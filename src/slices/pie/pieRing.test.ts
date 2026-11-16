// What the pie's first ring holds on each surface. Expected values are the spec's stroke table:
// N, E, S and W keep one command everywhere; SE, SW and NW act on the pointer target; a command
// that does not apply leaves its wedge empty (null), and the others never shift. NE (Merge) and the
// companion's pull request wedges come with the Merge stroke ticket, so they stay empty here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pieFolder, pieRing, pieTerminalId, type PieTarget } from "./pieRing.ts";

/** A ring as wedge → label, with empty wedges as null. */
function labels(target: PieTarget) {
  const ring = pieRing(target);
  return Object.fromEntries(Object.entries(ring).map(([wedge, command]) => [wedge, command?.label ?? null]));
}

const FIXED = { N: "Next wait", NE: null, E: "Split", S: "Palette", W: "New term" };

test("over a terminal: Zoom, Rename and Find on the diagonals", () => {
  assert.deepEqual(labels({ surface: "terminal", terminalId: "t1", zoomable: true }), { ...FIXED, SE: "Zoom", SW: "Rename", NW: "Find" });
});

test("a lone pane that is not zoomed has nothing to zoom, so Zoom's wedge is empty", () => {
  assert.deepEqual(labels({ surface: "terminal", terminalId: "t1", zoomable: false }), { ...FIXED, SE: null, SW: "Rename", NW: "Find" });
});

test("over a terminal row on the module bar or a panel: Show in pane, Rename and Open folder", () => {
  const row = { kind: "terminal", terminalId: "t1", folder: "C:\\src\\repo" } as const;
  assert.deepEqual(labels({ surface: "panel", row }), { ...FIXED, SE: "Show in pane", SW: "Rename", NW: "Open folder" });
});

test("over a project or worktree row only Open folder applies; with no row the diagonals are empty", () => {
  assert.deepEqual(labels({ surface: "panel", row: { kind: "folder", folder: "C:\\src\\repo" } }), {
    ...FIXED,
    SE: null,
    SW: null,
    NW: "Open folder",
  });
  assert.deepEqual(labels({ surface: "panel", row: null }), { ...FIXED, SE: null, SW: null, NW: null });
});

test("over the empty stage: NW opens the Agents panel, SE and SW are empty", () => {
  assert.deepEqual(labels({ surface: "empty-stage" }), { ...FIXED, SE: null, SW: null, NW: "Agents panel" });
});

test("over the companion and anywhere else, only the fixed strokes", () => {
  for (const surface of ["companion", "other"] as const) {
    assert.deepEqual(labels({ surface }), { ...FIXED, SE: null, SW: null, NW: null }, surface);
  }
});

test("every surface keeps all eight wedges in order, and letters never repeat on one ring", () => {
  const targets: PieTarget[] = [
    { surface: "terminal", terminalId: "t1", zoomable: true },
    { surface: "panel", row: { kind: "terminal", terminalId: "t1", folder: "C:\\r" } },
    { surface: "empty-stage" },
    { surface: "companion" },
  ];
  for (const target of targets) {
    const ring = pieRing(target);
    assert.deepEqual(Object.keys(ring), ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
    const letters = Object.values(ring).flatMap((c) => (c ? [c.letter] : []));
    assert.equal(new Set(letters).size, letters.length, target.surface);
  }
  // The letters the pie prototype settled on.
  const t = pieRing({ surface: "terminal", terminalId: "t1", zoomable: true });
  assert.deepEqual([t.N?.letter, t.E?.letter, t.SE?.letter, t.S?.letter, t.SW?.letter, t.W?.letter, t.NW?.letter], ["q", "s", "z", "p", "r", "n", "f"]);
});

test("the terminal a stroke acts on: the pane's, or a terminal row's; none elsewhere", () => {
  assert.equal(pieTerminalId({ surface: "terminal", terminalId: "t1", zoomable: false }), "t1");
  assert.equal(pieTerminalId({ surface: "panel", row: { kind: "terminal", terminalId: "t2", folder: "C:\r" } }), "t2");
  assert.equal(pieTerminalId({ surface: "panel", row: { kind: "folder", folder: "C:\r" } }), null);
  assert.equal(pieTerminalId({ surface: "panel", row: null }), null);
  assert.equal(pieTerminalId({ surface: "companion" }), null);
});

test("the folder a stroke acts on: a row's; none off a row", () => {
  assert.equal(pieFolder({ surface: "panel", row: { kind: "terminal", terminalId: "t2", folder: "C:\t" } }), "C:\t");
  assert.equal(pieFolder({ surface: "panel", row: { kind: "folder", folder: "C:\r" } }), "C:\r");
  assert.equal(pieFolder({ surface: "panel", row: null }), null);
  assert.equal(pieFolder({ surface: "terminal", terminalId: "t1", zoomable: true }), null);
});
