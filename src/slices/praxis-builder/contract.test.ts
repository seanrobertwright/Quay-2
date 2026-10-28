/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyContractEdit,
  bindingIdProblem,
  contractStepFor,
  durationMs,
  durationParts,
  EMPTY_BINDINGS,
  integerProblem,
  MAX_INTEGER_DIGITS,
  newContractContent,
  parseBindings,
  renameInBindings,
  timeMs,
  type Bindings,
} from "./contract.ts";
import { createContractDraft, createDraft, createNewDraft, isDirty, markSaved, reconcileWithDisk, restoreSnapshot, snapshotOf } from "./drafts.ts";
import { applyRename, changeDraft, EMPTY_SESSION, undoDraft, type BuilderSession } from "./session.ts";
import type { DefinitionFile, RenameOutcome } from "./types.ts";

// --- the integer checks ----------------------------------------------------------------

test("canonical whole numbers are accepted", () => {
  for (const text of ["0", "1", "42", "9".repeat(MAX_INTEGER_DIGITS), " 7 "]) {
    assert.equal(integerProblem(text), null, text);
  }
});

test("empty, negative, fractional and non-numeric text is refused", () => {
  assert.equal(integerProblem(""), "Enter a whole number.");
  assert.equal(integerProblem("   "), "Enter a whole number.");
  assert.equal(integerProblem("-1"), "This can't be negative.");
  assert.equal(integerProblem("- 3"), "This can't be negative.");
  for (const text of ["NaN", "1.5", "1e3", "0x10", "Infinity", "12a", "+1", "١٢"]) {
    assert.equal(integerProblem(text), "Enter a whole number in digits, such as 3.", text);
  }
});

test("leading zeros and too many digits are refused, as the SDK's pattern does", () => {
  assert.equal(integerProblem("007"), "Write the number without leading zeros.");
  assert.equal(integerProblem("00"), "Write the number without leading zeros.");
  assert.equal(integerProblem("1".repeat(MAX_INTEGER_DIGITS + 1)), `Use at most ${MAX_INTEGER_DIGITS} digits.`);
});

test("a count can require a smallest value", () => {
  assert.equal(integerProblem("0", 1n), "This must be at least 1.");
  assert.equal(integerProblem("1", 1n), null);
});

// --- durations and times ---------------------------------------------------------------

test("a duration is stored as milliseconds and shown in the largest unit that divides it", () => {
  assert.deepEqual(durationMs("90", "min"), { ok: true, ms: "5400000" });
  assert.deepEqual(durationMs("2", "d"), { ok: true, ms: "172800000" });
  assert.deepEqual(durationParts("5400000"), { amount: "90", unit: "min" });
  assert.deepEqual(durationParts("172800000"), { amount: "2", unit: "d" });
  assert.deepEqual(durationParts("1500"), { amount: "1500", unit: "ms" });
  assert.deepEqual(durationParts("0"), { amount: "0", unit: "min" });
  assert.equal(durationParts("01"), null);
  assert.equal(durationParts(""), null);
});

test("a duration amount is checked like any integer, and must fit Praxis's digits", () => {
  assert.deepEqual(durationMs("-1", "s"), { ok: false, problem: "This can't be negative." });
  assert.deepEqual(durationMs("", "h"), { ok: false, problem: "Enter a whole number." });
  const huge = durationMs("9".repeat(MAX_INTEGER_DIGITS), "d");
  assert.equal(huge.ok, false);
});

test("a stored time reads as a number only when it is a safe canonical integer", () => {
  assert.equal(timeMs("1893456000000"), 1893456000000);
  assert.equal(timeMs(""), null);
  assert.equal(timeMs("01"), null);
  assert.equal(timeMs(1893456000000), null);
  assert.equal(timeMs("9".repeat(20)), null);
});

// --- a new contract ----------------------------------------------------------------------

test("a new contract runs graphs, needs approval and has its mission id and smallest counts", () => {
  const c = newContractContent("ship");
  assert.equal(c.id, "ship");
  assert.equal(c.missionId, "ship");
  assert.deepEqual(c.features, ["graphs"]);
  assert.equal(c.requiresApproval, true);
  assert.equal(c.deadline, "", "no time is guessed");
  assert.equal(c.maxAttempts, "1");
  assert.equal(c.budget, "0");
  assert.equal(c.aiwsEdition, "0.4");
  assert.equal(c.profile, "finite-v1");
});

// --- bindings ----------------------------------------------------------------------------

