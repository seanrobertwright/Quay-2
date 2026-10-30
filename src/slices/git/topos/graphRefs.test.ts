/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgesByOid, tagOnlyLine, type GitRefs } from "./graphRefs.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);

const refs: GitRefs = {
  refs: [
    { kind: "tag", name: "v1", oid: A },
    { kind: "remote", name: "origin/main", oid: A },
    { kind: "local", name: "main", oid: A },
    { kind: "local", name: "feat", oid: B },
  ],
  worktrees: [
    { path: "C:/src/repo", oid: A, branch: "main" },
    { path: "C:/src/repo-feat", oid: B, branch: "feat" },
    { path: "C:/src/repo-spike", oid: A, branch: null },
  ],
  tagOnlyCount: 0,
};

test("each commit's badges put the worktree HEADs first, then local, remote and tag refs", () => {
  const badges = badgesByOid(refs, "C:/src/repo");
  assert.deepEqual(badges.get(A), [
    { kind: "head", name: "repo", path: "C:/src/repo", current: true },
    { kind: "head", name: "repo-spike", path: "C:/src/repo-spike", current: false },
    { kind: "local", name: "main" },
    { kind: "remote", name: "origin/main" },
    { kind: "tag", name: "v1" },
  ]);
  assert.deepEqual(badges.get(B), [
    { kind: "head", name: "repo-feat", path: "C:/src/repo-feat", current: false },
    { kind: "local", name: "feat" },
  ]);
});

test("selecting another worktree, however its path is spelled, moves only the current mark", () => {
  const badges = badgesByOid(refs, "c:\\src\\repo-feat\\");
  assert.deepEqual(badges.get(B), [
    { kind: "head", name: "repo-feat", path: "C:/src/repo-feat", current: true },
    { kind: "local", name: "feat" },
  ]);
  assert.deepEqual(
    badges.get(A)?.filter((b) => b.kind === "head"),
    [
      { kind: "head", name: "repo", path: "C:/src/repo", current: false },
      { kind: "head", name: "repo-spike", path: "C:/src/repo-spike", current: false },
    ]
  );
});

test("the footer counts tag-only commits only when there are some", () => {
  assert.equal(tagOnlyLine(0), null);
  assert.equal(tagOnlyLine(1), "1 tagged commit is on no branch");
  assert.equal(tagOnlyLine(30), "30 tagged commits are on no branch");
});
