/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBindingEdit,
  bindingMarks,
  bindingStatus,
  bindingStepFor,
  entriesForNodes,
  idSuggestions,
  newBindingContent,
  nextBindingId,
  renameNodeInBinding,
  retargetBinding,
  retargetPlan,
  withPastedEntries,
} from "./graphBinding.ts";
import type { JsonObject } from "./model.ts";

/** A graph with every kind of node a binding cares about, and some it doesn't. */
const graph: JsonObject = {
  id: "release",
  revision: "sha256:1111111111111111",
  nodes: [
    { id: "build", kind: "TASK", dependsOn: [], config: { executionKind: "AGENT" } },
    { id: "publish", kind: "TASK", dependsOn: ["build"], config: { executionKind: "TOOL" } },
    { id: "sign", kind: "TASK", dependsOn: ["build"], config: { executionKind: "HUMAN" } },
    { id: "fix", kind: "LOOP", dependsOn: ["publish"], config: { maxIterations: "2" } },
    { id: "check", kind: "VERIFICATION", dependsOn: ["fix"], config: {} },
    { id: "undo", kind: "COMPENSATION", dependsOn: ["publish"], config: {} },
    { id: "end", kind: "END", dependsOn: ["check", "undo", "sign"], config: {} },
  ],
};

// --- a new binding (#247) ----------------------------------------------------------------

test("a new binding's id is the graph id and the smallest free number", () => {
  assert.equal(nextBindingId("release", []), "release-1");
  assert.equal(nextBindingId("release", ["release-1", "RELEASE-2"]), "release-3");
});

test("a new binding has one entry per TASK, LOOP and COMPENSATION node, in node order", () => {
  const binding = newBindingContent("release-1", graph);
  assert.equal(binding.format, "aiws-graph-binding/1");
  assert.equal(binding.graphBindingId, "release-1");
  assert.equal(binding.graphId, "release");
  assert.deepEqual(Object.keys(binding.nodes as JsonObject), ["build", "publish", "sign", "fix", "undo"]);
});

test("a TASK entry copies the node's executionKind; LOOP and COMPENSATION default to AGENT; all are Work", () => {
  const nodes = newBindingContent("release-1", graph).nodes as Record<string, JsonObject>;
  assert.deepEqual(nodes.build, {
    executionKind: "AGENT",
    role: "WORK",
    agentId: "",
    commands: [],
    outputPaths: [],
    exposure: { kind: "BOUNDED", allowance: "", stopThreshold: "" },
    requirements: [],
  });
  assert.deepEqual(nodes.publish, {
    executionKind: "TOOL",
    role: "WORK",
    protocolBindingId: "",
    action: "",
    resource: "",
    payload: {},
    exposure: { kind: "BOUNDED", allowance: "", stopThreshold: "" },
  });
  // FUNCTION and HUMAN entries carry only their kind until Praxis runs them.
  assert.deepEqual(nodes.sign, { executionKind: "HUMAN" });
  assert.equal(nodes.fix.executionKind, "AGENT");
  assert.equal(nodes.undo.executionKind, "AGENT");
});

test("a new binding leaves its pins empty, for its first save to fill from the graph on disk", () => {
  const binding = newBindingContent("release-1", graph);
  assert.equal(binding.graphRevision, "");
  assert.equal(binding.graphDigest, "");
});

// --- pins, Stale and Retarget (#247) ----------------------------------------------------

const pin = { revision: "sha256:2222222222222222", digest: `sha256:${"b".repeat(64)}` };
const pinnedTo = (p: { revision?: string; digest: string }) => ({
  ...newBindingContent("release-1", graph),
  graphRevision: p.revision ?? "",
  graphDigest: p.digest,
});

test("a binding pinned to the graph on disk is current", () => {
  assert.equal(bindingStatus(pinnedTo(pin), pin), "current");
});

test("a binding whose graph changed on disk is stale, by revision or by digest", () => {
  assert.equal(bindingStatus(pinnedTo(pin), { ...pin, revision: "sha256:3333333333333333" }), "stale");
  assert.equal(bindingStatus(pinnedTo(pin), { ...pin, digest: `sha256:${"c".repeat(64)}` }), "stale");
});

test("a binding of a graph that isn't saved, or not pinned yet, isn't stale", () => {
  assert.equal(bindingStatus(pinnedTo(pin), null), "graph-unsaved");
  assert.equal(bindingStatus(newBindingContent("release-1", graph), pin), "unpinned");
});

