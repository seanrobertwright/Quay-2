/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTriggerEdit,
  contractIdProblem,
  equalsText,
  isTriggerAction,
  isTriggerKind,
  newTriggerContent,
  parseEquals,
  triggerStepFor,
} from "./trigger.ts";
import { createDraft, createNewDraft, editTriggerDraft, hasDrafts, isDirty } from "./drafts.ts";
import { applyRename, changeDraft, EMPTY_SESSION, undoDraft, type BuilderSession } from "./session.ts";
import type { JsonObject } from "./model.ts";
import type { DefinitionFile } from "./types.ts";

// --- a new trigger ---------------------------------------------------------------------

test("a new trigger is a disabled MANUAL START_RUN with its smallest counts and no guessed time or contract", () => {
  const t = newTriggerContent("nightly");
  assert.equal(t.id, "nightly");
  assert.equal(t.kind, "MANUAL");
  assert.equal(t.action, "START_RUN");
  assert.equal(t.enabled, false);
  assert.equal(t.contractId, "");
  assert.equal(t.notBefore, "");
  assert.equal(t.expiresAt, "");
  assert.deepEqual([t.maxConcurrent, t.rateLimit, t.rateWindowMs], ["1", "1", "1"]);
  assert.deepEqual([t.maxAgeMs, t.maxDepth], ["0", "0"]);
  assert.equal(typeof t.revision, "string");
  for (const key of ["schedule", "filter", "conditionMode", "waitId"]) assert.ok(!(key in t), key);
});

// --- fields that follow the kind and the action -----------------------------------------

const manual = () => newTriggerContent("t");

test("making a trigger SCHEDULED adds a schedule, and any other kind removes it", () => {
  const scheduled = applyTriggerEdit(manual(), { type: "set-kind", kind: "SCHEDULED" });
  assert.equal(scheduled.kind, "SCHEDULED");
  assert.deepEqual(scheduled.schedule, { startMs: "", intervalMs: "1", catchUp: "SKIP", maxCatchUp: "1" });
  const event = applyTriggerEdit(scheduled, { type: "set-kind", kind: "EVENT" });
  assert.ok(!("schedule" in event));
});

test("a schedule already there is kept when the kind is set to SCHEDULED again", () => {
  const custom = { ...manual(), kind: "EVENT", schedule: { startMs: "5", intervalMs: "60000", catchUp: "ALL", maxCatchUp: "3" } };
  assert.deepEqual(applyTriggerEdit(custom, { type: "set-kind", kind: "SCHEDULED" }).schedule, custom.schedule);
});

test("making a trigger CONDITION adds a filter and a mode; leaving keeps the filter and drops the mode", () => {
  const condition = applyTriggerEdit(manual(), { type: "set-kind", kind: "CONDITION" });
  assert.deepEqual(condition.filter, { field: "", equals: "" });
  assert.equal(condition.conditionMode, "EDGE");
  const back = applyTriggerEdit(condition, { type: "set-kind", kind: "MANUAL" });
  assert.deepEqual(back.filter, { field: "", equals: "" });
  assert.ok(!("conditionMode" in back));
});

test("RESUME_WAIT adds an empty wait id, and START_RUN removes it", () => {
  const resume = applyTriggerEdit(manual(), { type: "set-action", action: "RESUME_WAIT" });
  assert.equal(resume.waitId, "");
  const start = applyTriggerEdit({ ...resume, waitId: "w1" }, { type: "set-action", action: "START_RUN" });
  assert.equal(start.action, "START_RUN");
  assert.ok(!("waitId" in start));
});

test("a field is set, removed with undefined, and a schedule or filter field is set inside its object", () => {
  const t = applyTriggerEdit(manual(), { type: "set-field", key: "source", value: "github" });
  assert.equal(t.source, "github");
  const withFilter = applyTriggerEdit(t, { type: "set-field", key: "filter", value: { field: "", equals: "" } });
  const filtered = applyTriggerEdit(withFilter, { type: "set-nested", key: "filter", field: "field", value: "status" });
  assert.deepEqual(filtered.filter, { field: "status", equals: "" });
  assert.ok(!("filter" in applyTriggerEdit(filtered, { type: "set-field", key: "filter", value: undefined })));
});

test("an edit that changes nothing returns the same record", () => {
  const t = manual();
  assert.equal(applyTriggerEdit(t, { type: "set-field", key: "kind", value: "MANUAL" }), t);
  assert.equal(applyTriggerEdit(t, { type: "set-kind", kind: "MANUAL" }), t);
  assert.equal(applyTriggerEdit(t, { type: "set-action", action: "START_RUN" }), t);
  assert.equal(applyTriggerEdit(t, { type: "set-field", key: "waitId", value: undefined }), t);
  assert.equal(applyTriggerEdit(t, { type: "set-nested", key: "schedule", field: "intervalMs", value: "5" }), t, "no schedule to set it in");
});