test("a bindings file's lists are read, dropping repeats and entries that aren't ids", () => {
  assert.deepEqual(parseBindings({ version: 1, graphs: ["a", "b", "a", 3], grants: ["g"] }), { graphs: ["a", "b"], grants: ["g"] });
  assert.deepEqual(parseBindings(null), EMPTY_BINDINGS);
  assert.deepEqual(parseBindings({ graphs: "a" }), EMPTY_BINDINGS);
});

test("a rename reaches only the list for its kind", () => {
  const b: Bindings = { graphs: ["g", "x"], grants: ["g"] };
  assert.deepEqual(renameInBindings(b, "graphs", "g", "h"), { graphs: ["h", "x"], grants: ["g"] });
  assert.deepEqual(renameInBindings(b, "grants", "g", "h"), { graphs: ["g", "x"], grants: ["h"] });
  assert.equal(renameInBindings(b, "graphs", "nope", "h"), b);
  assert.equal(renameInBindings(b, "triggers", "g", "h"), b);
});

test("a binding may name an unknown id, but only a filename-safe one not listed yet", () => {
  assert.equal(bindingIdProblem("not-yet-made", ["a"]), null);
  assert.equal(bindingIdProblem("a", ["a"]), "'a' is already listed.");
  assert.notEqual(bindingIdProblem("a/b", []), null);
  assert.notEqual(bindingIdProblem("", []), null);
});

test("contract edits change the field or the list, and nothing when they change nothing", () => {
  const content = newContractContent("c");
  const b = EMPTY_BINDINGS;
  const set = applyContractEdit(content, b, { type: "set-field", key: "budget", value: "10" });
  assert.equal(set.content.budget, "10");
  assert.equal(applyContractEdit(set.content, b, { type: "set-field", key: "budget", value: "10" }).content, set.content);
  const added = applyContractEdit(content, b, { type: "add-binding", list: "graphs", id: "g" });
  assert.deepEqual(added.bindings, { graphs: ["g"], grants: [] });
  assert.equal(applyContractEdit(content, added.bindings, { type: "add-binding", list: "graphs", id: "g" }).bindings, added.bindings);
  assert.deepEqual(applyContractEdit(content, added.bindings, { type: "remove-binding", list: "graphs", id: "g" }).bindings, b);
  assert.deepEqual(contractStepFor({ type: "set-field", key: "budget", value: "1", live: true }), {
    label: "Set budget",
    merge: { key: "contract|budget" },
  });
  assert.equal(contractStepFor({ type: "add-binding", list: "grants", id: "a" }).label, "Bind grant a");
});

// --- a contract's draft ----------------------------------------------------------------

const cref = { kind: "contracts" as const, id: "c" };

function contractFile(overrides: Partial<DefinitionFile> = {}): DefinitionFile {
  return {
    id: "c",
    kind: "contracts",
    missing: false,
    contentHash: "c1",
    content: newContractContent("c"),
    bindings: { version: 1, graphs: ["g"], grants: [] },
    bindingsHash: "b1",
    ...overrides,
  };
}

function contractDraft(overrides: Partial<DefinitionFile> = {}) {
  const created = createContractDraft(cref, contractFile(overrides));
  assert.ok(created.ok);
  return created.value;
}

test("a contract opens as a clean draft with its bindings, even one the SDK refuses", () => {
  const d = contractDraft({ content: { id: "c" } });
  assert.deepEqual(d.bindings, { graphs: ["g"], grants: [] });
  assert.equal(d.baseBindingsHash, "b1");
  assert.equal(isDirty(d), false);
  assert.equal(createContractDraft(cref, contractFile({ content: undefined })).ok, false);
});

test("a contract with no bindings file opens with none, and only graphs and contracts get drafts", () => {
  const d = contractDraft({ bindings: undefined, bindingsHash: undefined });
  assert.deepEqual(d.bindings, EMPTY_BINDINGS);
  assert.equal(d.baseBindingsHash, null);
  assert.equal(createDraft({ kind: "grants", id: "a" }, { id: "a", kind: "grants", missing: false, content: {} }).ok, false);
});

test("a new contract's draft is dirty until it is saved", () => {
  const created = createNewDraft(cref, newContractContent("c"));
  assert.ok(created.ok);
  assert.equal(isDirty(created.value), true);
  assert.equal(created.value.baseHash, null);
});

