/// <reference types="node" />
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attachStatusIssues, boundCostUnits, entryWorstCase, withAttachIssues, worstCase, type WorstCaseNode } from "./bindingChecks.ts";
import type { JsonObject } from "./model.ts";
import type { AttachContract, Diagnostic, ValidationStatus } from "./types.ts";

const bounded = (allowance: string, maxAttempts?: number): JsonObject => ({
  executionKind: "AGENT",
  role: "WORK",
  exposure: { kind: "BOUNDED", allowance, stopThreshold: "1" },
  ...(maxAttempts !== undefined && { maxAttempts }),
});

/** build and test run in turn, a DECISION picks ship or skip, and fix loops up to three times. */
const nodes: WorstCaseNode[] = [
  { id: "build", kind: "TASK", config: { executionKind: "AGENT" } },
  { id: "pick", kind: "DECISION", config: {} },
  { id: "ship", kind: "TASK", config: { executionKind: "AGENT" } },
  { id: "skip", kind: "TASK", config: { executionKind: "AGENT" } },
  { id: "fix", kind: "LOOP", config: { maxIterations: "3" } },
  { id: "review", kind: "TASK", config: { executionKind: "AGENT" } },
  { id: "end", kind: "END", config: {} },
];

describe("worstCase (#247, #274)", () => {
  it("sums allowance × attempts over Bounded entries, times maxIterations for a LOOP, counting both DECISION branches", () => {
    const binding: JsonObject = {
      nodes: {
        build: bounded("100", 2),
        ship: bounded("10", 1),
        skip: bounded("7", 1),
        fix: bounded("5", 2),
        review: { executionKind: "AGENT", role: "WORK", exposure: { kind: "NOT_APPLICABLE", justification: "no model" } },
      },
    };
    const w = worstCase(binding, nodes);
    // 100×2 + 10×1 + 7×1 + 5×2×3; review is Not applicable, so it counts zero.
    assert.equal(w.total, 247n);
    assert.deepEqual(
      w.counted.map((c) => [c.node, c.worstCase]),
      [
        ["build", 200n],
        ["ship", 10n],
        ["skip", 7n],
        ["fix", 30n],
      ]
    );
    assert.deepEqual(w.uncounted, []);
  });

  it("takes attempts from the entry, else from the contract, so the figure is per contract", () => {
    const binding: JsonObject = { nodes: { build: bounded("100", 2), ship: bounded("10") } };
    assert.equal(worstCase(binding, nodes, "4").total, 240n);
    assert.equal(worstCase(binding, nodes, "1").total, 210n);
  });

  it("leaves out, and names, an entry whose allowance, attempts or iterations aren't known", () => {
    const binding: JsonObject = { nodes: { build: bounded("100", 2), ship: bounded("10"), skip: bounded("", 1) } };
    const w = worstCase(binding, [...nodes.slice(0, 4), { id: "fix", kind: "LOOP", config: { maxIterations: "lots" } }], undefined);
    assert.equal(w.total, 200n);
    assert.deepEqual(
      w.uncounted.map((u) => u.node),
      ["ship", "skip"]
    );
    assert.match(w.uncounted[0].reason, /attempts/);
    assert.match(w.uncounted[1].reason, /allowance/);
    const loop = entryWorstCase(bounded("5", 1), { id: "fix", kind: "LOOP", config: { maxIterations: "lots" } });
    assert.ok(loop !== null && "reason" in loop && /maxIterations/.test(loop.reason));
  });

  it("counts entries only for the graph's dispatchable nodes, and keeps amounts past 2^53 exact", () => {
    const big = "123456789012345678901234567890";
    const binding: JsonObject = { nodes: { build: bounded(big, 3), pick: bounded("1", 1), gone: bounded("1", 1) } };
    const w = worstCase(binding, nodes);
    assert.equal(w.total, BigInt(big) * 3n);
    assert.deepEqual(
      w.counted.map((c) => c.node),
      ["build"]
    );
  });

  it("gives null for an entry that isn't Bounded", () => {
    assert.equal(entryWorstCase({ executionKind: "FUNCTION" }, nodes[0]), null);
  });
});

const warning = (code: string, path: string, nodeId?: string): Diagnostic => ({
  code,
  severity: "warning",
  message: `${code} m`,
  path,
  ...(nodeId !== undefined && { nodeId }),
});

const contract = (id: string, diagnostics: Diagnostic[], omitted = 0): AttachContract => ({
  id,
  coverage: [],
  diagnostics,
  omitted,
});

describe("withAttachIssues", () => {
  const own: Diagnostic = { code: "BINDING_INCOMPLETE", severity: "error", message: "Node b has no entry.", path: "/nodes", nodeId: "b" };
  const checked: ValidationStatus = {
    state: "done",
    validation: { verdict: "BINDING_INCOMPLETE", diagnostics: [own], omitted: { errors: 0, warnings: 1, info: 0 } },
  };

  it("adds each contract's warnings after the binding's own issues and counts the omitted ones", () => {
    const attach = {
      state: "done" as const,
      attach: {
        contracts: [contract("c", [warning("CRITERIA_UNCOVERED", "", "verify")], 2), contract("d", [warning("LIMIT_CONFIGURATION_INVALID", "/maxTotalCost")])],
        unchecked: [],
      },
    };
    const both = withAttachIssues(checked, attach);
    assert.equal(both.state, "done");
    if (both.state !== "done") return;
    assert.equal(both.validation.verdict, "BINDING_INCOMPLETE");
    assert.deepEqual(
      both.validation.diagnostics.map((d) => d.code),
      ["BINDING_INCOMPLETE", "CRITERIA_UNCOVERED", "LIMIT_CONFIGURATION_INVALID"]
    );
    assert.deepEqual(both.validation.omitted, { errors: 0, warnings: 3, info: 0 });
  });

  it("says when the contract checks couldn't run, or skipped a file or a contract", () => {
    const failed = attachStatusIssues({ state: "failed", error: "boom" });
    assert.deepEqual(
      failed.map((d) => [d.code, d.severity]),
      [["CONTRACTS_UNCHECKED", "info"]]
    );
    assert.match(failed[0].message, /boom/);
    const partial = attachStatusIssues({
      state: "done",
      attach: { contracts: [{ ...contract("gone", []), problem: "The contract file doesn't exist." }], unchecked: [".praxis/bindings/x.json: bad"] },
    });
    assert.deepEqual(
      partial.map((d) => d.code),
      ["CONTRACTS_UNCHECKED", "CONTRACTS_UNCHECKED"]
    );
    assert.match(partial[0].message, /gone/);
    // While the checks run, the binding's own issues show alone.
    assert.equal(withAttachIssues(checked, { state: "checking" }), checked);
  });
});

describe("boundCostUnits (#231, #274)", () => {
  it("groups the cost units of the bound graphs' bindings, in the order first seen, leaving out other graphs", () => {
    const entries = [
      { id: "g-1", graphId: "g", costUnit: "micro-USD" },
      { id: "g-2", graphId: "g" },
      { id: "h-1", graphId: "h", costUnit: "cents" },
      { id: "h-2", graphId: "h", costUnit: "micro-USD" },
      { id: "x-1", graphId: "x", costUnit: "tokens" },
    ];
    assert.deepEqual(boundCostUnits(["g", "h"], entries), [
      { unit: "micro-USD", bindings: ["g-1", "h-2"] },
      { unit: "cents", bindings: ["h-1"] },
    ]);
    assert.deepEqual(boundCostUnits(["g"], entries), [{ unit: "micro-USD", bindings: ["g-1"] }]);
    assert.deepEqual(boundCostUnits([], entries), []);
  });
});
