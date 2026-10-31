/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentScan, brightRows, highlightKindOf, highlightKinds, type AgentRows, type HighlightKind } from "./agentHighlight.ts";
import type { GraphAgent } from "./graphPage.ts";

const claude: GraphAgent = { kind: "claude", source: "stamp" };
const claudeByEmail: GraphAgent = { kind: "claude", source: "coauthor" };
const codex: GraphAgent = { kind: "codex", source: "stamp" };
const unknown: GraphAgent = { kind: null, source: "stamp" };

// Rows 0..7: human, claude, codex, human, claude (co-author), unknown stamp, codex, human.
const AGENTS: (GraphAgent | null)[] = [null, claude, codex, null, claudeByEmail, unknown, codex, null];

function rowsOf(agents: (GraphAgent | null)[]): AgentRows {
  return { rowCount: agents.length, agent: (r) => agents[r] };
}

function scanAll(kinds: readonly HighlightKind[], agents = AGENTS): number[] {
  const scan = new AgentScan(kinds);
  assert.equal(scan.scan(rowsOf(agents), 1_000), true);
  return [...scan.matches];
}

test("a commit's highlight kind is human, its agent's run kind, or unknown", () => {
  assert.equal(highlightKindOf(null), "human");
  assert.equal(highlightKindOf(claudeByEmail), "claude");
  assert.equal(highlightKindOf(unknown), "unknown");
});

test("the scan finds the rows of every highlighted kind, ascending", () => {
  assert.deepEqual(scanAll(["claude"]), [1, 4]);
  assert.deepEqual(scanAll(["human", "codex"]), [0, 2, 3, 6, 7]);
  assert.deepEqual(scanAll(["unknown"]), [5]);
  assert.deepEqual(scanAll(["gemini"]), []);
});

test("the scan carries on over rows loaded since, in chunks", () => {
  const scan = new AgentScan(["claude"]);
  assert.equal(scan.scan(rowsOf(AGENTS.slice(0, 3)), 2), false);
  assert.deepEqual([...scan.matches], [1]);
  assert.equal(scan.scan(rowsOf(AGENTS.slice(0, 3)), 2), true);
  assert.equal(scan.scan(rowsOf(AGENTS), 100), true);
  assert.deepEqual([...scan.matches], [1, 4]);
});

test("the kinds offered are human, then each agent kind the rows hold, without repeats", () => {
  assert.deepEqual(highlightKinds([null, claude, codex, claudeByEmail, unknown]), ["human", "claude", "codex", "unknown"]);
  assert.deepEqual(highlightKinds([null]), ["human"]);
});

test("with only one of Find and the agent highlight active, its rows are the bright ones", () => {
  const find = { active: true, matches: Int32Array.from([1, 2, 5]) };
  const off = { active: false, matches: new Int32Array(0) };
  const agents = { active: true, matches: Int32Array.from([1, 4]) };
  assert.deepEqual(brightRows(find, off), { active: true, matches: find.matches });
  assert.deepEqual(brightRows(off, agents), { active: true, matches: agents.matches });
  assert.equal(brightRows(off, off).active, false);
});

test("with both active, a row stays bright only when it matches both", () => {
  const find = { active: true, matches: Int32Array.from([0, 1, 2, 4, 9, 12]) };
  const agents = { active: true, matches: Int32Array.from([1, 3, 4, 5, 12, 40]) };
  const both = brightRows(find, agents);
  assert.equal(both.active, true);
  assert.deepEqual([...both.matches], [1, 4, 12]);
  // A highlight with no matching row leaves nothing bright, not everything.
  const none = brightRows(find, { active: true, matches: new Int32Array(0) });
  assert.deepEqual([none.active, none.matches.length], [true, 0]);
});
