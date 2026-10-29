import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { withBindingIssues, issueField, issuesByNode, nodeIssuesBySlot, problemCounts, withKeys } from "./issues.ts";
import type { Diagnostic, ValidationStatus } from "./types.ts";

const error = (path: string, nodeId?: string, field?: string): Diagnostic => ({
  code: "NODE_CONFIG",
  severity: "error",
  message: "m",
  path,
  ...(nodeId !== undefined && { nodeId }),
  ...(field !== undefined && { field }),
});

const info = (path: string, nodeId?: string): Diagnostic => ({
  ...error(path, nodeId),
  code: "REVISION_MISMATCH",
  severity: "info",
});

const warning = (path: string, nodeId?: string): Diagnostic => ({
  ...error(path, nodeId),
  code: "BINDING_STALE",
  severity: "warning",
});

describe("issuesByNode", () => {
  it("counts each node's issues and leaves out graph-level ones", () => {
    const byNode = issuesByNode([
      error("/nodes/0/config/then", "d", "config.then"),
      error("/nodes/0/config/else", "d", "config.else"),
      error("/nodes/1", "a"),
      error("/nodes"),
      info("/revision"),
    ]);
    assert.deepEqual(
      [...byNode],
      [
        ["d", { count: 2, severity: "error" }],
        ["a", { count: 1, severity: "error" }],
      ]
    );
  });

  it("marks a node error when any of its issues is an error", () => {
    const byNode = issuesByNode([info("/nodes/0", "a"), error("/nodes/0/id", "a", "id"), info("/nodes/0", "a")]);
    assert.deepEqual(byNode.get("a"), { count: 3, severity: "error" });
  });

  it("marks a node info when all of its issues are info", () => {
    assert.deepEqual(issuesByNode([info("/nodes/2", "x")]).get("x"), { count: 1, severity: "info" });
  });

  it("marks a node warning when its worst issue is a warning", () => {
    const byNode = issuesByNode([info("/nodes/0", "a"), warning("/nodes/0", "a"), info("/nodes/0", "a")]);
    assert.deepEqual(byNode.get("a"), { count: 3, severity: "warning" });
    assert.deepEqual(issuesByNode([warning("/nodes/0", "a"), error("/nodes/0", "a")]).get("a"), { count: 2, severity: "error" });
  });
});

describe("issueField", () => {
  it("is the field inside the node when there is one", () => {
    assert.equal(issueField(error("/nodes/0/config/then", "d", "config.then")), "config.then");
  });

  it("is empty for an issue on a whole node", () => {
    assert.equal(issueField(error("/nodes/0", "d")), "");
  });

  it("is the dotted path for an issue outside any node", () => {
    assert.equal(issueField(info("/revision")), "revision");
    assert.equal(issueField(error("/nodes")), "nodes");
    assert.equal(issueField(error("")), "");
  });

  it("unescapes JSON Pointer segments", () => {
    assert.equal(issueField(error("/nodes/3/a~1b~0c")), "nodes.3.a/b~c");
  });
});

describe("problemCounts", () => {
  it("counts errors, warnings and info apart", () => {
    const validation = {
      verdict: "NODE_CONFIG",
      diagnostics: [error("/nodes"), error("/nodes/0", "a"), warning("/graphDigest"), info("/revision")],
      omitted: { errors: 0, warnings: 0, info: 0 },
    };
    assert.deepEqual(problemCounts(validation), { errors: 2, warnings: 1, info: 1 });
  });

  it("adds the issues the backend left out of the list", () => {
    const validation = { verdict: "NODE_CONFIG", diagnostics: [error("/nodes")], omitted: { errors: 900, warnings: 4, info: 3 } };
    assert.deepEqual(problemCounts(validation), { errors: 901, warnings: 4, info: 3 });
  });
});

describe("nodeIssuesBySlot", () => {
  const slots = ["id", "dependsOn", "config.then", "config.else"];

  it("files each of the node's issues under the control it is about", () => {
    const d = [
      error("/nodes/0/config/then", "a", "config.then"),
      error("/nodes/0/dependsOn/1", "a", "dependsOn.1"),
      error("/nodes/0/dependsOn", "a", "dependsOn"),
      error("/nodes/0/id", "a", "id"),
      error("/nodes/1/config/then", "b", "config.then"),
      error("/revision"),
    ];
    const bySlot = nodeIssuesBySlot(d, "a", slots);
    assert.deepEqual([...bySlot.keys()], ["config.then", "dependsOn", "id"]);
    assert.deepEqual(bySlot.get("dependsOn"), [d[1], d[2]]);
    assert.deepEqual(bySlot.get("config.then"), [d[0]]);
  });

  it("files the whole node's issues, and those on fields with no control, under \"\"", () => {
    const d = [
      error("/nodes/0", "a"),
      error("/nodes/0/config/extra", "a", "config.extra"),
      error("/nodes/0/config", "a", "config"),
      error("/nodes/0/config/thenx", "a", "config.thenx"),
      error("/nodes/0/outputSchema", "a", "outputSchema"),
    ];
    assert.deepEqual([...nodeIssuesBySlot(d, "a", slots)], [["", d]]);
  });
});

describe("withKeys", () => {
  it("numbers the second of two diagnostics that say the same thing", () => {
    const d = [error("/nodes/0/config", "a"), error("/nodes/0/config", "a"), error("/nodes/1", "b")];
    const keys = withKeys(d).map(([key]) => key);
    assert.equal(new Set(keys).size, 3);
    assert.deepEqual(withKeys(d).map(([, diagnostic]) => diagnostic), d);
  });
});

describe("withBindingIssues", () => {
  it("joins a binding's issues to the graph's, named after the binding, and keeps the graph's verdict", () => {
  const graphIssue: Diagnostic = { code: "NO_END_PATH", severity: "error", message: "No end.", path: "/nodes/0", nodeId: "a" };
  const bindingIssue: Diagnostic = { code: "BINDING_INCOMPLETE", severity: "error", message: "Node b has no entry.", path: "/nodes", nodeId: "b" };
  const graph: ValidationStatus = { state: "done", validation: { verdict: "NO_END_PATH", diagnostics: [graphIssue], omitted: { errors: 1, warnings: 0, info: 0 } } };
  const binding: ValidationStatus = { state: "done", validation: { verdict: "BINDING_INCOMPLETE", diagnostics: [bindingIssue], omitted: { errors: 0, warnings: 5, info: 2 } } };
  const both = withBindingIssues(graph, "g-1", binding);
  assert.equal(both.state, "done");
  if (both.state !== "done") return;
  assert.equal(both.validation.verdict, "NO_END_PATH");
  assert.deepEqual(both.validation.diagnostics, [graphIssue, { ...bindingIssue, message: "Binding g-1: Node b has no entry." }]);
  assert.deepEqual(both.validation.omitted, { errors: 1, warnings: 5, info: 2 });
  // Until both are checked, the list says it is checking; without a binding it is the graph's own.
  assert.deepEqual(withBindingIssues(graph, "g-1", { state: "checking" }), { state: "checking" });
  assert.equal(withBindingIssues(graph, "g-1", null), graph);
});
});
