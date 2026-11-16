// Unit tests for the module bar's terminal status list (#633): the dot each terminal status
// takes, the rows in the Projects panel's order, and the cap that keeps urgent terminals shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TerminalInfo, ClaudeStatus } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import { capStatusRows, dotStatus, fitStatusRows, nextWaitingTerminal, statusListHeight, statusRows, type StatusRow } from "./terminalStatus.ts";

const term = (id: string, project_path: string, claude_status: ClaudeStatus = "idle"): TerminalInfo => ({
  id,
  name: id,
  project_path,
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status,
  auto_approved_count: 0,
});
const project = (path: string, name: string): Project => ({ path, name, terminal_ids: [] });
const worktree = (path: string, is_main = false): GitWorktree => ({
  path,
  head: "abc",
  branch: "refs/heads/x",
  is_main,
  is_bare: false,
  is_locked: false,
});

test("each terminal status takes one of four dots", () => {
  const cases: [ClaudeStatus, string][] = [
    ["working", "working"],
    ["starting", "working"],
    ["waiting", "waiting"],
    ["idle", "idle"],
    ["unknown", "idle"],
    ["exited", "exited"],
  ];
  for (const [status, dot] of cases) assert.equal(dotStatus(term("a", "C:/a", status)), dot, status);
});

test("rows follow the Projects panel: each project's terminals, then its worktrees', then other terminals", () => {
  const projects = [project("C:/alpha", "alpha"), project("C:/beta", "beta")];
  const worktrees = { "C:/alpha": [worktree("C:/alpha", true), worktree("C:/alpha/.wt/one")] };
  const terminals = [
    term("orphan", "D:/elsewhere"),
    term("b1", "C:/beta"),
    term("wt1", "C:/alpha/.wt/one"),
    term("a1", "C:/alpha"),
    term("nested", "C:/alpha/sub"),
    term("a2", "C:/alpha"),
  ];
  const rows = statusRows(terminals, projects, worktrees);
  assert.deepEqual(
    rows.map((r) => [r.terminal.id, r.projectName]),
    [
      ["a1", "alpha"],
      ["a2", "alpha"],
      ["wt1", "alpha"],
      ["nested", "alpha"],
      ["b1", "beta"],
      ["orphan", "Other Terminals"],
    ],
  );
  // Rows of one project share a group, so the list can put the gap between projects.
  assert.equal(new Set(rows.slice(0, 4).map((r) => r.group)).size, 1);
  assert.notEqual(rows[3].group, rows[4].group);
  assert.notEqual(rows[4].group, rows[5].group);
});

test("a project registered inside another keeps its own terminals", () => {
  const projects = [project("C:/alpha", "alpha"), project("C:/alpha/sub", "sub")];
  const terminals = [term("s1", "C:/alpha/sub"), term("a1", "C:/alpha"), term("deep", "C:/alpha/sub/x")];
  const rows = statusRows(terminals, projects, {});
  assert.deepEqual(
    rows.map((r) => [r.terminal.id, r.projectName]),
    [
      ["a1", "alpha"],
      ["s1", "sub"],
      ["deep", "sub"],
    ],
  );
});

const rowsOf = (statuses: ClaudeStatus[]): StatusRow[] =>
  statusRows(
    statuses.map((s, i) => term(`t${i}`, "C:/p", s)),
    [project("C:/p", "p")],
    {},
  );
const ids = (rows: StatusRow[]) => rows.map((r) => r.terminal.id);

test("at or below the cap every row shows in order and nothing is hidden", () => {
  const rows = rowsOf(["idle", "waiting", "working", "exited"]);
  assert.deepEqual(capStatusRows(rows, 4), { rows, hidden: 0 });
});

test("below the cap a status change never reorders the rows", () => {
  const before = capStatusRows(rowsOf(["idle", "idle", "idle"]), 12);
  const after = capStatusRows(rowsOf(["idle", "idle", "waiting"]), 12);
  assert.deepEqual(ids(before.rows), ids(after.rows));
});

test("past the cap waiting and exited terminals always get a row and the rest fill in order", () => {
  // Six terminals and a cap of four: three rows and the +N row. t4 waits and t5 exited.
  const capped = capStatusRows(rowsOf(["idle", "working", "idle", "idle", "waiting", "exited"]), 4);
  assert.deepEqual(ids(capped.rows), ["t0", "t4", "t5"]);
  assert.equal(capped.hidden, 3);
});

test("past the cap with more urgent terminals than rows, the first urgent ones show", () => {
  const capped = capStatusRows(rowsOf(["idle", "waiting", "exited", "waiting", "waiting"]), 3);
  assert.deepEqual(ids(capped.rows), ["t1", "t2"]);
  assert.equal(capped.hidden, 3);
});

test("the list is padding plus 24 px per row, the +N row included, plus 6 px per project gap", () => {
  const rows = [
    ...statusRows([term("a", "C:/p")], [project("C:/p", "p")], {}),
    ...statusRows([term("b", "C:/q")], [project("C:/q", "q")], {}),
  ];
  assert.equal(statusListHeight(rows, 0), 8 + 2 * 24 + 6);
  assert.equal(statusListHeight(rows, 3), 8 + 3 * 24 + 6);
});

test("a short window shows fewer rows, keeping waiting terminals, and never less than the +N row", () => {
  const rows = rowsOf(Array.from({ length: 20 }, (_, i) => (i === 19 ? "waiting" : "idle")));
  assert.equal(fitStatusRows(rows, null).rows.length, 11);
  const short = fitStatusRows(rows, 8 + 5 * 24);
  assert.equal(short.rows.length, 4);
  assert.equal(short.hidden, 16);
  assert.ok(ids(short.rows).includes("t19"));
  const none = fitStatusRows(rows, 0);
  assert.deepEqual(none, { rows: [], hidden: 20 });
});

test("a terminal with a permission request waiting shows the amber waiting dot whatever its status", () => {
  const terminals = [term("asks", "C:/a", "working"), term("quiet", "C:/a", "working")];
  const rows = statusRows(terminals, [project("C:/a", "A")], {}, new Set(["asks"]));
  assert.deepEqual(rows.map((r) => [r.terminal.id, r.status]), [
    ["asks", "waiting"],
    ["quiet", "working"],
  ]);
});

test("the next waiting terminal is the first waiting row after the selected one, wrapping, else none", () => {
  const terminals = [term("a", "C:/a", "waiting"), term("b", "C:/a", "idle"), term("c", "C:/a", "waiting"), term("d", "C:/a")];
  const rows = statusRows(terminals, [project("C:/a", "A")], {});
  assert.equal(nextWaitingTerminal(rows, null), "a");
  assert.equal(nextWaitingTerminal(rows, "a"), "c");
  assert.equal(nextWaitingTerminal(rows, "b"), "c");
  assert.equal(nextWaitingTerminal(rows, "c"), "a");
  assert.equal(nextWaitingTerminal(rows, "gone"), "a");
  assert.equal(nextWaitingTerminal(statusRows([term("x", "C:/a")], [project("C:/a", "A")], {}), null), null);
});
