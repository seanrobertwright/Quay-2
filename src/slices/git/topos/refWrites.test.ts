/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deleteBranchPrompt,
  deletedToast,
  deleteTagPrompt,
  notFullyMergedOf,
  notMergedPrompt,
  renameRefusal,
  restoreFailure,
  tagRequest,
  upstreamChoices,
} from "./refWrites.ts";
import { RESTORE_MS } from "./toasts.ts";
import { parseGitError } from "./gitVersion.ts";
import { refFailure } from "./refActions.ts";

const TIP = "0123456789abcdef0123456789abcdef01234567";

test("deleting a branch always asks first, and names it as plain text", () => {
  assert.deepEqual(deleteBranchPrompt("<img src=x>"), {
    title: "Delete branch",
    detail: "Deletes the local branch <img src=x>. Its remote branch, if any, stays.",
    confirmLabel: "Delete",
  });
});

test("an unmerged branch's second dialog names its unique commit count and tip, and offers Delete anyway", () => {
  assert.deepEqual(notMergedPrompt("spike", 2, TIP), {
    title: "spike isn't fully merged",
    detail: "2 commits up to 0123456 are on no other branch, tag or HEAD. Deleting anyway leaves them only in the Restore toast and the reflog.",
    confirmLabel: "Delete anyway",
  });
  assert.equal(notMergedPrompt("spike", 1, TIP).detail.slice(0, 22), "1 commit up to 0123456");
});

test("only a NotFullyMerged refusal leads to the second dialog", () => {
  assert.deepEqual(notFullyMergedOf({ kind: "notFullyMerged", ahead: 3, tip: TIP }), { ahead: 3, tip: TIP });
  assert.equal(notFullyMergedOf({ kind: "notFullyMerged", ahead: -1, tip: TIP }), null, "a count that isn't one is no refusal");
  assert.equal(notFullyMergedOf({ kind: "refLocked" }), null);
  assert.equal(notFullyMergedOf("boom"), null);
});

test("every delete is followed by a 10 s toast offering Restore at the deleted tip", () => {
  assert.equal(RESTORE_MS, 10_000);
  assert.deepEqual(deletedToast("spike", TIP), { text: "Deleted spike (was 0123456)", actionLabel: "Restore", ttlMs: RESTORE_MS });
});

test("Restore over a branch made since says so and changes nothing", () => {
  assert.equal(
    restoreFailure("spike", { kind: "refExists", name: "spike" }),
    "A branch named spike exists again, so Restore left it alone"
  );
  assert.equal(restoreFailure("spike", { kind: "other", stderr: "fatal: boom" }), "Couldn't restore spike: fatal: boom");
});

test("deleting a tag asks first and says it stays on any remote", () => {
  assert.deepEqual(deleteTagPrompt("v1"), {
    title: "Delete tag",
    detail: "Deletes the local tag v1. A tag of that name on a remote stays.",
    confirmLabel: "Delete tag",
  });
});

test("a tag needs a name, and a blank message makes it lightweight", () => {
  assert.deepEqual(tagRequest("  ", "msg"), { refused: "Name the tag" });
  assert.deepEqual(tagRequest(" v1 ", ""), { name: "v1", message: null });
  assert.deepEqual(tagRequest("v1", "  \n "), { name: "v1", message: null });
  assert.deepEqual(tagRequest("v1", "Release 1\n\nNotes"), { name: "v1", message: "Release 1\n\nNotes" });
});

test("a rename needs a new name", () => {
  assert.equal(renameRefusal("side", " "), "Name the branch");
  assert.equal(renameRefusal("side", "side"), "That is its name already");
  assert.equal(renameRefusal("side", "topic"), null);
});

test("Set upstream offers remote branches, then other local branches, then no upstream", () => {
  const A = "a".repeat(40);
  const refs = {
    refs: [
      { kind: "local" as const, name: "side", oid: A },
      { kind: "local" as const, name: "main", oid: A },
      { kind: "remote" as const, name: "origin/main", oid: A },
      { kind: "tag" as const, name: "v1", oid: A },
    ],
    worktrees: [],
    tagOnlyCount: 0,
  };
  const choices = upstreamChoices(refs, "side");
  assert.deepEqual(
    choices.map((c) => [c.label, c.upstream]),
    [
      ["origin/main", "origin/main"],
      ["main (local)", "main"],
      ["No upstream", null],
    ]
  );
  assert.equal(new Set(choices.map((c) => c.value)).size, choices.length, "values are distinct");
});

test("the new refusals parse and read in a toast", () => {
  assert.deepEqual(parseGitError({ kind: "notFullyMerged", ahead: 2, tip: TIP }), { kind: "notFullyMerged", ahead: 2, tip: TIP });
  assert.deepEqual(parseGitError({ kind: "refExists", name: "v1" }), { kind: "refExists", name: "v1" });
  assert.deepEqual(parseGitError({ kind: "refLocked" }), { kind: "refLocked" });
  assert.equal(refFailure("v1", { kind: "refExists", name: "v1" }).text, "v1 already exists");
  assert.equal(
    refFailure("side", { kind: "refLocked" }).text,
    "Another git process holds a lock on side; try again once it's done"
  );
});
