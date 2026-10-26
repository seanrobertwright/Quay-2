import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { issueField, issuesByNode, nodeIssuesBySlot, problemCounts, withKeys } from "./issues.ts";
import type { Diagnostic } from "./types.ts";

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
  it("counts errors and info apart", () => {
    const validation = {
      verdict: "NODE_CONFIG",
      diagnostics: [error("/nodes"), error("/nodes/0", "a"), info("/revision")],
      omitted: { errors: 0, info: 0 },
    };
    assert.deepEqual(problemCounts(validation), { errors: 2, info: 1 });
  });

  it("adds the issues the backend left out of the list", () => {
    const validation = { verdict: "NODE_CONFIG", diagnostics: [error("/nodes")], omitted: { errors: 900, info: 3 } };
    assert.deepEqual(problemCounts(validation), { errors: 901, info: 3 });
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
