/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { conflictCard } from "./conflictCards.ts";
import type { ConflictFile } from "./useConflictResolver.ts";
import type { Conflict } from "./operation.ts";

const NAMES = { left: "HEAD · feat", right: "Incoming · main" };

/** A conflicted file as `git_conflict_open` returns one, not editable as text unless overridden. */
function file(overrides: Partial<ConflictFile>): ConflictFile {
  return {
    path: "notes.txt",
    xy: "UU",
    onDisk: true,
    leftOid: "1111111111111111111111111111111111111111",
    rightOid: "2222222222222222222222222222222222222222",
    token: "t",
    editable: false,
    reason: null,
    left: null,
    right: null,
    result: null,
    eol: "lf",
    bom: false,
    markerSize: 7,
    ...overrides,
  };
}

test("a file changed on the left and deleted on the right offers Keep modified or Accept deletion", () => {
  const card = conflictCard(file({ xy: "UD", reason: "oneSideMissing", rightOid: null }), NAMES, []);
  assert.ok(card);
  assert.equal(card.reason, "HEAD · feat changed notes.txt and Incoming · main deleted it.");
  assert.deepEqual(
    card.choices.map((c) => [c.label, c.action]),
    [
      ["Keep modified", { kind: "stage" }],
      ["Accept deletion", { kind: "remove" }],
    ]
  );
  const [keep, accept] = card.choices;
  assert.match(keep.effect, /stages notes\.txt as the worktree holds it \(git add\)/i);
  assert.match(keep.effect, /worktree file stays as it is/i);
  assert.equal(keep.confirm, null, "keeping drops nothing");
  assert.match(accept.effect, /removes notes\.txt from the index and deletes it from the worktree \(git rm\)/i);
  assert.ok(accept.confirm, "accepting the deletion drops the changed file, so it confirms");
  assert.match(accept.confirm.detail, /backed up/);
});

