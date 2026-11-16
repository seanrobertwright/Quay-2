// What the pie's first ring holds on each surface. Expected values are the spec's stroke table:
// N, E, S and W keep one command everywhere; SE, SW and NW act on the pointer target; a command
// that does not apply leaves its wedge empty (null), and the others never shift. NE (Merge) is
// empty in these first tests, which have no mergeable pull request; Merge's own tests follow.
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

// The second ring, from the spec's stroke table: Next wait, Split, Palette and New term are
// parents of three slices each, on every surface; Merge (NE), a parent only with a mergeable pull
// request, has its own test below.
const slices = (ring: ReturnType<typeof pieRing>) =>
  Object.fromEntries(Object.entries(ring).flatMap(([wedge, c]) => (c?.slices ? [[wedge, c.slices.map((s) => s && [s.label, s.action])]] : [])));

test("second ring: Prev, Next and Waiting list; Side, Stack and Grid; Claude, Codex and Pwsh", () => {
  for (const target of [{ surface: "terminal", terminalId: "t1", zoomable: true }, { surface: "empty-stage" }, { surface: "companion" }] as PieTarget[]) {
    const ring = slices(pieRing(target));
    assert.deepEqual(Object.keys(ring), ["N", "E", "S", "W"], target.surface);
    assert.deepEqual(ring.N, [["Prev", "prev-wait"], ["Next", "next-wait"], ["Waiting list", "waiting-list"]]);
    assert.deepEqual(ring.E, [["Side", "split-side"], ["Stack", "split-stack"], ["Grid", "split-grid"]]);
    assert.deepEqual(ring.W, [["Claude", "new-claude"], ["Codex", "new-codex"], ["Pwsh", "new-pwsh"]]);
  }
});

test("Palette's slices are copies of the three most recent palette commands, dim where there are fewer", () => {
  const target: PieTarget = { surface: "companion" };
  assert.deepEqual(pieRing(target).S?.slices, [null, null, null]);
  const recent = [
    { id: "layout-grid", title: "2x2 Quad Grid Layout" },
    { id: "open-topos", title: "Open Topos" },
  ];
  assert.deepEqual(pieRing(target, recent).S?.slices, [
    { action: "palette-command", label: "2x2 Quad Grid Layout", commandId: "layout-grid" },
    { action: "palette-command", label: "Open Topos", commandId: "open-topos" },
    null,
  ]);
  const four = [...recent, { id: "a", title: "A" }, { id: "b", title: "B" }];
  assert.deepEqual(pieRing(target, four).S?.slices?.map((s) => (s?.action === "palette-command" ? s.commandId : null)), ["layout-grid", "open-topos", "a"]);
});

// NE is Merge (#650): it acts on the selected terminal's pull request on every surface, so it shows
// wherever that pull request can merge, and stays empty on the empty stage and without one.
const MERGEABLE = true;

test("with a mergeable pull request, NE is Merge on every surface but the empty stage", () => {
  const targets: PieTarget[] = [
    { surface: "terminal", terminalId: "t1", zoomable: true },
    { surface: "panel", row: { kind: "terminal", terminalId: "t1", folder: "C:\r" } },
    { surface: "panel", row: null },
    { surface: "companion" },
    { surface: "companion-pr" },
    { surface: "other" },
  ];
  for (const target of targets) {
    const ne = pieRing(target, [], MERGEABLE).NE;
    assert.deepEqual(ne && [ne.label, ne.action, ne.letter], ["Merge", "merge", "m"], target.surface);
  }
  assert.equal(pieRing({ surface: "empty-stage" }, [], MERGEABLE).NE, null);
});

test("with no mergeable pull request, NE is empty everywhere", () => {
  assert.equal(pieRing({ surface: "terminal", terminalId: "t1", zoomable: true }, [], false).NE, null);
  assert.equal(pieRing({ surface: "companion-pr" }).NE, null);
});

test("Merge's second ring: Squash, Commit and Rebase", () => {
  const ne = pieRing({ surface: "companion" }, [], MERGEABLE).NE;
  assert.deepEqual(ne?.slices?.map((s) => s && [s.label, s.action]), [
    ["Squash", "merge-squash"],
    ["Commit", "merge-commit"],
    ["Rebase", "merge-rebase"],
  ]);
});

test("over the companion's pull request: SE opens the diff lens, SW the comment box, NW Checks", () => {
  assert.deepEqual(labels({ surface: "companion-pr" }), { ...FIXED, SE: "Diff lens", SW: "Comment", NW: "Checks" });
  const ring = pieRing({ surface: "companion-pr" }, [], MERGEABLE);
  assert.deepEqual([ring.SE?.action, ring.SW?.action, ring.NW?.action], ["diff-lens", "comment", "checks"]);
  const letters = Object.values(ring).flatMap((c) => (c ? [c.letter] : []));
  assert.equal(new Set(letters).size, letters.length);
});