test("typing in a field merges into one undo step per field, and a choice is a step of its own", () => {
  assert.deepEqual(triggerStepFor({ type: "set-field", key: "source", value: "g", live: true }), {
    label: "Set source",
    merge: { key: "trigger|source" },
  });
  assert.deepEqual(triggerStepFor({ type: "set-nested", key: "schedule", field: "intervalMs", value: "5", live: true }), {
    label: "Set schedule.intervalMs",
    merge: { key: "trigger|schedule.intervalMs" },
  });
  assert.deepEqual(triggerStepFor({ type: "set-kind", kind: "EVENT" }), { label: "Set kind to EVENT" });
  assert.deepEqual(triggerStepFor({ type: "set-action", action: "RESUME_WAIT" }), { label: "Set action to RESUME_WAIT" });
});

test("only the SDK's kinds and actions can be picked", () => {
  assert.equal(isTriggerKind("SCHEDULED"), true);
  assert.equal(isTriggerKind("NOT A KIND"), false);
  assert.equal(isTriggerAction("RESUME_WAIT"), true);
  assert.equal(isTriggerAction(""), false);
});

// --- the contract picker and the filter's value -----------------------------------------

test("the contract may be one not made yet, but only a filename-safe id", () => {
  assert.equal(contractIdProblem(""), null, "empty is the SDK's to flag");
  assert.equal(contractIdProblem("not-made-yet"), null);
  assert.notEqual(contractIdProblem("../escape"), null);
});

test("a filter's value is any JSON, shown as JSON and refused when it doesn't parse", () => {
  assert.deepEqual(parseEquals('"done"'), { ok: true, value: "done" });
  assert.deepEqual(parseEquals(" 3 "), { ok: true, value: 3 });
  assert.deepEqual(parseEquals('{"a": [true, null]}'), { ok: true, value: { a: [true, null] } });
  assert.equal(parseEquals("").ok, false);
  assert.equal(parseEquals("done").ok, false);
  assert.equal(equalsText("done"), '"done"');
  assert.equal(equalsText(undefined), "");
});

// --- drafts ----------------------------------------------------------------------------

const tref = { kind: "triggers", id: "t" } as const;
const triggerFile = (content: JsonObject | undefined): DefinitionFile => ({ id: "t", kind: "triggers", missing: false, contentHash: "h1", content });

test("a trigger opens as a clean draft, even one the SDK refuses, and only an object opens", () => {
  assert.equal(hasDrafts("triggers"), true);
  const created = createDraft(tref, triggerFile({ id: "t", kind: "NOT A KIND" }));
  assert.ok(created.ok);
  assert.equal(created.value.bindings, null);
  assert.equal(isDirty(created.value), false);
  assert.equal(createDraft(tref, triggerFile(undefined)).ok, false);
});

test("changing a new trigger's kind is one undo step that takes its schedule with it", () => {
  const created = createNewDraft(tref, newTriggerContent("t"));
  assert.ok(created.ok);
  const draft = created.value;
  let session: BuilderSession = { ...EMPTY_SESSION, open: tref, drafts: { "triggers/t": draft } };
  session = changeDraft(session, tref, (d) => editTriggerDraft(d, { type: "set-kind", kind: "SCHEDULED" }), triggerStepFor({ type: "set-kind", kind: "SCHEDULED" }), 0);
  assert.ok(session.drafts["triggers/t"].content.schedule);
  const undone = undoDraft(session, tref);
  assert.ok(undone);
  assert.equal(undone.label, "Set kind to SCHEDULED");
  assert.equal(undone.session.drafts["triggers/t"].content, draft.content);
});

test("renaming a contract rewrites an open trigger draft's contractId as the backend returns it", () => {
  const created = createNewDraft(tref, { ...newTriggerContent("t"), contractId: "c1" });
  assert.ok(created.ok);
  const session: BuilderSession = { ...EMPTY_SESSION, drafts: { "triggers/t": created.value } };
  const rewritten = { ...created.value.content, contractId: "c2" };
  const after = applyRename(session, { kind: "contracts", id: "c1" }, "c2", {
    changes: [],
    unchecked: [],
    drafts: [{ kind: "triggers", id: "t", content: rewritten }],
    done: ["Wrote .praxis/contracts/c2.json"],
  });
  assert.equal(after.drafts["triggers/t"].content.contractId, "c2");
});
