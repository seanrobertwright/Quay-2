/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyGrantEdit,
  compareDecimal,
  delegationChain,
  grantStepFor,
  limitIssues,
  newGrantContent,
  parentIdProblem,
} from "./grant.ts";
import { createDraft, createNewDraft, editGrantDraft, isDirty } from "./drafts.ts";
import { applyRename, changeDraft, EMPTY_SESSION, undoDraft, type BuilderSession } from "./session.ts";
import type { GrantCheck, RenameOutcome } from "./types.ts";

// --- a new grant -------------------------------------------------------------------------

test("a new grant is a root grant of the finite-v1 profile with its smallest counts and no times guessed", () => {
  assert.deepEqual(newGrantContent("a"), {
    id: "a",
    subject: "",
    profile: "finite-v1",
    actions: [],
    resources: [],
    notBefore: "",
    expiresAt: "",
    limit: "0",
    canDelegate: false,
    depth: "0",
  });
});

test("a grant opens as a clean draft with no bindings, and a new one is dirty until saved", () => {
  const ref = { kind: "grants" as const, id: "a" };
  const opened = createDraft(ref, { id: "a", kind: "grants", missing: false, content: { id: "a" }, contentHash: "h" });
  assert.ok(opened.ok);
  assert.equal(opened.value.bindings, null);
  assert.equal(isDirty(opened.value), false);
  const fresh = createNewDraft(ref, newGrantContent("a"));
  assert.ok(fresh.ok);
  assert.equal(isDirty(fresh.value), true);
});

// --- edits -------------------------------------------------------------------------------

test("a grant edit sets a field, removes one set to undefined, and changes nothing when it is the same", () => {
  const content = { id: "a", parentId: "p", limit: "5" };
  assert.deepEqual(applyGrantEdit(content, { type: "set-field", key: "limit", value: "7" }), { ...content, limit: "7" });
  assert.deepEqual(applyGrantEdit(content, { type: "set-field", key: "parentId", value: undefined }), { id: "a", limit: "5" });
  assert.equal(applyGrantEdit(content, { type: "set-field", key: "limit", value: "5" }), content);
  const root = { id: "a" };
  assert.equal(applyGrantEdit(root, { type: "set-field", key: "parentId", value: undefined }), root);
});

test("typing in a grant field merges into one undo step, and other edits are steps of their own", () => {
  assert.deepEqual(grantStepFor({ type: "set-field", key: "limit", value: "5", live: true }), {
    label: "Set limit",
    merge: { key: "grant|limit" },
  });
  assert.deepEqual(grantStepFor({ type: "set-field", key: "parentId", value: undefined }), { label: "Clear parentId" });
});

test("editing a grant makes its draft dirty, keeps it free of bindings, and one undo takes it back", () => {
  const ref = { kind: "grants" as const, id: "a" };
  const opened = createDraft(ref, { id: "a", kind: "grants", missing: false, content: { id: "a", limit: "1" }, contentHash: "h" });
  assert.ok(opened.ok);
  const session: BuilderSession = { ...EMPTY_SESSION, open: ref, drafts: { "grants/a": opened.value } };
  const edit = { type: "set-field", key: "limit", value: "9" } as const;
  const edited = changeDraft(session, ref, (d) => editGrantDraft(d, edit), grantStepFor(edit), 0);
  const draft = edited.drafts["grants/a"];
  assert.equal(draft.content.limit, "9");
  assert.equal(draft.bindings, null);
  assert.equal(isDirty(draft), true);
  const undone = undoDraft(edited, ref);
  assert.ok(undone);
  assert.equal(isDirty(undone.session.drafts["grants/a"]), false);
});

