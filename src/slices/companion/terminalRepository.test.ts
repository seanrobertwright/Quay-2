// Unit tests for the repository the companion's Repository view shows (#636): the selected
// terminal's project, its working folder and branch, from what Quay already holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TerminalInfo } from "../terminal/types.ts";
import type { GitWorktree } from "../git/types.ts";
import { terminalRepository } from "./terminalRepository.ts";

const terminal = (project_path: string): TerminalInfo => ({
  id: "t1",
  name: "claude",
  project_path,
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "idle",
  auto_approved_count: 0,
});
const wt = (path: string, branch: string, is_main = false): GitWorktree => ({
  path,
  head: "abc1234",
  branch,
  is_main,
  is_bare: false,
  is_locked: false,
});
const projects = [{ path: "E:/Projects/Quay2", name: "Quay", terminal_ids: [] }];
const worktrees = {
  "E:/Projects/Quay2": [wt("E:/Projects/Quay2", "master", true), wt("E:/Projects/Quay2/.wt/ticket-636", "ticket-636")],
};

test("a terminal in a project's own folder shows the project and its checked-out branch", () => {
  assert.deepEqual(terminalRepository(terminal("e:\\Projects\\Quay2"), projects, worktrees), {
    name: "Quay",
    path: "E:/Projects/Quay2",
    workingFolder: "e:\\Projects\\Quay2",
    worktree: false,
    branch: "master",
  });
});

test("a terminal in a worktree shows its project, the worktree folder and the worktree's branch", () => {
  assert.deepEqual(terminalRepository(terminal("E:/Projects/Quay2/.wt/ticket-636"), projects, worktrees), {
    name: "Quay",
    path: "E:/Projects/Quay2",
    workingFolder: "E:/Projects/Quay2/.wt/ticket-636",
    worktree: true,
    branch: "ticket-636",
  });
});

test("a terminal in no project is named for its folder, with no branch Quay knows of", () => {
  assert.deepEqual(terminalRepository(terminal("C:/scratch/tools/"), projects, worktrees), {
    name: "tools",
    path: "C:/scratch/tools/",
    workingFolder: "C:/scratch/tools/",
    worktree: false,
    branch: null,
  });
});