test("keeping a changed file the worktree lost writes the changed side back, and accepting the deletion asks nothing", () => {
  const card = conflictCard(file({ xy: "DU", reason: "noWorktreeFile", onDisk: false, leftOid: null }), NAMES, []);
  assert.ok(card);
  assert.equal(card.reason, "Incoming · main changed notes.txt and HEAD · feat deleted it.");
  const [keep, accept] = card.choices;
  assert.deepEqual(keep.action, { kind: "takeSide", side: "right" });
  assert.match(keep.effect, /writes Incoming · main's version of notes\.txt to the worktree/i);
  assert.deepEqual(accept.action, { kind: "remove" });
  assert.match(accept.effect, /no file there to delete/);
  assert.equal(accept.confirm, null, "nothing on disk is lost");
});

test("a file only one side added offers Keep or Remove", () => {
  for (const [xy, adder, side] of [
    ["AU", "HEAD · feat", "left"],
    ["UA", "Incoming · main", "right"],
  ] as const) {
    const card = conflictCard(file({ xy, reason: "oneSideMissing" }), NAMES, []);
    assert.ok(card, xy);
    assert.equal(card.reason, `Only ${adder} added notes.txt.`);
    assert.deepEqual(
      card.choices.map((c) => [c.label, c.action.kind]),
      [
        ["Keep", "stage"],
        ["Remove", "remove"],
      ]
    );
    assert.ok(card.choices[1].confirm, `${xy}: removing deletes the added file, so it confirms`);
    const lost = conflictCard(file({ xy, reason: "noWorktreeFile", onDisk: false }), NAMES, []);
    assert.deepEqual(lost?.choices[0].action, { kind: "takeSide", side });
  }
});

test("a file both sides deleted offers Remove alone and lists the files one side added, where a rename went", () => {
  const conflicts: Conflict[] = [
    { path: "a.txt", xy: "DD", kind: "bothDeleted" },
    { path: "left.txt", xy: "AU", kind: "addedByUs" },
    { path: "right.txt", xy: "UA", kind: "addedByThem" },
    { path: "other.txt", xy: "UU", kind: "bothModified" },
  ];
  const card = conflictCard(file({ path: "a.txt", xy: "DD", reason: "oneSideMissing", onDisk: false, leftOid: null, rightOid: null }), NAMES, conflicts);
  assert.ok(card);
  assert.equal(card.reason, "Both sides deleted a.txt, or renamed it to different names.");
  assert.deepEqual(card.details, ["left.txt, added only by HEAD · feat", "right.txt, added only by Incoming · main"]);
  assert.deepEqual(
    card.choices.map((c) => [c.label, c.action.kind, c.confirm]),
    [["Remove", "remove", null]]
  );
  assert.match(card.choices[0].effect, /removes a\.txt from the index \(git rm\)/i);
});

test("a rename's other paths are capped, with a count of the rest", () => {
  const added: Conflict[] = Array.from({ length: 12 }, (_, i) => ({ path: `new${i}.txt`, xy: "AU", kind: "addedByUs" }));
  const card = conflictCard(file({ path: "a.txt", xy: "DD", onDisk: false }), NAMES, added);
  assert.equal(card?.details.length, 6);
  assert.equal(card?.details[5], "and 7 more files one side added");
});

test("binary, symlink, too-large, non-UTF-8 and mixed-line-ending files offer to take one side, saying why", () => {
  const reasons = [
    ["binary", /binary data/],
    ["symlink", /symbolic link/],
    ["tooLarge", /larger than 1 MiB/],
    ["notUtf8", /isn't UTF-8 text/],
    ["mixedLineEndings", /mixes CRLF and LF line endings/],
  ] as const;
  for (const [reason, words] of reasons) {
    const card = conflictCard(file({ reason }), NAMES, []);
    assert.ok(card, reason);
    assert.match(card.reason, words, reason);
    assert.deepEqual(
      card.choices.map((c) => [c.label, c.action]),
      [
        ["Take HEAD · feat", { kind: "takeSide", side: "left" }],
        ["Take Incoming · main", { kind: "takeSide", side: "right" }],
      ],
      reason
    );
    const [left, right] = card.choices;
    assert.match(left.effect, /writes HEAD · feat's version of notes\.txt to the worktree \(git checkout --ours\) and stages it \(git add\)/i);
    assert.match(left.effect, /drops Incoming · main's version/);
    assert.match(right.effect, /git checkout --theirs/);
    assert.match(right.effect, /backed up first/);
    assert.ok(left.confirm && right.confirm, `${reason}: taking a side drops the other, so it confirms`);
    assert.equal(left.confirm.confirmLabel, "Take HEAD · feat");
  }
});

test("a file the resolver edits as text gets no card", () => {
  assert.equal(conflictCard(file({ editable: true, left: "a\n", right: "b\n", result: "m\n" }), NAMES, []), null);
});

test("a submodule shows both commits and offers only Open terminal and Hand to agent", () => {
  for (const f of [file({ path: "vendor/lib", reason: "submodule" }), file({ path: "vendor/lib", xy: "UD", reason: "submodule", rightOid: null })]) {
    const card = conflictCard(f, NAMES, []);
    assert.ok(card, f.xy);
    assert.match(card.reason, /resolve it inside the submodule/);
    assert.deepEqual(
      card.choices.map((c) => [c.label, c.action, c.confirm]),
      [
        ["Open terminal", { kind: "openTerminal" }, null],
        ["Hand to agent", { kind: "handToAgent" }, null],
      ],
      f.xy
    );
    assert.match(card.choices[0].effect, /changes nothing/i);
    assert.match(card.choices[1].effect, /changes nothing/i);
    assert.equal(card.details[0], "HEAD · feat: commit 1111111111111111111111111111111111111111");
  }
  const deleted = conflictCard(file({ path: "vendor/lib", xy: "UD", reason: "submodule", rightOid: null }), NAMES, []);
  assert.equal(deleted?.details[1], "Incoming · main: deleted");
});
