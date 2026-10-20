/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRootRepo } from "./paths.ts";

const projects = [{ path: "E:\\Projects\\Quay2" }, { path: "E:\\Projects\\Other" }];

test("the root project resolves to itself", () => {
  assert.equal(resolveRootRepo("E:\\Projects\\Quay2", projects), "E:\\Projects\\Quay2");
});

test("a worktree inside the project folder resolves to the root project", () => {
  assert.equal(
    resolveRootRepo("E:/Projects/Quay2/.worktrees/feat-issue-63", projects),
    "E:\\Projects\\Quay2"
  );
});

test("a worktree outside the project folder resolves to the project that lists it", () => {
  const worktrees = {
    "E:\\Projects\\Quay2": [
      { path: "E:/Projects/Quay2" },
      { path: "C:/Users/dev/.archon/workspaces/quay/worktrees/feat/issue-86" },
    ],
  };
  assert.equal(
    resolveRootRepo(
      "C:\\Users\\dev\\.archon\\workspaces\\quay\\worktrees\\feat\\issue-86",
      projects,
      worktrees
    ),
    "E:\\Projects\\Quay2"
  );
});

test("a path that belongs to no project resolves to itself", () => {
  assert.equal(resolveRootRepo("D:\\scratch", projects, {}), "D:\\scratch");
});
