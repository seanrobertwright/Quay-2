import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  contractsToRecheck,
  graphRunContext,
  issuePlace,
  issuesOn,
  mergeContexts,
  NO_CONTEXTS,
  recordsWithErrors,
  type RunContexts,
} from "./runContext.ts";
import type { ContextCheck, ContractContext, RecordIssue } from "./types.ts";

const contract = (id: string, over: Partial<ContractContext> = {}): ContractContext => ({
  id,
  missing: false,
  graphs: [],
  grants: [],
  triggers: [],
  issues: [],
  omitted: 0,
  ...over,
});

const issue = (kind: RecordIssue["kind"], id: string, contractId: string, over: Partial<RecordIssue> = {}): RecordIssue => ({
  kind,
  id,
  contract: contractId,
  code: "NOT_FOUND",
  severity: "error",
  message: "m",
  path: "",
  ...over,
});

const check = (...contracts: ContractContext[]): ContextCheck => ({ contracts, unchecked: [] });

const ids = (r: RunContexts) => [...r.byId.keys()].sort();

describe("mergeContexts", () => {
  it("a full check replaces every contract, and marks the project checked", () => {
    const before = mergeContexts(NO_CONTEXTS, check(contract("a"), contract("b")), { seq: 1, full: true });
    const after = mergeContexts(before, check(contract("b"), contract("c")), { seq: 2, full: true });
    assert.equal(NO_CONTEXTS.checked, false);
    assert.equal(after.checked, true);
    assert.deepEqual(ids(after), ["b", "c"]);
  });

  it("a targeted check replaces only the contracts it checked", () => {
    const before = mergeContexts(NO_CONTEXTS, check(contract("a"), contract("b")), { seq: 1, full: true });
    const after = mergeContexts(before, check(contract("b", { graphs: ["g"] })), { seq: 2, full: false });
    assert.deepEqual(ids(after), ["a", "b"]);
    assert.deepEqual(after.byId.get("b")?.graphs, ["g"]);
    assert.equal(after.byId.get("a"), before.byId.get("a"));
  });

  it("an older result never replaces a newer one", () => {
    const newer = mergeContexts(NO_CONTEXTS, check(contract("b", { graphs: ["new"] })), { seq: 5, full: false });
    const stale = mergeContexts(newer, check(contract("a"), contract("b", { graphs: ["old"] })), { seq: 3, full: true });
    assert.deepEqual(stale.byId.get("b")?.graphs, ["new"]);
    assert.deepEqual(ids(stale), ["a", "b"]);
  });

  it("drops a missing contract that nothing names any more", () => {
    const before = mergeContexts(NO_CONTEXTS, check(contract("gone", { missing: true, triggers: ["t"] })), { seq: 1, full: true });
    assert.deepEqual(ids(before), ["gone"]);
    const after = mergeContexts(before, check(contract("gone", { missing: true })), { seq: 2, full: false });
    assert.deepEqual(ids(after), []);
  });
});

describe("contractsToRecheck", () => {
  const contexts = mergeContexts(
    NO_CONTEXTS,
    check(contract("a", { graphs: ["g"], grants: ["p"], triggers: ["t"] }), contract("b", { graphs: ["g"] }), contract("c")),
    { seq: 1, full: true }
  );

  it("names the contracts that bound or named the record when last checked", () => {
    assert.deepEqual(contractsToRecheck(contexts, { kind: "graphs", id: "g" }), ["a", "b"]);
    assert.deepEqual(contractsToRecheck(contexts, { kind: "grants", id: "p" }), ["a"]);
    assert.deepEqual(contractsToRecheck(contexts, { kind: "triggers", id: "t" }), ["a"]);
    assert.deepEqual(contractsToRecheck(contexts, { kind: "contracts", id: "c" }), ["c"]);
    assert.deepEqual(contractsToRecheck(contexts, { kind: "graphs", id: "other" }), []);
  });
});

describe("issuesOn", () => {
  it("collects a record's issues from every contract, each said once", () => {
    const contexts = mergeContexts(
      NO_CONTEXTS,
      check(
        contract("a", {
          issues: [
            issue("grants", "p", "a", { path: "/parentId", message: "No grant has the id x." }),
            issue("grants", "p", "a", { path: "/limit", code: "AUTHORITY_DENIED", message: "Over a's budget." }),
            issue("graphs", "g", "a"),
          ],
        }),
        contract("b", { issues: [issue("grants", "p", "b", { path: "/parentId", message: "No grant has the id x." })] })
      ),
      { seq: 1, full: true }
    );
    assert.deepEqual(
      issuesOn(contexts, { kind: "grants", id: "p" }).map((i) => [i.contract, i.path]),
      [
        ["a", "/parentId"],
        ["a", "/limit"],
      ]
    );
    assert.deepEqual(issuesOn(contexts, { kind: "grants", id: "q" }), []);
  });
});

describe("recordsWithErrors", () => {
  it("keys every record with an error, for the list's badges", () => {
    const contexts = mergeContexts(
      NO_CONTEXTS,
      check(contract("a", { issues: [issue("graphs", "g", "a"), issue("triggers", "t", "a", { severity: "info" })] })),
      { seq: 1, full: true }
    );
    assert.deepEqual([...recordsWithErrors(contexts)], ["graphs/g"]);
  });
});

describe("graphRunContext", () => {
  const contexts = mergeContexts(
    NO_CONTEXTS,
    check(
      contract("a", { graphs: ["g"], issues: [issue("graphs", "g", "a", { code: "UNSUPPORTED_FEATURE" })] }),
      contract("b", { graphs: ["g", "h"] }),
      contract("ghost", { missing: true, graphs: ["g"] })
    ),
    { seq: 1, full: true }
  );

  it("lists the contracts that run the graph, leaving out ones with no file, and its issues", () => {
    const run = graphRunContext(contexts, "g");
    assert.deepEqual(
      run.contracts.map((c) => c.id),
      ["a", "b"]
    );
    assert.deepEqual(
      run.issues.map((i) => i.code),
      ["UNSUPPORTED_FEATURE"]
    );
  });

  it("gives a graph no contract runs an info issue, once the project has been checked", () => {
    const run = graphRunContext(contexts, "lonely");
    assert.deepEqual(run.contracts, []);
    assert.deepEqual(
      run.issues.map((i) => [i.severity, i.code, i.message]),
      [["info", "NOT_BOUND", "No contract binds this graph, so it can't run. Add it to a contract's Graphs."]]
    );
    assert.deepEqual(graphRunContext(NO_CONTEXTS, "lonely").issues, []);
  });
});

describe("issuePlace", () => {
  it("reads a field, a list item or a binding entry, and nothing for the whole record", () => {
    const at = (path: string) => issuePlace(issue("contracts", "c", "c", { path }));
    assert.equal(at(""), "");
    assert.equal(at("/expiresAt"), "expiresAt");
    assert.equal(at("/actions/2"), "actions item 3");
    assert.equal(at("/bindings/graphs/0"), "Graphs item 1");
    assert.equal(at("/bindings/grants/4"), "Grants item 5");
  });
});
