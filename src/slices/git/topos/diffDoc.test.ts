/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDoc, unifiedDoc, type FileDiff, type Hunk } from "./diffDoc.ts";

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

const twoHunks = diff([
  hunk(1, 1, [
    { kind: "context", text: "one\r" },
    { kind: "del", text: "two" },
    { kind: "add", text: "TWO" },
    { kind: "add", text: "2b" },
  ]),
  hunk(9, 10, [
    { kind: "del", text: "nine" },
    { kind: "noNewline", text: " No newline at end of file" },
  ]),
]);

test("the unified doc lists every line with its old and new numbers and marks where each hunk starts", () => {
  const doc = unifiedDoc(twoHunks);
  // A CR shows as a visible mark, so it never breaks a line or vanishes.
  assert.equal(doc.text, "one␍\ntwo\nTWO\n2b\nnine\n\\ No newline at end of file");
  assert.deepEqual(
    doc.lines.map((l) => [l.kind, l.oldNo, l.newNo, l.hunk]),
    [
      ["context", 1, 1, 0],
      ["del", 2, null, 0],
      ["add", null, 2, 0],
      ["add", null, 3, 0],
      ["del", 9, null, 1],
      ["noNewline", null, null, 1],
    ]
  );
  assert.deepEqual(doc.hunkStarts, [0, 4]);
});

test("the split doc pairs deletions with additions and pads the shorter side so rows line up", () => {
  const { left, right, hunkStarts } = splitDoc(twoHunks);
  assert.equal(left.text, "one␍\ntwo\n\nnine\n\\ No newline at end of file");
  assert.equal(right.text, "one␍\nTWO\n2b\n\n");
  assert.deepEqual(
    left.lines.map((l) => [l.kind, l.oldNo]),
    [
      ["context", 1],
      ["del", 2],
      ["filler", null],
      ["del", 9],
      ["noNewline", null],
    ]
  );
  assert.deepEqual(
    right.lines.map((l) => [l.kind, l.newNo]),
    [
      ["context", 1],
      ["add", 2],
      ["add", 3],
      ["filler", null],
      ["filler", null],
    ]
  );
  assert.deepEqual(hunkStarts, [0, 3]);
});

test("a diff with no hunks is an empty doc", () => {
  const doc = unifiedDoc(diff([]));
  assert.equal(doc.text, "");
  assert.deepEqual(doc.lines, []);
  assert.deepEqual(doc.hunkStarts, []);
});
