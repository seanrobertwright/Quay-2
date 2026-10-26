/// <reference types="node" />
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { configSummary, NODE_KINDS_REGISTRY, PALETTE_GROUPS } from "./kinds.ts";
import { NODE_KINDS, type PraxisNode } from "./model.ts";

describe("NODE_KINDS_REGISTRY", () => {
  test("has an entry for each of the SDK's thirteen kinds, and no other", () => {
    assert.deepEqual(Object.keys(NODE_KINDS_REGISTRY).sort(), [...NODE_KINDS].sort());
  });

  test("groups the palette as Work, Flow, Gates and Finish", () => {
    const byGroup = Object.fromEntries(
      PALETTE_GROUPS.map((g) => [g, NODE_KINDS.filter((k) => NODE_KINDS_REGISTRY[k].group === g)])
    );
    assert.deepEqual(byGroup, {
      Work: ["TASK", "LOOP", "SUBWORKFLOW"],
      Flow: ["DECISION", "FORK", "JOIN", "WAIT"],
      Gates: ["APPROVAL", "VERIFICATION", "ACCEPTANCE"],
      Finish: ["RECONCILIATION", "COMPENSATION", "END"],
    });
  });

  test("a new node's config has exactly the keys its kind requires, in a fresh object", () => {
    for (const kind of NODE_KINDS) {
      const entry = NODE_KINDS_REGISTRY[kind];
      assert.deepEqual(Object.keys(entry.defaultConfig()), [...entry.configKeys], kind);
      assert.notEqual(entry.defaultConfig(), entry.defaultConfig(), kind);
    }
  });
});

describe("configSummary", () => {
  const n = (kind: string, config: PraxisNode["config"]): PraxisNode => ({ id: "x", kind, dependsOn: [], config });

  test("summarizes each configurable kind on one line", () => {
    assert.equal(configSummary(n("TASK", { executionKind: "TOOL" })), "TOOL");
    assert.equal(configSummary(n("TASK", { executionKind: "" })), "no execution kind");
    assert.equal(configSummary(n("DECISION", { field: "passed", equals: true })), "passed == true");
    assert.equal(configSummary(n("DECISION", { field: "" })), "no field");
    assert.equal(configSummary(n("JOIN", { mode: "ANY" })), "wait for any");
    assert.equal(configSummary(n("JOIN", { mode: "ALL" })), "wait for all");
    assert.equal(configSummary(n("LOOP", { maxIterations: "5" })), "≤ 5 iterations");
    assert.equal(configSummary(n("LOOP", { maxIterations: 5 })), "≤ 5 iterations");
    assert.equal(configSummary(n("LOOP", {})), "no iteration limit");
    assert.equal(configSummary(n("END", {})), "");
    assert.equal(configSummary(n("ROBOT", { a: 1 })), "");
  });
});