test("binding a graph makes the draft dirty, and one undo step takes it back", () => {
  const d = contractDraft();
  let session: BuilderSession = { ...EMPTY_SESSION, drafts: { "contracts/c": d } };
  session = changeDraft(
    session,
    cref,
    (x) => {
      const next = applyContractEdit(x.content, x.bindings!, { type: "add-binding", list: "graphs", id: "h" });
      return restoreSnapshot(x, { ...snapshotOf(x), bindings: next.bindings });
    },
    { label: "Bind graph h" },
    1
  );
  assert.equal(isDirty(session.drafts["contracts/c"]), true);
  const undone = undoDraft(session, cref);
  assert.ok(undone);
  assert.deepEqual(undone.session.drafts["contracts/c"].bindings, { graphs: ["g"], grants: [] });
  assert.equal(isDirty(undone.session.drafts["contracts/c"]), false);
});

test("a saved contract takes the written bindings as its base, and stays dirty when they weren't written", () => {
  const d = contractDraft();
  const edited = restoreSnapshot(d, { ...snapshotOf(d), bindings: { graphs: ["g", "h"], grants: [] } });
  const sent = { content: edited.content, layout: null, bindings: edited.bindings };
  const saved = markSaved(edited, { content: edited.content, contentHash: "c2", bindingsHash: "b2" }, sent);
  assert.equal(isDirty(saved), false);
  assert.equal(saved.baseBindingsHash, "b2");
  const failed = markSaved(edited, { content: edited.content, contentHash: "c2" }, sent);
  assert.equal(isDirty(failed), true, "the next save writes the bindings");
  assert.equal(failed.baseBindingsHash, "b1");
});

test("a bindings file changed on disk reloads a clean contract and keeps a dirty one", () => {
  const d = contractDraft();
  assert.deepEqual(reconcileWithDisk(d, contractFile()), { action: "keep", draft: d });
  assert.deepEqual(reconcileWithDisk(d, contractFile({ bindingsHash: "b9" })), { action: "reload" });
  assert.deepEqual(reconcileWithDisk(d, contractFile({ bindings: undefined, bindingsHash: undefined })), { action: "reload" });
  const dirty = restoreSnapshot(d, { ...snapshotOf(d), bindings: EMPTY_BINDINGS });
  assert.equal(reconcileWithDisk(dirty, contractFile({ bindingsHash: "b9" })).action, "keep");
});

// --- renames that reach bindings --------------------------------------------------------

const noOutcome: RenameOutcome = { changes: [], unchecked: [], drafts: [], done: ["Wrote it"] };

test("renaming a bound graph rewrites a dirty contract's bindings and expects its rewritten bindings file", () => {
  const g = { kind: "graphs" as const, id: "g" };
  let session: BuilderSession = { ...EMPTY_SESSION, drafts: { "contracts/c": contractDraft() } };
  session = changeDraft(
    session,
    cref,
    (x) => restoreSnapshot(x, { ...snapshotOf(x), content: { ...x.content, budget: "5" } }),
    { label: "Set budget" },
    1
  );
  const outcome: RenameOutcome = {
    ...noOutcome,
    changes: [{ path: ".praxis/bindings/c.json", hashes: { previous: "b1", next: "b2" } }],
  };
  const next = applyRename(session, g, "h", outcome);
  const c = next.drafts["contracts/c"];
  assert.deepEqual(c.bindings, { graphs: ["h"], grants: [] });
  assert.equal(c.baseBindingsHash, "b2");
  assert.equal(c.content.budget, "5");
  assert.deepEqual(next.histories, {});
});

test("renaming a bound graph drops a clean contract whose bindings file it rewrote, so it reloads", () => {
  const session: BuilderSession = { ...EMPTY_SESSION, drafts: { "contracts/c": contractDraft() } };
  const outcome: RenameOutcome = {
    ...noOutcome,
    changes: [{ path: ".praxis/bindings/c.json", hashes: { previous: "b1", next: "b2" } }],
  };
  assert.equal(applyRename(session, { kind: "graphs", id: "g" }, "h", outcome).drafts["contracts/c"], undefined);
});

test("renaming a grant bound only in an unsaved contract rewrites that draft", () => {
  const created = createNewDraft(cref, newContractContent("c"));
  assert.ok(created.ok);
  const unsaved = restoreSnapshot(created.value, { ...snapshotOf(created.value), bindings: { graphs: [], grants: ["a"] } });
  const session: BuilderSession = { ...EMPTY_SESSION, drafts: { "contracts/c": unsaved } };
  const next = applyRename(session, { kind: "grants", id: "a" }, "b", noOutcome);
  assert.deepEqual(next.drafts["contracts/c"].bindings, { graphs: [], grants: ["b"] });
  assert.equal(next.drafts["contracts/c"].baseHash, null);
});
