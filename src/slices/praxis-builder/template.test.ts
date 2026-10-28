/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTemplateEdit,
  argumentsText,
  chooseExposure,
  EMPTY_HIDDEN,
  exposureChoice,
  eightyPercent,
  integerDigits,
  jsonInteger,
  moveArgument,
  newTemplateContent,
  parseArguments,
  removeArgument,
  setArgument,
  templateStages,
  templateStepFor,
} from "./template.ts";
import { createDraft, createNewDraft, editTemplateDraft, isDirty, withId } from "./drafts.ts";
import { RECORD_KINDS } from "./kinds.ts";

// --- a new template ----------------------------------------------------------------------

test("a new template follows #224: empty text, commands and outputs, no corrections, two attempts, re-approval on", () => {
  assert.deepEqual(newTemplateContent("fix-bug"), {
    description: "",
    implementation: [],
    validation: [],
    correction: [],
    outputPaths: [],
    criteriaRef: "",
    maxCorrections: 0,
    reapproveCorrections: true,
    maxAttempts: 2,
  });
});

test("templates are listed as Workflow templates and the builder creates them", () => {
  const entry = RECORD_KINDS.find((k) => k.kind === "templates");
  assert.equal(entry?.label, "Workflow templates");
  assert.equal(entry?.singular, "template");
  assert.ok(entry?.newRecord);
});

test("a template opens as a clean draft, a new one is dirty, and a rename puts no id inside", () => {
  const ref = { kind: "templates" as const, id: "a" };
  const opened = createDraft(ref, { id: "a", kind: "templates", missing: false, content: { description: "d" }, contentHash: "h" });
  assert.ok(opened.ok);
  assert.equal(isDirty(opened.value), false);
  const fresh = createNewDraft(ref, newTemplateContent("a"));
  assert.ok(fresh.ok);
  assert.equal(isDirty(fresh.value), true);
  const renamed = withId(opened.value, { kind: "templates", id: "b" });
  assert.deepEqual(renamed.content, { description: "d" });
  assert.equal(renamed.ref.id, "b");
});

// --- edits -------------------------------------------------------------------------------

test("an edit sets or removes fields, and one that changes nothing keeps the record", () => {
  const t = newTemplateContent("a");
  const set = applyTemplateEdit(t, { type: "set-field", key: "agent", value: "my-agent" });
  assert.equal(set.agent, "my-agent");
  const removed = applyTemplateEdit(set, { type: "set-field", key: "agent", value: undefined });
  assert.equal("agent" in removed, false);
  assert.equal(applyTemplateEdit(t, { type: "set-field", key: "maxAttempts", value: 2 }), t);
  const both = applyTemplateEdit(t, {
    type: "set-fields",
    values: { exposure: { kind: "NOT_APPLICABLE", justification: "" }, maxTotalCost: undefined },
    label: "Set exposure",
  });
  assert.deepEqual(both.exposure, { kind: "NOT_APPLICABLE", justification: "" });
  const draft = createNewDraft({ kind: "templates", id: "a" }, t);
  assert.ok(draft.ok);
  assert.equal(editTemplateDraft(draft.value, { type: "set-field", key: "maxAttempts", value: 2 }), draft.value);
});

test("typing in a field merges into one undo step; a remove-field fix is its own", () => {
  assert.deepEqual(templateStepFor({ type: "set-field", key: "description", value: "x", live: true }), {
    label: "Set description",
    merge: { key: "template|description" },
  });
  assert.deepEqual(templateStepFor({ type: "set-field", key: "steps", value: undefined }), { label: "Remove steps" });
  assert.deepEqual(templateStepFor({ type: "set-fields", values: {}, label: "Set exposure to Bounded" }), { label: "Set exposure to Bounded" });
});

test("counts and durations are stored as JSON numbers, and digits too large for one stay text", () => {
  assert.equal(jsonInteger("60000"), 60000);
  assert.equal(jsonInteger("9007199254740991"), 9007199254740991);
  assert.equal(jsonInteger("9007199254740992"), "9007199254740992");
  assert.equal(integerDigits(60000), "60000");
  assert.equal(integerDigits(undefined), "");
});

// --- argument lists ----------------------------------------------------------------------

