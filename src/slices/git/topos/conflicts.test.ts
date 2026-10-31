/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmMarkResolved, confirmReset, confirmTakeSide, paneLabels, parseConflicts, resolverFailure, takeHunk, unresolvedLabel } from "./conflicts.ts";
import type { OpState } from "./operation.ts";

const MERGED = "one\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\nthree\n";

test("a conflict hunk is found with each side's text and label", () => {
  const parsed = parseConflicts(MERGED, 7);
  assert.equal(parsed.hunks.length, 1);
  const [hunk] = parsed.hunks;
  assert.equal(hunk.left, "ours\n");
  assert.equal(hunk.right, "theirs\n");
  assert.equal(hunk.base, null);
  assert.equal(hunk.leftLabel, "HEAD");
  assert.equal(hunk.rightLabel, "main");
  assert.equal(MERGED.slice(hunk.from, hunk.to), "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n");
  assert.equal(parsed.markersRemain, true);
});

test("a custom marker size finds its own markers and treats git's default length as content", () => {
  const text = "a\n<<<<<<<<<< HEAD\nours\n<<<<<<< not a marker\n==========\ntheirs\n>>>>>>>>>> main\n";
  const ten = parseConflicts(text, 10);
  assert.equal(ten.hunks.length, 1);
  assert.equal(ten.hunks[0].left, "ours\n<<<<<<< not a marker\n");
  assert.equal(ten.hunks[0].right, "theirs\n");
  // Read with the default size, the same text holds one marker-like line but no complete hunk.
  const seven = parseConflicts(text, 7);
  assert.equal(seven.hunks.length, 0);
  assert.equal(seven.unterminated, 3);
});

test("nested-looking markers of another length stay content of the side they sit in", () => {
  const text = [
    "<<<<<<< HEAD",
    "<<<<<<<< inner ours",
    "x",
    "========",
    "y",
    ">>>>>>>> inner theirs",
    "=======",
    "theirs",
    ">>>>>>> feature",
    "",
  ].join("\n");
  const parsed = parseConflicts(text, 7);
  assert.equal(parsed.hunks.length, 1);
  assert.equal(parsed.hunks[0].left, "<<<<<<<< inner ours\nx\n========\ny\n>>>>>>>> inner theirs\n");
  assert.equal(parsed.hunks[0].right, "theirs\n");
  assert.equal(parsed.hunks[0].rightLabel, "feature");
});

test("a marker-like line with text glued to it is content, not a marker", () => {
  const parsed = parseConflicts("<<<<<<<HEAD\n=======x\n>>>>>>>main\n", 7);
  assert.deepEqual(parsed, { hunks: [], markersRemain: false, unterminated: null });
});

test("an unterminated hunk makes no hunk but still counts as markers remaining", () => {
  const text = "one\n<<<<<<< HEAD\nours\n=======\ntheirs\n";
  const parsed = parseConflicts(text, 7);
  assert.equal(parsed.hunks.length, 0);
  assert.equal(parsed.unterminated, 1);
  assert.equal(parsed.markersRemain, true);
});

test("an opening marker before any separator leaves the earlier one unterminated and starts the hunk", () => {
  const text = "<<<<<<< a\nstray\n<<<<<<< HEAD\nl\n=======\nr\n>>>>>>> b\n";
  const parsed = parseConflicts(text, 7);
  assert.equal(parsed.unterminated, 0);
  assert.equal(parsed.hunks.length, 1);
  assert.equal(parsed.hunks[0].line, 2);
  assert.equal(parsed.hunks[0].left, "l\n");
});

test("a diff3 hunk carries the base between its base marker and the separator", () => {
  const text = "<<<<<<< HEAD\nours\n||||||| base\nold\n=======\ntheirs\n>>>>>>> main\n";
  const [hunk] = parseConflicts(text, 7).hunks;
  assert.equal(hunk.left, "ours\n");
  assert.equal(hunk.base, "old\n");
  assert.equal(hunk.right, "theirs\n");
});

test("several hunks are found in order, with their lines, and an empty side is empty text", () => {
  const text = "<<<<<<< HEAD\n=======\nadded\n>>>>>>> main\nmid\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> main";
  const parsed = parseConflicts(text, 7);
  assert.deepEqual(
    parsed.hunks.map((h) => [h.line, h.left, h.right]),
    [
      [0, "", "added\n"],
      [5, "x\n", "y\n"],
    ]
  );
  assert.equal(parsed.hunks[1].to, text.length, "a close marker with no newline ends the text");
});

