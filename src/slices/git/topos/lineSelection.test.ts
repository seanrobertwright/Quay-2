/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDoc, unifiedDoc, type FileDiff, type Hunk } from "./diffDoc.ts";
import {
  clickRow,
  dragRows,
  emptySelection,
  keyStep,
  lineAnnouncement,
  linesLabel,
  selectionCount,
  lineKey,
  rangeRefs,
  selectedRefs,
  withNoNewlinePairs,
  type LineRef,
} from "./lineSelection.ts";

function hunk(oldStart: number, newStart: number, lines: Hunk["lines"]): Hunk {
  const oldLines = lines.filter((l) => l.kind === "context" || l.kind === "del").length;
  const newLines = lines.filter((l) => l.kind === "context" || l.kind === "add").length;
  return { oldStart, oldLines, newStart, newLines, heading: "", lines };
}

function diff(hunks: Hunk[]): FileDiff {
  return {
    requestId: 1,
    path: "a.txt",
    diffToken: "3.abc.1",
    change: "modified",
    binary: false,
    submodule: false,
    tooLarge: false,
    bytes: 0,
    lineCount: 0,
    modeChange: null,
    oldOid: "abc",
    newOid: null,
    hunks,
  };
}

// Rows of the unified doc: 0 ` one`, 1 `-two`, 2 `+TWO`, 3 ` three`, then hunk 1: 4 ` nine`, 5 `-ten`, 6 `+TEN`.
const twoHunks = diff([
  hunk(1, 1, [
    { kind: "context", text: "one" },
    { kind: "del", text: "two" },
    { kind: "add", text: "TWO" },
    { kind: "context", text: "three" },
  ]),
  hunk(9, 9, [
    { kind: "context", text: "nine" },
    { kind: "del", text: "ten" },
    { kind: "add", text: "TEN" },
  ]),
]);

const refs = (...pairs: [number, number][]): LineRef[] => pairs.map(([hunk, line]) => ({ hunk, line }));
const keys = (...pairs: [number, number][]) => new Set(refs(...pairs).map(lineKey));

test("a range picks only changed lines, in either direction, across hunks", () => {
  const doc = unifiedDoc(twoHunks);
  assert.deepEqual(rangeRefs(doc, 0, 6), refs([0, 1], [0, 2], [1, 1], [1, 2]));
  assert.deepEqual(rangeRefs(doc, 5, 2), refs([0, 2], [1, 1]));
  assert.deepEqual(rangeRefs(doc, 3, 4), []);
});

test("a click toggles a changed line and ignores a context line; Shift-click adds the range from the anchor", () => {
  const doc = unifiedDoc(twoHunks);
  let s = clickRow(emptySelection, doc, 1, false);
  assert.deepEqual(s.picked, keys([0, 1]));
  assert.deepEqual(clickRow(s, doc, 0, false), s, "a context line is never selected");
  s = clickRow(s, doc, 6, true);
  assert.deepEqual(s.picked, keys([0, 1], [0, 2], [1, 1], [1, 2]));
  s = clickRow(s, doc, 2, false);
  assert.deepEqual(s.picked, keys([0, 1], [1, 1], [1, 2]), "a second click deselects");
  assert.deepEqual(s.cursor, { hunk: 0, line: 2 });
});

test("a drag adds every changed line it passes to what was picked before it began", () => {
  const doc = unifiedDoc(twoHunks);
  const before = clickRow(emptySelection, doc, 6, false);
  const started = clickRow(before, doc, 1, false);
  assert.deepEqual(dragRows(before, doc, 1, 5).picked, keys([0, 1], [0, 2], [1, 1], [1, 2]));
  assert.deepEqual(dragRows(before, doc, 1, 1).picked, started.picked, "a drag that never moved is the click");
});

test("in the split view each side's rows map back to the same lines", () => {
  const { left, right } = splitDoc(twoHunks);
  assert.deepEqual(rangeRefs(left, 0, left.lines.length - 1), refs([0, 1], [1, 1]));
  assert.deepEqual(rangeRefs(right, 0, right.lines.length - 1), refs([0, 2], [1, 2]));
});

// ` a`, `-b`, the marker that b had no newline, `+b`, `+c`, `+d`.
const noNewline = [
  hunk(1, 1, [
    { kind: "context", text: "a" },
    { kind: "del", text: "b" },
    { kind: "noNewline", text: " No newline at end of file" },
    { kind: "add", text: "b" },
    { kind: "add", text: "c" },
    { kind: "add", text: "d" },
  ]),
];

