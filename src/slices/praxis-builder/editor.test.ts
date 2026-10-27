/// <reference types="node" />
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createGraphDraft, isDirty, type GraphDraft } from "./drafts.ts";
import { editDraft, nextNodeId, renameProblem, stepFor } from "./editor.ts";
import { MAX_NODES, type JsonObject } from "./model.ts";

const ref = { kind: "graphs" as const, id: "ship" };

function draftOf(nodes: JsonObject[], positions: Record<string, { x: number; y: number }> = {}): GraphDraft {
  const layoutNodes: JsonObject = {};
  for (const n of nodes) layoutNodes[n.id as string] = positions[n.id as string] ?? { x: 0, y: 0 };
  const result = createGraphDraft(ref, {
    id: "ship",
    kind: "graphs",
    missing: false,
    contentHash: "hash-1",
    content: { id: "ship", revision: "sha256:aaaa", nodes },
    layout: { version: 1, nodes: layoutNodes },
  });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

const node = (id: string, kind: string, dependsOn: string[] = [], config: JsonObject = {}): JsonObject => ({
  id,
  kind,
  dependsOn,
  config,
});

const nodesOf = (d: GraphDraft) => d.content.nodes as JsonObject[];
const ids = (d: GraphDraft) => nodesOf(d).map((n) => n.id as string);
const find = (d: GraphDraft, id: string) => nodesOf(d).find((n) => n.id === id);

const decisionGraph = () =>
  draftOf([
    node("check", "DECISION", [], { field: "passed", equals: true, then: "", else: "" }),
    node("ok", "TASK", [], { executionKind: "AGENT" }),
    node("fail", "TASK", [], { executionKind: "AGENT" }),
    node("end", "END", ["ok", "fail"]),
  ]);

describe("nextNodeId", () => {
  test("is the kind in lower case with the smallest free number", () => {
    const d = draftOf([node("task-1", "TASK"), node("task-3", "TASK"), node("end", "END")]);
    assert.equal(nextNodeId(ids(d), "TASK"), "task-2");
    assert.equal(nextNodeId(ids(d), "END"), "end-1");
    assert.equal(nextNodeId(ids(d), "SUBWORKFLOW"), "subworkflow-1");
  });

  test("treats ids as case-sensitive, as the SDK does", () => {
    const d = draftOf([node("Task-1", "TASK")]);
    assert.equal(nextNodeId(ids(d), "TASK"), "task-1");
  });
});

describe("add-node", () => {
  test("adds a node of the kind with its default config at the rounded position", () => {
    const d = draftOf([node("end", "END")]);
    const next = editDraft(d, { type: "add-node", id: "decision-1", kind: "DECISION", position: { x: 10.4, y: 19.6 } });
    assert.deepEqual(find(next, "decision-1"), {
      id: "decision-1",
      kind: "DECISION",
      dependsOn: [],
      config: { field: "", equals: true, then: "", else: "" },
    });
    assert.deepEqual(next.positions.get("decision-1"), { x: 10, y: 20 });
    assert.equal(isDirty(next), true);
  });

  test("ignores an id already in the graph", () => {
    const d = draftOf([node("task-1", "TASK")]);
    assert.equal(editDraft(d, { type: "add-node", id: "task-1", kind: "TASK", position: { x: 0, y: 0 } }), d);
  });

  test("stops at the SDK's node cap", () => {
    const full = draftOf(Array.from({ length: MAX_NODES }, (_, i) => node(`n${i}`, "TASK")));
    assert.equal(editDraft(full, { type: "add-node", id: "task-1", kind: "TASK", position: { x: 0, y: 0 } }), full);
  });

  test("keeps the record's other fields", () => {
    const d = draftOf([node("end", "END")]);
    const next = editDraft(d, { type: "add-node", id: "task-1", kind: "TASK", position: { x: 0, y: 0 } });
    assert.equal(next.content.id, "ship");
    assert.equal(next.content.revision, "sha256:aaaa");
  });
});

describe("connect", () => {
  test("adds the source to the target's dependsOn once", () => {
    const d = draftOf([node("a", "TASK"), node("b", "TASK")]);
    const once = editDraft(d, { type: "connect", source: "a", target: "b" });
    assert.deepEqual(find(once, "b")?.dependsOn, ["a"]);
    assert.equal(editDraft(once, { type: "connect", source: "a", target: "b" }), once);
  });

  test("ignores a self edge and unknown nodes", () => {
    const d = draftOf([node("a", "TASK")]);
    assert.equal(editDraft(d, { type: "connect", source: "a", target: "a" }), d);
    assert.equal(editDraft(d, { type: "connect", source: "a", target: "zz" }), d);
    assert.equal(editDraft(d, { type: "connect", source: "zz", target: "a" }), d);
  });

  test("keeps dependsOn entries it doesn't understand", () => {
    const d = draftOf([node("a", "TASK"), { id: "b", kind: "TASK", dependsOn: [7 as never], config: {} }]);
    assert.deepEqual(find(editDraft(d, { type: "connect", source: "a", target: "b" }), "b")?.dependsOn, [7, "a"]);
  });
});

describe("set-branch", () => {
  test("sets the branch and adds the decision to the target's dependsOn in one edit", () => {
    const next = editDraft(decisionGraph(), { type: "set-branch", decision: "check", branch: "then", target: "ok" });
    assert.equal(find(next, "check")?.config && (find(next, "check")!.config as JsonObject).then, "ok");
    assert.deepEqual(find(next, "ok")?.dependsOn, ["check"]);
  });

  test("moving a branch drops the decision from the old target, unless the other branch still names it", () => {
    let d = editDraft(decisionGraph(), { type: "set-branch", decision: "check", branch: "then", target: "ok" });
    d = editDraft(d, { type: "set-branch", decision: "check", branch: "then", target: "fail" });
    assert.deepEqual(find(d, "ok")?.dependsOn, []);
    assert.deepEqual(find(d, "fail")?.dependsOn, ["check"]);

    d = editDraft(d, { type: "set-branch", decision: "check", branch: "else", target: "fail" });
    d = editDraft(d, { type: "set-branch", decision: "check", branch: "then", target: "ok" });
    assert.deepEqual(find(d, "fail")?.dependsOn, ["check"]);
  });

  test("an empty target clears the branch", () => {
    let d = editDraft(decisionGraph(), { type: "set-branch", decision: "check", branch: "else", target: "fail" });
    d = editDraft(d, { type: "set-branch", decision: "check", branch: "else", target: "" });
    assert.equal((find(d, "check")!.config as JsonObject).else, "");
    assert.deepEqual(find(d, "fail")?.dependsOn, []);
  });

  test("ignores a node that isn't a decision, and the decision itself as a target", () => {
    const d = decisionGraph();
    assert.equal(editDraft(d, { type: "set-branch", decision: "ok", branch: "then", target: "fail" }), d);
    assert.equal(editDraft(d, { type: "set-branch", decision: "check", branch: "then", target: "check" }), d);
  });
});

describe("disconnect", () => {
  test("removes the dependency and clears a branch that named the target", () => {
    let d = editDraft(decisionGraph(), { type: "set-branch", decision: "check", branch: "then", target: "ok" });
    d = editDraft(d, { type: "disconnect", source: "check", target: "ok" });
    assert.deepEqual(find(d, "ok")?.dependsOn, []);
    assert.equal((find(d, "check")!.config as JsonObject).then, "");
  });
});

describe("rename-node", () => {
  const graph = () => {
    let d = decisionGraph();
    d = editDraft(d, { type: "set-branch", decision: "check", branch: "then", target: "ok" });
    d = editDraft(d, { type: "set-branch", decision: "check", branch: "else", target: "fail" });
    return d;
  };

  test("rewrites dependsOn, decision targets and the layout in one edit", () => {
    const d = graph();
    let next = editDraft(d, { type: "rename-node", from: "ok", to: "passed -> ship" });
    assert.ok(find(next, "passed -> ship"));
    assert.equal(find(next, "ok"), undefined);
    assert.deepEqual(find(next, "end")?.dependsOn, ["passed -> ship", "fail"]);
    assert.equal((find(next, "check")!.config as JsonObject).then, "passed -> ship");
    assert.deepEqual([...next.positions.keys()], ["check", "passed -> ship", "fail", "end"]);

    next = editDraft(next, { type: "rename-node", from: "check", to: "gate" });
    assert.deepEqual(find(next, "passed -> ship")?.dependsOn, ["gate"]);
    assert.deepEqual(find(next, "fail")?.dependsOn, ["gate"]);
  });

  test("refuses an empty id, one too long, or one another node has", () => {
    const d = graph();
    assert.match(renameProblem(ids(d), "ok", "") ?? "", /empty/);
    assert.match(renameProblem(ids(d), "ok", "x".repeat(257)) ?? "", /256/);
    assert.equal(renameProblem(ids(d), "ok", "😀".repeat(256)), null);
    assert.match(renameProblem(ids(d), "ok", "fail") ?? "", /already/);
    assert.equal(renameProblem(ids(d), "ok", "ok"), null);
    assert.equal(renameProblem(ids(d), "ok", "OK"), null);
    for (const to of ["", "fail", "x".repeat(257)]) {
      assert.equal(editDraft(d, { type: "rename-node", from: "ok", to }), d);
    }
  });
});

describe("delete-node", () => {
  test("removes the node, its position and every reference to it", () => {
    let d = editDraft(decisionGraph(), { type: "set-branch", decision: "check", branch: "then", target: "ok" });
    d = editDraft(d, { type: "set-branch", decision: "check", branch: "else", target: "fail" });

    const noOk = editDraft(d, { type: "delete-node", id: "ok" });
    assert.equal(find(noOk, "ok"), undefined);
    assert.equal(noOk.positions.has("ok"), false);
    assert.deepEqual(find(noOk, "end")?.dependsOn, ["fail"]);
    assert.equal((find(noOk, "check")!.config as JsonObject).then, "");
    assert.equal((find(noOk, "check")!.config as JsonObject).else, "fail");

    const noCheck = editDraft(d, { type: "delete-node", id: "check" });
    assert.deepEqual(find(noCheck, "ok")?.dependsOn, []);
    assert.deepEqual(find(noCheck, "fail")?.dependsOn, []);
  });

  test("ignores an unknown id", () => {
    const d = decisionGraph();
    assert.equal(editDraft(d, { type: "delete-node", id: "zz" }), d);
  });
});

describe("set-config", () => {
  test("sets one config entry and keeps the others", () => {
    const d = decisionGraph();
    const next = editDraft(d, { type: "set-config", id: "check", key: "equals", value: { status: "done" } });
    assert.deepEqual(find(next, "check")?.config, { field: "passed", equals: { status: "done" }, then: "", else: "" });
  });

  test("setting the value it already has changes nothing", () => {
    const d = decisionGraph();
    assert.equal(editDraft(d, { type: "set-config", id: "check", key: "field", value: "passed" }), d);
  });
});

test("an edit that puts everything back leaves the draft clean", () => {
  const d = decisionGraph();
  const there = editDraft(d, { type: "connect", source: "ok", target: "fail" });
  const back = editDraft(there, { type: "disconnect", source: "ok", target: "fail" });
  assert.equal(isDirty(there), true);
  assert.equal(isDirty(back), false);
});

describe("stepFor", () => {
  test("each discrete edit is a step of its own, labelled for announcements", () => {
    assert.deepEqual(stepFor({ type: "add-node", id: "task-1", kind: "TASK", position: { x: 0, y: 0 } }), { label: "Add task-1" });
    assert.deepEqual(stepFor({ type: "connect", source: "a", target: "b" }), { label: "Connect a to b" });
    assert.deepEqual(stepFor({ type: "set-config", id: "t", key: "executionKind", value: "AGENT" }), { label: "Set executionKind of t" });
  });

  test("a live keystroke merges by node and field", () => {
    const step = stepFor({ type: "set-config", id: "loop-1", key: "maxIterations", value: "4", live: true });
    assert.deepEqual(step, { label: "Set maxIterations of loop-1", merge: { key: "loop-1|config.maxIterations" } });
  });

  test("the live flag doesn't change what the edit does", () => {
    const d = draftOf([node("loop-1", "LOOP", [], { maxIterations: "3" })]);
    const plain = editDraft(d, { type: "set-config", id: "loop-1", key: "maxIterations", value: "4" });
    const live = editDraft(d, { type: "set-config", id: "loop-1", key: "maxIterations", value: "4", live: true });
    assert.deepEqual(live.content, plain.content);
  });
});
