/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileDiff } from "./diffDoc.ts";
import { diffBody, imageMime, modeLabel, previewSources, selectionDoneMessage, sizeLabel } from "./diffView.ts";

const base: FileDiff = {
  requestId: 1,
  path: "img/logo.png",
  diffToken: "3.abc.1",
  change: "modified",
  binary: false,
  submodule: false,
  tooLarge: false,
  bytes: 10,
  lineCount: 1,
  modeChange: null,
  oldOid: "a".repeat(40),
  newOid: "b".repeat(40),
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, heading: "", lines: [{ kind: "add", text: "x" }] }],
};

test("a diff shows its hunks unless it is binary, a submodule, too large or empty", () => {
  assert.equal(diffBody(base), "text");
  assert.equal(diffBody({ ...base, binary: true, hunks: [] }), "binary");
  assert.equal(diffBody({ ...base, submodule: true }), "submodule");
  assert.equal(diffBody({ ...base, tooLarge: true, hunks: [] }), "tooLarge");
  assert.equal(diffBody({ ...base, change: "unchanged", hunks: [] }), "unchanged");
  // A mode change alone has no hunks but is still a change.
  assert.equal(diffBody({ ...base, hunks: [], modeChange: { oldMode: "100644", newMode: "100755" } }), "modeOnly");
});

test("a mode change reads as its two modes", () => {
  assert.equal(modeLabel({ oldMode: "100644", newMode: "100755" }), "Mode 100644 → 100755");
});

test("only png, jpg, gif, webp and svg files get a preview, by extension in any case", () => {
  assert.deepEqual(
    ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.svg", "g.bmp", "svg", "h.svg.txt"].map(imageMime),
    ["image/png", "image/jpeg", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", null, null, null]
  );
});

test("the preview's before and after come from the index, HEAD, a commit or the worktree by side", () => {
  const blob = (oid: string) => ({ kind: "blob", oid });
  assert.deepEqual(previewSources(base, { kind: "unstaged" }), { before: blob("a".repeat(40)), after: { kind: "worktree" } });
  assert.deepEqual(previewSources(base, { kind: "staged" }), { before: blob("a".repeat(40)), after: blob("b".repeat(40)) });
  assert.deepEqual(previewSources({ ...base, change: "untracked", oldOid: null }, { kind: "unstaged" }), {
    before: null,
    after: { kind: "worktree" },
  });
  assert.deepEqual(previewSources({ ...base, change: "deleted", newOid: null }, { kind: "unstaged" }), {
    before: blob("a".repeat(40)),
    after: null,
  });
  assert.deepEqual(previewSources({ ...base, change: "added", oldOid: null }, { kind: "staged" }), {
    before: null,
    after: blob("b".repeat(40)),
  });
});

test("sizes read in bytes, KB or MB", () => {
  assert.deepEqual([sizeLabel(900), sizeLabel(2048), sizeLabel(5 * 1024 * 1024)], ["900 B", "2.0 KB", "5.0 MB"]);
});

test("a finished selection stage is announced by what it staged", () => {
  assert.equal(selectionDoneMessage("stage", "a.txt", { kind: "hunks", hunks: [1] }), "Staged hunk 2 of a.txt");
  assert.equal(selectionDoneMessage("unstage", "a.txt", { kind: "modeChange" }), "Unstaged the mode change of a.txt");
  assert.equal(selectionDoneMessage("stage", "a.txt", { kind: "file" }), "Staged a.txt");
});