test("renaming a parent grant rewrites an open child grant's draft with the backend's content", () => {
  const ref = { kind: "grants" as const, id: "child" };
  const opened = createDraft(ref, {
    id: "child",
    kind: "grants",
    missing: false,
    content: { id: "child", parentId: "p" },
    contentHash: "h1",
  });
  assert.ok(opened.ok);
  const dirty = editGrantDraft(opened.value, { type: "set-field", key: "limit", value: "3" });
  const session: BuilderSession = { ...EMPTY_SESSION, drafts: { "grants/child": dirty } };
  const outcome: RenameOutcome = {
    changes: [{ path: ".praxis/grants/child.json", hashes: { previous: "h1", next: "h2" } }],
    unchecked: [],
    drafts: [{ kind: "grants", id: "child", content: { id: "child", parentId: "q", limit: "3" } }],
    done: ["Rewrote .praxis/grants/child.json"],
  };
  const after = applyRename(session, { kind: "grants", id: "p" }, "q", outcome).drafts["grants/child"];
  assert.equal(after.content.parentId, "q");
  assert.equal(after.baseHash, "h2");
});

// --- the parent picker -------------------------------------------------------------------

test("a parent may be an unknown id, but only a filename-safe one other than the grant itself", () => {
  assert.equal(parentIdProblem("p", "a"), null);
  assert.equal(parentIdProblem("not made yet", "a"), "The id may only use letters, digits, '.', '_' and '-'.");
  assert.equal(parentIdProblem("a", "a"), "A grant can't be its own parent.");
});

// --- limits ------------------------------------------------------------------------------

test("canonical decimals compare by value however many digits they have", () => {
  assert.equal(compareDecimal("9", "10"), -1);
  assert.equal(compareDecimal("10", "10"), 0);
  assert.equal(compareDecimal("1" + "0".repeat(30), "9".repeat(30)), 1);
});

const check = (over: Partial<GrantCheck> = {}): GrantCheck => ({ chain: [], contracts: [], unchecked: [], ...over });

test("a limit within its parent's limit and every binding contract's budget has no issues", () => {
  const c = check({ chain: [{ id: "p", limit: "50" }], contracts: [{ id: "c1", budget: "100" }, { id: "c2", budget: "50" }] });
  assert.deepEqual(limitIssues("50", "p", c), []);
});

test("a limit over its parent's limit or a contract's budget is flagged on the limit, once for each", () => {
  const c = check({ chain: [{ id: "root", limit: "500" }, { id: "p", limit: "50" }], contracts: [{ id: "c1", budget: "40" }, { id: "c2", budget: "100" }] });
  const issues = limitIssues("60", "p", c);
  assert.deepEqual(
    issues.map((d) => [d.path, d.message]),
    [
      ["/limit", "This is more than parent grant p's limit of 50."],
      ["/limit", "This is more than contract c1's budget of 40."],
    ]
  );
  assert.ok(issues.every((d) => d.severity === "error"));
});

test("limits that aren't canonical whole numbers, and a chain that doesn't end at the parent, aren't compared", () => {
  const c = check({ chain: [{ id: "other", limit: "1" }], contracts: [{ id: "c1", budget: "x" }, { id: "c2" }] });
  assert.deepEqual(limitIssues("60", "p", c), []);
  assert.deepEqual(limitIssues("06", undefined, check({ contracts: [{ id: "c1", budget: "1" }] })), []);
  assert.deepEqual(limitIssues(60, undefined, check({ contracts: [{ id: "c1", budget: "1" }] })), []);
});

// --- the delegation chain ----------------------------------------------------------------

test("the chain runs from the root grant down to this one, each with its limit", () => {
  const c = check({ chain: [{ id: "root", limit: "500" }, { id: "p", limit: "50" }] });
  assert.deepEqual(delegationChain("a", "5", "p", c), {
    links: [
      { id: "root", limit: "500" },
      { id: "p", limit: "50" },
      { id: "a", limit: "5", self: true },
    ],
  });
});

test("a chain that stops at a missing grant starts with it, flagged", () => {
  const c = check({ chain: [{ id: "p", limit: "50" }], chainBreak: { id: "gone", message: "No grant has this id." } });
  assert.deepEqual(delegationChain("a", "5", "p", c), {
    broken: { id: "gone", message: "No grant has this id." },
    links: [
      { id: "p", limit: "50" },
      { id: "a", limit: "5", self: true },
    ],
  });
});

test("a root grant's chain is itself, and a limit that isn't a string shows as unset", () => {
  assert.deepEqual(delegationChain("a", 5, undefined, check({ chain: [{ id: "stale", limit: "1" }] })), {
    links: [{ id: "a", limit: undefined, self: true }],
  });
});