/** The graph after edits: publish deleted, fix turned into a VERIFICATION node, a new TASK added. */
const changed: JsonObject = {
  ...graph,
  nodes: [
    { id: "build", kind: "TASK", dependsOn: [], config: { executionKind: "AGENT" } },
    { id: "sign", kind: "TASK", dependsOn: ["build"], config: { executionKind: "HUMAN" } },
    { id: "fix", kind: "VERIFICATION", dependsOn: ["build"], config: {} },
    { id: "deploy", kind: "TASK", dependsOn: ["fix"], config: { executionKind: "AGENT" } },
    { id: "undo", kind: "COMPENSATION", dependsOn: ["deploy"], config: {} },
    { id: "end", kind: "END", dependsOn: ["undo", "sign"], config: {} },
  ],
};

test("Retarget lists the entries it drops, with why, and the new nodes left unbound", () => {
  const plan = retargetPlan(pinnedTo(pin), changed);
  assert.deepEqual(plan.drop, [
    { id: "publish", reason: "The graph has no node publish." },
    { id: "fix", reason: "fix is a VERIFICATION node, which a binding doesn't run." },
  ]);
  assert.deepEqual(plan.unbound, ["deploy"]);
});

test("Retarget re-pins the binding to the graph on disk and drops those entries", () => {
  const next = { revision: "sha256:4444444444444444", digest: `sha256:${"d".repeat(64)}` };
  const retargeted = retargetBinding(pinnedTo(pin), changed, next);
  assert.equal(retargeted.graphRevision, next.revision);
  assert.equal(retargeted.graphDigest, next.digest);
  assert.deepEqual(Object.keys(retargeted.nodes as JsonObject), ["build", "sign", "undo"]);
  assert.equal(bindingStatus(retargeted, next), "current");
});

// --- node renames (#247) ----------------------------------------------------------------

test("a node rename rewrites the node's key and keeps the entry and the order", () => {
  const binding = newBindingContent("release-1", graph);
  const renamed = renameNodeInBinding(binding, "publish", "ship");
  assert.deepEqual(Object.keys(renamed.nodes as JsonObject), ["build", "ship", "sign", "fix", "undo"]);
  assert.deepEqual((renamed.nodes as JsonObject).ship, (binding.nodes as JsonObject).publish);
  // The pins stay: a rename leaves a stale binding stale.
  assert.equal(renamed.graphRevision, binding.graphRevision);
});

test("a rename of a node without an entry leaves the binding as it is", () => {
  const binding = newBindingContent("release-1", graph);
  assert.equal(renameNodeInBinding(binding, "check", "verify"), binding);
});

// --- edits ------------------------------------------------------------------------------

test("setting a field of an entry changes only that entry", () => {
  const binding = newBindingContent("release-1", graph);
  const next = applyBindingEdit(binding, { type: "set-entry-field", node: "build", key: "agentId", value: "claude-code" });
  assert.equal(((next.nodes as JsonObject).build as JsonObject).agentId, "claude-code");
  assert.equal((next.nodes as JsonObject).publish, (binding.nodes as JsonObject).publish);
  assert.equal(applyBindingEdit(next, { type: "set-entry-field", node: "build", key: "agentId", value: "claude-code" }), next);
});

test("removing a field of an entry takes the key away", () => {
  const binding = applyBindingEdit(newBindingContent("release-1", graph), {
    type: "set-entry-field",
    node: "build",
    key: "maxAttempts",
    value: 2,
  });
  const next = applyBindingEdit(binding, { type: "set-entry-field", node: "build", key: "maxAttempts", value: undefined });
  assert.equal("maxAttempts" in ((next.nodes as JsonObject).build as JsonObject), false);
});

test("Validation adds empty criteria and Work takes them away", () => {
  const binding = newBindingContent("release-1", graph);
  const validation = applyBindingEdit(binding, { type: "set-role", node: "build", role: "VALIDATION" });
  const entry = (validation.nodes as JsonObject).build as JsonObject;
  assert.equal(entry.role, "VALIDATION");
  assert.deepEqual(entry.criteria, []);
  const work = applyBindingEdit(validation, { type: "set-role", node: "build", role: "WORK" });
  assert.equal("criteria" in ((work.nodes as JsonObject).build as JsonObject), false);
});

test("choosing a LOOP's executionKind starts a blank entry of that kind with the same role", () => {
  let binding = newBindingContent("release-1", graph);
  binding = applyBindingEdit(binding, { type: "set-role", node: "fix", role: "VALIDATION" });
  binding = applyBindingEdit(binding, { type: "set-entry-field", node: "fix", key: "criteria", value: ["tests pass"] });
  const tool = applyBindingEdit(binding, { type: "set-execution-kind", node: "fix", executionKind: "TOOL" });
  const entry = (tool.nodes as JsonObject).fix as JsonObject;
  assert.equal(entry.executionKind, "TOOL");
  assert.equal(entry.role, "VALIDATION");
  assert.deepEqual(entry.criteria, ["tests pass"]);
  assert.equal(entry.protocolBindingId, "");
  assert.equal("agentId" in entry, false);
});

