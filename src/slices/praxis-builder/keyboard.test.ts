/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GO_TO_LIMIT,
  matchNodes,
  nodeAriaLabel,
  nudgeOffset,
  nudgeStep,
  positionBelow,
  tabTarget,
  BELOW_GAP,
} from "./keyboard.ts";
import { NUDGE_WINDOW_MS } from "./history.ts";
import type { PraxisNode } from "./model.ts";

const node = (id: string, kind: string, dependsOn: string[] = [], config: Record<string, unknown> = {}): PraxisNode =>
  ({ id, kind, dependsOn, config }) as PraxisNode;

test("a node's label names its kind, id, summary, dependencies and problems", () => {
  const n = node("review", "APPROVAL", ["build", "test"]);
  assert.match(nodeAriaLabel(n, { count: 1, severity: "error" }), /^APPROVAL review, .+, depends on 2, 1 problem$/);
  assert.equal(nodeAriaLabel(node("end", "OTHER"), undefined), "OTHER end, no settings, depends on 0, 0 problems");
  assert.equal(nodeAriaLabel(node("x", ""), { count: 3, severity: "info" }), "No kind x, no settings, depends on 0, 3 problems");
});

test("arrow keys nudge 8 px, or 40 px with Shift, and other keys don't", () => {
  assert.deepEqual(nudgeOffset("ArrowLeft", false), { x: -8, y: 0 });
  assert.deepEqual(nudgeOffset("ArrowRight", true), { x: 40, y: 0 });
  assert.deepEqual(nudgeOffset("ArrowUp", false), { x: 0, y: -8 });
  assert.deepEqual(nudgeOffset("ArrowDown", true), { x: 0, y: 40 });
  assert.equal(nudgeOffset("Enter", false), null);
});

test("nudges of one selection merge within the window; another selection is another step", () => {
  const a = nudgeStep(["b", "a"]);
  assert.deepEqual(a.merge, { key: nudgeStep(["a", "b"]).merge!.key, windowMs: NUDGE_WINDOW_MS });
  assert.notEqual(a.merge!.key, nudgeStep(["a"]).merge!.key);
  assert.equal(nudgeStep(["a"]).label, "Move a");
  assert.equal(nudgeStep(["a", "b"]).label, "Move 2 nodes");
  // Ids may hold any character, so a separator in one id can't fake another selection.
  assert.notEqual(nudgeStep(["a|b"]).merge!.key, nudgeStep(["a", "b"]).merge!.key);
});

test("Go to node matches id or kind, ignoring case, in file order, and caps the list", () => {
  const nodes = [node("build", "TASK"), node("Review", "APPROVAL"), node("ship", "TASK")];
  const ids = (q: string) => matchNodes(nodes, q).matches.map((n) => n.id);
  assert.deepEqual(ids(""), ["build", "Review", "ship"]);
  assert.deepEqual(ids("task"), ["build", "ship"]);
  assert.deepEqual(ids("  rev "), ["Review"]);
  assert.deepEqual(ids("approval"), ["Review"]);
  assert.deepEqual(matchNodes(nodes, "nothing"), { matches: [], more: false });
  const many = Array.from({ length: GO_TO_LIMIT + 5 }, (_, i) => node(`task-${i}`, "TASK"));
  assert.equal(matchNodes(many, "task").matches.length, GO_TO_LIMIT);
  assert.equal(matchNodes(many, "task").more, true);
  // Exactly the limit is every match, so nothing more is hinted at.
  assert.deepEqual(matchNodes(many.slice(0, GO_TO_LIMIT), "task").more, false);
});

test("a node added below another sits under it, a gap below its bottom edge", () => {
  const above = { x: 10, y: 20, width: 200, height: 64 };
  assert.deepEqual(positionBelow(above, [], { width: 200, height: 64 }), { x: 10, y: 20 + 64 + BELOW_GAP });
});

test("a spot below that a card already takes moves right, past each card in the way", () => {
  const size = { width: 200, height: 64 };
  const above = { x: 0, y: 0, ...size };
  const y = 64 + BELOW_GAP;
  const child = { x: 0, y: y + 20, ...size };
  const second = { x: 200 + BELOW_GAP, y, ...size };
  assert.deepEqual(positionBelow(above, [above, child], size), { x: 200 + BELOW_GAP, y });
  assert.deepEqual(positionBelow(above, [above, child, second], size), { x: 2 * (200 + BELOW_GAP), y });
  // A card that only touches the spot's edge leaves it free.
  assert.deepEqual(positionBelow(above, [{ x: 200, y, ...size }], size), { x: 0, y });
});

test("Tab runs through the nodes, then the edges, then on to what follows the last node", () => {
  // The tab stops in document order: the edges aren't among them.
  const stops = ["header", "n1", "n2", "palette"];
  const edges = ["e1", "e2"];
  const next = (at: string, back = false) => tabTarget(stops, "n2", edges, at, back);
  assert.equal(next("n2"), "e1");
  assert.equal(next("e1"), "e2");
  assert.equal(next("e2"), "palette");
  assert.equal(next("palette", true), "e2");
  assert.equal(next("e2", true), "e1");
  assert.equal(next("e1", true), "n2");
  // Everywhere else Tab is the browser's, or the focus trap's.
  assert.equal(next("n1"), null);
  assert.equal(next("n2", true), null);
  assert.equal(next("header"), null);
  assert.equal(next("palette"), null);
});

test("Tab off the last edge wraps to the first stop when the last node ends the stops", () => {
  assert.equal(tabTarget(["n1"], "n1", ["e1"], "e1", false), "n1");
  assert.equal(tabTarget(["n1"], "n1", ["e1"], "n1", true), "e1");
});

test("with no edges, or no nodes, Tab is left alone", () => {
  assert.equal(tabTarget(["n1", "palette"], "n1", [], "n1", false), null);
  assert.equal(tabTarget(["palette"], null, ["e1"], "palette", true), null);
});