test("staging a line after an old last line with no newline adds the pair that gives it one", () => {
  const out = withNoNewlinePairs(noNewline, keys([0, 5]), "stage");
  assert.deepEqual(out.keys, keys([0, 1], [0, 3], [0, 5]));
  assert.deepEqual(out.auto, keys([0, 1], [0, 3]));
  // The deletion alone needs nothing more.
  assert.deepEqual(withNoNewlinePairs(noNewline, keys([0, 1]), "stage").auto, new Set());
});

test("unstaging the pair or a line after it takes every later added line with it", () => {
  const out = withNoNewlinePairs(noNewline, keys([0, 1]), "unstage");
  assert.deepEqual(out.keys, keys([0, 1], [0, 3], [0, 4], [0, 5]));
  assert.deepEqual(out.auto, keys([0, 3], [0, 4], [0, 5]));
  assert.deepEqual(withNoNewlinePairs(noNewline, keys([0, 4]), "unstage").keys, keys([0, 1], [0, 3], [0, 4], [0, 5]));
});

test("lines without a no-newline marker are left as picked, and the request lists them in order", () => {
  const out = withNoNewlinePairs(twoHunks.hunks, keys([1, 2], [0, 1]), "stage");
  assert.deepEqual(out.auto, new Set());
  assert.deepEqual(selectedRefs(out.keys), refs([0, 1], [1, 2]));
});

test("↑/↓ move between changed lines across hunks, Shift extends, Space toggles, n/p jump hunks", () => {
  const doc = unifiedDoc(twoHunks);
  let s = keyStep(emptySelection, doc, "down");
  assert.deepEqual(s.cursor, { hunk: 0, line: 1 }, "the first key lands on the first changed line");
  s = keyStep(keyStep(s, doc, "down"), doc, "down");
  assert.deepEqual(s.cursor, { hunk: 1, line: 1 }, "context lines are skipped");
  assert.deepEqual(keyStep(s, doc, "up").cursor, { hunk: 0, line: 2 });
  assert.deepEqual(s.picked, new Set(), "moving picks nothing");

  s = keyStep(s, doc, "toggle");
  assert.deepEqual(s.picked, keys([1, 1]));
  s = keyStep(keyStep(s, doc, "extendUp"), doc, "extendUp");
  assert.deepEqual(s.picked, keys([0, 1], [0, 2], [1, 1]));
  assert.deepEqual(s.cursor, { hunk: 0, line: 1 });
  assert.deepEqual(keyStep(s, doc, "up").cursor, { hunk: 0, line: 1 }, "the first line stays put");
  assert.deepEqual(keyStep(s, doc, "toggle").picked, keys([0, 2], [1, 1]));

  assert.deepEqual(keyStep(s, doc, "nextHunk").cursor, { hunk: 1, line: 1 });
  assert.deepEqual(keyStep(keyStep(s, doc, "nextHunk"), doc, "prevHunk").cursor, { hunk: 0, line: 1 });
});

test("in a split pane the keys move over that side's lines from wherever the cursor was", () => {
  const { left, right } = splitDoc(twoHunks);
  const onAdd = { ...emptySelection, cursor: { hunk: 0, line: 2 } };
  assert.deepEqual(keyStep(onAdd, left, "down").cursor, { hunk: 1, line: 1 });
  assert.deepEqual(keyStep(onAdd, left, "up").cursor, { hunk: 0, line: 1 });
  assert.deepEqual(keyStep(onAdd, right, "down").cursor, { hunk: 1, line: 2 });
});

test("a line is announced by its kind, number, state and text, and the selection by its size", () => {
  assert.equal(lineAnnouncement(twoHunks.hunks, { hunk: 1, line: 2 }, false), "Added line 10: TEN");
  assert.equal(lineAnnouncement(twoHunks.hunks, { hunk: 0, line: 1 }, true), "Deleted line 2, selected: two");
  assert.equal(lineAnnouncement(twoHunks.hunks, { hunk: 0, line: 1 }, false, "Hunk 1 of 2"), "Hunk 1 of 2, deleted line 2: two");
  assert.equal(selectionCount(0, 0), "No lines selected");
  assert.equal(selectionCount(1, 0), "1 line selected");
  assert.equal(selectionCount(3, 2), "3 lines selected, 2 added for a missing newline at end of file");
  assert.equal(linesLabel("stage", 1), "Stage 1 line");
  assert.equal(linesLabel("unstage", 12), "Unstage 12 lines");
});