test("a graph-level field is set, and removed when undefined", () => {
  const binding = newBindingContent("release-1", graph);
  const withCost = applyBindingEdit(binding, { type: "set-field", key: "maxTotalCost", value: "500" });
  assert.equal(withCost.maxTotalCost, "500");
  assert.equal("maxTotalCost" in applyBindingEdit(withCost, { type: "set-field", key: "maxTotalCost", value: undefined }), false);
});

test("a binding edit is one undo step, and live typing in one field merges", () => {
  assert.deepEqual(bindingStepFor("release-1", { type: "set-role", node: "build", role: "VALIDATION" }), {
    label: "Set role of build in release-1",
  });
  assert.deepEqual(bindingStepFor("release-1", { type: "set-entry-field", node: "build", key: "agentId", value: "c", live: true }), {
    label: "Set agentId of build in release-1",
    merge: { key: "graph-bindings/release-1|build|agentId" },
  });
  assert.deepEqual(bindingStepFor("release-1", { type: "set-field", key: "costUnit", value: "u", live: true }), {
    label: "Set costUnit of release-1",
    merge: { key: "graph-bindings/release-1||costUnit" },
  });
});

// --- copy and paste (#248) ----------------------------------------------------------------

test("copy takes the Runs as entries of the copied nodes that have one", () => {
  const binding = newBindingContent("release-1", graph);
  const entries = entriesForNodes(binding, ["build", "check", "fix"]);
  assert.deepEqual(Object.keys(entries), ["build", "fix"]);
  assert.deepEqual(entries.build, (binding.nodes as JsonObject).build);
});

test("paste writes the entries under the pasted nodes' ids", () => {
  const source = applyBindingEdit(newBindingContent("release-1", graph), {
    type: "set-entry-field",
    node: "build",
    key: "agentId",
    value: "claude-code",
  });
  const entries = entriesForNodes(source, ["build", "fix"]);
  const target = newBindingContent("other-1", graph);
  const pasted = withPastedEntries(target, entries, new Map([["build", "build-2"], ["fix", "fix"]]));
  const nodes = pasted.nodes as JsonObject;
  assert.equal((nodes["build-2"] as JsonObject).agentId, "claude-code");
  assert.deepEqual(nodes.fix, entries.fix);
  // The target's own entries for other nodes stay.
  assert.equal((nodes.build as JsonObject).agentId, "");
});

// --- suggestions ----------------------------------------------------------------------------

test("id suggestions are the distinct non-empty values used across the project's bindings, sorted", () => {
  const a = applyBindingEdit(newBindingContent("a", graph), { type: "set-entry-field", node: "build", key: "agentId", value: "codex" });
  const b = applyBindingEdit(newBindingContent("b", graph), { type: "set-entry-field", node: "fix", key: "agentId", value: "claude-code" });
  const c = applyBindingEdit(b, { type: "set-entry-field", node: "undo", key: "agentId", value: "codex" });
  assert.deepEqual(idSuggestions([a, c], "agentId"), ["claude-code", "codex"]);
});

test("suggestions add the ids saved in the project's bindings and templates to those in the drafts", () => {
  const draft = applyBindingEdit(newBindingContent("a", graph), { type: "set-entry-field", node: "build", key: "agentId", value: "codex" });
  assert.deepEqual(idSuggestions([draft], "agentId", ["opencode", "codex"]), ["codex", "opencode"]);
});

// --- card markers -----------------------------------------------------------------------------

test("each dispatchable card is marked bound or unbound, and Validation entries say so", () => {
  let binding = newBindingContent("release-1", graph);
  binding = applyBindingEdit(binding, { type: "set-role", node: "build", role: "VALIDATION" });
  const { publish: _gone, ...rest } = binding.nodes as JsonObject;
  binding = { ...binding, nodes: rest };
  const marks = bindingMarks(binding, graph);
  assert.deepEqual(marks.get("build"), { bound: true, validation: true });
  assert.deepEqual(marks.get("publish"), { bound: false, validation: false });
  assert.deepEqual(marks.get("fix"), { bound: true, validation: false });
  assert.equal(marks.has("check"), false);
  assert.equal(marks.has("end"), false);
});

test("an entry can be added for an unbound node, and not over an existing one", () => {
  const { publish: _gone, ...rest } = newBindingContent("release-1", graph).nodes as JsonObject;
  const binding = { ...newBindingContent("release-1", graph), nodes: rest };
  const added = applyBindingEdit(binding, { type: "add-entry", node: "publish", executionKind: "TOOL" });
  assert.equal(((added.nodes as JsonObject).publish as JsonObject).protocolBindingId, "");
  assert.equal(applyBindingEdit(added, { type: "add-entry", node: "publish", executionKind: "AGENT" }), added);
});