test("arguments are set, removed and moved one row at a time, and the executable is just the first row", () => {
  const args = ["/usr/bin/node", "build.js", "--fast"];
  assert.deepEqual(setArgument(args, 1, "b.js"), ["/usr/bin/node", "b.js", "--fast"]);
  assert.deepEqual(setArgument([], 0, "node"), ["node"]);
  assert.deepEqual(removeArgument(args, 0), ["build.js", "--fast"]);
  assert.deepEqual(moveArgument(args, 2, -1), ["/usr/bin/node", "--fast", "build.js"]);
  assert.deepEqual(moveArgument(args, 0, 1), ["build.js", "/usr/bin/node", "--fast"]);
  assert.equal(moveArgument(args, 0, -1), args);
  assert.equal(moveArgument(args, 2, 1), args);
});

test("Edit as JSON takes an array of strings and never splits a command line", () => {
  assert.deepEqual(parseArguments('["node", "a b.js"]'), { ok: true, args: ["node", "a b.js"] });
  assert.deepEqual(parseArguments("[]"), { ok: true, args: [] });
  for (const bad of ["node build.js", '"node build.js"', '{"a": 1}', '["node", 3]', "[1"]) {
    assert.equal(parseArguments(bad).ok, false, bad);
  }
  assert.equal(argumentsText(["node", "a.js"]), '[\n  "node",\n  "a.js"\n]');
  assert.equal(argumentsText("node a.js"), '"node a.js"');
});

// --- exposure ----------------------------------------------------------------------------

test("the exposure choice follows the record, and an exposure Quay doesn't know is shown as other", () => {
  assert.equal(exposureChoice({}), "none");
  assert.equal(exposureChoice({ exposure: { kind: "BOUNDED" } }), "BOUNDED");
  assert.equal(exposureChoice({ exposure: { kind: "NOT_APPLICABLE" } }), "NOT_APPLICABLE");
  assert.equal(exposureChoice({ exposure: { kind: "SOMETHING" } }), "other");
});

test("switching exposure shows only that choice's fields, keeps the hidden values out of the record, and brings them back", () => {
  const bounded = { exposure: { kind: "BOUNDED", allowance: "100", stopThreshold: "80" }, maxTotalCost: "200" };
  const toNone = chooseExposure(bounded, EMPTY_HIDDEN, "none");
  assert.deepEqual(toNone.values, { exposure: undefined, maxTotalCost: undefined });
  const toNa = chooseExposure({}, toNone.hidden, "NOT_APPLICABLE");
  assert.deepEqual(toNa.values, { exposure: { kind: "NOT_APPLICABLE", justification: "" }, maxTotalCost: undefined });
  const back = chooseExposure({ exposure: { kind: "NOT_APPLICABLE", justification: "no model" } }, toNa.hidden, "BOUNDED");
  assert.deepEqual(back.values, bounded);
  const again = chooseExposure(bounded, back.hidden, "NOT_APPLICABLE");
  assert.deepEqual(again.values.exposure, { kind: "NOT_APPLICABLE", justification: "no model" });
  const fresh = chooseExposure({}, EMPTY_HIDDEN, "BOUNDED");
  assert.deepEqual(fresh.values, { exposure: { kind: "BOUNDED", allowance: "", stopThreshold: "" }, maxTotalCost: "" });
});

test("80% of the allowance is exact for any size, rounds down and is at least 1", () => {
  assert.equal(eightyPercent("1000"), "800");
  assert.equal(eightyPercent("999"), "799");
  assert.equal(eightyPercent("1"), "1");
  assert.equal(eightyPercent("123456789012345678901234567890"), "98765431209876543120987654312");
  for (const bad of ["", "0", "01", "-5", "1.5", "abc"]) assert.equal(eightyPercent(bad), null, bad);
});

// --- the stage strip ---------------------------------------------------------------------

const labels = (t: Record<string, unknown>) =>
  templateStages(t as never).map((s) => `${s.label}${s.muted ? " (off)" : ""}${s.loop ? " ↺" : ""}${s.reapprove ? " +approve" : ""}`);

test("with no corrections the strip runs straight through and the correction stage is muted", () => {
  assert.deepEqual(labels({ maxCorrections: 0, reapproveCorrections: false }), [
    "Approve",
    "Implementation",
    "Validation",
    "Correction (off)",
    "Acceptance",
  ]);
});

test("with corrections the strip loops back to validation, marked when each correction is approved again", () => {
  assert.deepEqual(labels({ maxCorrections: 2, reapproveCorrections: true }), [
    "Approve",
    "Implementation",
    "Validation",
    "Correction ↺ +approve",
    "Acceptance",
  ]);
  const correction = templateStages({ maxCorrections: 2 }).find((s) => s.key === "correction");
  assert.equal(correction?.detail, "up to 2, then validation again");
  assert.equal(templateStages({ maxCorrections: "x" }).find((s) => s.key === "correction")?.muted, true);
});
