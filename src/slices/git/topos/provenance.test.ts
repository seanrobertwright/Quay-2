/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { authorLine, liveAgentsAt, nodeLabel, nodeTooltip, splitAgents } from "./provenance.ts";

test("a node is labelled with who made the commit and how Quay knows", () => {
  assert.equal(nodeLabel({ kind: "codex", source: "stamp" }, "Ann"), "Commit by codex (Quay stamp)");
  assert.equal(nodeLabel({ kind: "claude", source: "coauthor" }, "Ann"), "Commit by claude (co-author)");
  assert.equal(nodeLabel({ kind: null, source: "stamp", raw: "robot" }, "Ann"), "Commit by an unknown agent (Quay stamp)");
  assert.equal(nodeLabel(null, "Ann"), "Commit by Ann");
});

test("the tooltip opens with the label and adds an unknown stamp's value, and only that", () => {
  assert.deepEqual(nodeTooltip({ kind: "codex", source: "stamp" }, "Ann"), ["Commit by codex (Quay stamp)"]);
  assert.deepEqual(nodeTooltip({ kind: null, source: "stamp", raw: "<b>robot</b>" }, "Ann"), [
    "Commit by an unknown agent (Quay stamp)",
    "Quay-Agent: <b>robot</b>",
  ]);
  assert.deepEqual(nodeTooltip(null, "Ann"), ["Commit by Ann"]);
});

test("the author column adds the agent to the human author", () => {
  assert.equal(authorLine("Sean Wright", { kind: "codex", source: "stamp" }), "Sean Wright + codex");
  assert.equal(authorLine("Sean Wright", { kind: null, source: "stamp", raw: "robot" }), "Sean Wright + unknown agent");
  assert.equal(authorLine("Sean Wright", null), "Sean Wright");
});

const terminal = (run_kind: string, project_path: string, claude_status = "idle", exit_code: number | null = null) =>
  ({ run_kind, project_path, claude_status, exit_code }) as Parameters<typeof liveAgentsAt>[0][number];

test("a worktree's live agents are its running agent terminals, not shells or exited ones", () => {
  const terminals = [
    terminal("claude", "C:\\src\\repo-feat\\"),
    terminal("powershell", "C:/src/repo-feat"),
    terminal("codex", "C:/src/repo-feat", "exited", 0),
    terminal("pig", "c:/src/repo-feat"),
    terminal("codex", "C:/src/repo"),
  ];
  assert.deepEqual(liveAgentsAt(terminals, "C:/src/repo-feat"), ["claude", "pig"]);
  assert.deepEqual(liveAgentsAt(terminals, "C:/src/other"), []);
});

test("at most three agent icons show, then a count of the rest", () => {
  assert.deepEqual(splitAgents(["claude", "codex"]), { shown: ["claude", "codex"], more: 0 });
  assert.deepEqual(splitAgents(["claude", "codex", "pig", "pi", "kiro"]), { shown: ["claude", "codex", "pig"], more: 2 });
});
