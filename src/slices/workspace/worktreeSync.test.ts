/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areWorktreesEqual,
  shouldRefreshWorktreesForTerminal,
  findProjectsNeedingWorktreeRefresh,
} from "./worktreeSync.ts";

test("areWorktreesEqual returns true for identical worktrees", () => {
  const w1 = [
    { path: "E:/repo/main", head: "abc", branch: "main", is_main: true, is_bare: false, is_locked: false },
    { path: "E:/repo/feat", head: "def", branch: "feat", is_main: false, is_bare: false, is_locked: false },
  ];
  const w2 = [
    { path: "E:\\repo\\main", head: "abc", branch: "main", is_main: true, is_bare: false, is_locked: false },
    { path: "E:\\repo\\feat", head: "def", branch: "feat", is_main: false, is_bare: false, is_locked: false },
  ];

  assert.equal(areWorktreesEqual(w1, w2), true);
});

test("areWorktreesEqual returns false when worktree count, branch, or head differs", () => {
  const w1 = [
    { path: "E:/repo/main", head: "abc", branch: "main", is_main: true, is_bare: false, is_locked: false },
  ];
  const w2 = [
    { path: "E:/repo/main", head: "abc", branch: "main", is_main: true, is_bare: false, is_locked: false },
    { path: "E:/repo/feat", head: "def", branch: "feat", is_main: false, is_bare: false, is_locked: false },
  ];
  const w3 = [
    { path: "E:/repo/main", head: "xyz", branch: "main", is_main: true, is_bare: false, is_locked: false },
  ];

  assert.equal(areWorktreesEqual(w1, w2), false);
  assert.equal(areWorktreesEqual(w1, w3), false);
  assert.equal(areWorktreesEqual(undefined, undefined), true);
  assert.equal(areWorktreesEqual(w1, undefined), false);
});

test("shouldRefreshWorktreesForTerminal returns true for an unknown worktree subpath", () => {
  const project = "E:/repo";
  const known = [{ path: "E:/repo" }];
  const checked = new Set<string>();

  // A terminal opened in a new worktree subpath
  assert.equal(
    shouldRefreshWorktreesForTerminal("E:/repo/.worktrees/ticket-1", project, known, checked),
    true
  );
});

test("shouldRefreshWorktreesForTerminal returns false for root project or known worktree", () => {
  const project = "E:/repo";
  const known = [{ path: "E:/repo" }, { path: "E:/repo/.worktrees/ticket-1" }];
  const checked = new Set<string>();

  // Same as root project
  assert.equal(shouldRefreshWorktreesForTerminal("E:/repo", project, known, checked), false);
  // Already in known worktrees
  assert.equal(
    shouldRefreshWorktreesForTerminal("E:/repo/.worktrees/ticket-1", project, known, checked),
    false
  );
  // Not inside project
  assert.equal(
    shouldRefreshWorktreesForTerminal("E:/other-project", project, known, checked),
    false
  );
});

test("shouldRefreshWorktreesForTerminal returns false once a subpath is already in checkedPaths", () => {
  const project = "E:/repo";
  const known = [{ path: "E:/repo" }];
  const checked = new Set<string>(["E:/repo/.worktrees/deleted-branch"]);

  // Even though it's not in known worktrees, it was already checked and should not trigger repeatedly
  assert.equal(
    shouldRefreshWorktreesForTerminal("E:/repo/.worktrees/deleted-branch", project, known, checked),
    false
  );
});

test("findProjectsNeedingWorktreeRefresh identifies projects and records checked paths to prevent loops", () => {
  const projects = [{ path: "E:/repo" }, { path: "E:/other" }];
  const terminals = [
    { project_path: "E:/repo" },
    { project_path: "E:/repo/subfolder" },
    { project_path: "E:/repo/.worktrees/wt-1" },
  ];
  const projectWorktrees = {
    "E:/repo": [{ path: "E:/repo" }],
    "E:/other": [{ path: "E:/other" }],
  };
  const checkedPaths = new Set<string>();

  const needingRefresh = findProjectsNeedingWorktreeRefresh(
    projects,
    terminals,
    projectWorktrees,
    checkedPaths
  );

  assert.deepEqual(needingRefresh, ["E:/repo"]);
  // Both subfolder and wt-1 must be recorded in checkedPaths
  assert.equal(checkedPaths.has("E:/repo/subfolder"), true);
  assert.equal(checkedPaths.has("E:/repo/.worktrees/wt-1"), true);

  // Calling it a second time with the updated checkedPaths returns NO projects needing refresh (breaks the loop!)
  const secondRun = findProjectsNeedingWorktreeRefresh(
    projects,
    terminals,
    projectWorktrees,
    checkedPaths
  );
  assert.deepEqual(secondRun, []);
});