test("a resolved text has no hunks and no markers", () => {
  assert.deepEqual(parseConflicts("one\nours and theirs\nthree\n", 7), { hunks: [], markersRemain: false, unterminated: null });
});

test("taking left, right or both replaces the hunk with that text, left before right for both", () => {
  const text = "one\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\nthree\n";
  const [hunk] = parseConflicts(text, 7).hunks;
  assert.equal(takeHunk(text, hunk, "left"), "one\nours\nthree\n");
  assert.equal(takeHunk(text, hunk, "right"), "one\ntheirs\nthree\n");
  assert.equal(takeHunk(text, hunk, "both"), "one\nours\ntheirs\nthree\n");
});

test("the navigator counts the hunks left, and says when none are", () => {
  assert.equal(unresolvedLabel(parseConflicts(MERGED, 7)), "1 unresolved");
  assert.equal(unresolvedLabel(parseConflicts(MERGED + MERGED, 7)), "2 unresolved");
  assert.equal(unresolvedLabel(parseConflicts("done\n", 7)), "No conflicts left");
  assert.equal(unresolvedLabel(parseConflicts("<<<<<<< HEAD\nx\n", 7)), "Unterminated conflict at line 1");
});

test("Mark resolved confirms only while markers remain", () => {
  assert.equal(confirmMarkResolved("a.txt", parseConflicts("done\n", 7)), null);
  const ask = confirmMarkResolved("a.txt", parseConflicts(MERGED + MERGED, 7));
  assert.equal(ask?.confirmLabel, "Mark resolved anyway");
  assert.match(ask?.detail ?? "", /a\.txt still has 2 conflicts/);
  const stray = confirmMarkResolved("a.txt", parseConflicts("x\n=======\n", 7));
  assert.match(stray?.detail ?? "", /conflict markers/);
});

test("Reset file and taking a whole side say what they throw away", () => {
  const reset = confirmReset("src/a.txt", true);
  assert.equal(reset.title, "Reset src/a.txt?");
  assert.match(reset.detail, /git checkout -m/);
  assert.match(reset.detail, /unsaved edits/);
  assert.match(reset.detail, /Recently discarded/);
  assert.doesNotMatch(confirmReset("src/a.txt", false).detail, /unsaved/);
  const take = confirmTakeSide("src/a.txt", { role: "Incoming", name: "feature" });
  assert.equal(take.title, "Keep Incoming · feature for all of src/a.txt?");
  assert.equal(take.confirmLabel, "Keep Incoming · feature");
  assert.match(take.detail, /stages it/);
});

test("a stale write says the file changed outside and that nothing was written", () => {
  const stale = resolverFailure({ kind: "conflictStale" }, "a.txt");
  assert.equal(stale.stale, true);
  assert.match(stale.message, /a\.txt changed since it was opened/);
  assert.match(stale.message, /nothing was written/i);
  assert.deepEqual(resolverFailure({ kind: "other", stderr: "boom" }, "a.txt"), { stale: false, message: "boom" });
  assert.equal(resolverFailure({ kind: "stagingBusy" }, "a.txt").stale, false);
});

test("the panes are labelled by role and real ref, with ours and theirs only in the tooltips", () => {
  const rebase: OpState = {
    kind: "rebase",
    step: 1,
    total: 2,
    leftLabel: { role: "Onto", name: "main @abc1234" },
    rightLabel: { role: "Replaying", name: "Fix it" },
    message: null,
    conflicts: [],
    conflictsTotal: 1,
  };
  const labels = paneLabels(rebase);
  assert.deepEqual([labels.left.text, labels.right.text], ["Onto · main @abc1234", "Replaying · Fix it"]);
  assert.doesNotMatch(`${labels.left.text} ${labels.right.text}`, /ours|theirs/i);
  assert.match(labels.left.tooltip, /“ours”/);
  assert.match(labels.right.tooltip, /“theirs”/);

  const none: OpState = { kind: "none", leftLabel: null, rightLabel: null, message: null, conflicts: [], conflictsTotal: 1 };
  const plain = paneLabels(none);
  assert.deepEqual([plain.left.text, plain.right.text], ["Left side", "Right side"]);
  assert.match(plain.right.tooltip, /“theirs”/);
});
