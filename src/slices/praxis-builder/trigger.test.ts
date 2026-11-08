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
import { createDraft, createNewDraft, editTriggerDraft, hasDrafts, isDirty, markSaved, reconcileWithDisk } from "./drafts.ts";
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

// --- the Starts target (#472) ----------------------------------------------------------

const targetedFile = (graphWorkflow: string): DefinitionFile => ({
  ...triggerFile({ id: "t", contractId: "c" }),
  target: { version: 1, graphWorkflow },
  targetHash: "th1",
});

/** A saved trigger draft that starts graph workflow `ship`, after an edit that leaves it dirty. */
function dirtyTargeted() {
  const created = createDraft(tref, targetedFile("ship"));
  assert.ok(created.ok);
  return editTriggerDraft(created.value, { type: "set-field", key: "source", value: "github" });
}

test("a trigger opens with the target its target file names, and setting another makes it dirty until set back", () => {
  const created = createDraft(tref, targetedFile("ship"));
  assert.ok(created.ok);
  const draft = created.value;
  assert.equal(draft.target, "ship");
  assert.equal(draft.baseTargetHash, "th1");
  assert.equal(isDirty(draft), false);
  const other = editTriggerDraft(draft, { type: "set-target", target: "review" });
  assert.equal(isDirty(other), true);
  assert.equal(other.content, draft.content, "the trigger's record is untouched");
  assert.equal(isDirty(editTriggerDraft(other, { type: "set-target", target: "ship" })), false);
  // A target file that names no graph workflow opens as none.
  const odd = createDraft(tref, { ...targetedFile("x"), target: { version: 1, graphWorkflow: 3 } });
  assert.ok(odd.ok);
  assert.equal(odd.value.target, null);
});

test("setting the target is one undo step with the contract it fills", () => {
  const created = createNewDraft(tref, newTriggerContent("t"));
  assert.ok(created.ok);
  const edit = { type: "set-target", target: "ship", contractId: "c" } as const;
  let session: BuilderSession = { ...EMPTY_SESSION, open: tref, drafts: { "triggers/t": created.value } };
  session = changeDraft(session, tref, (d) => editTriggerDraft(d, edit), triggerStepFor(edit), 0);
  assert.equal(session.drafts["triggers/t"].target, "ship");
  assert.equal(session.drafts["triggers/t"].content.contractId, "c");
  const undone = undoDraft(session, tref);
  assert.ok(undone);
  assert.equal(undone.label, "Set the Starts target");
  assert.equal(undone.session.drafts["triggers/t"].target, null);
  assert.equal(undone.session.drafts["triggers/t"].content.contractId, "");
});

test("a save makes the target sent the new base, and one the save couldn't write keeps the draft dirty", () => {
  const draft = editTriggerDraft(dirtyTargeted(), { type: "set-target", target: "review" });
  const sent = { content: draft.content, layout: null, target: { graphWorkflow: "review" } };
  const saved = markSaved(draft, { content: draft.content, contentHash: "h2", targetHash: "th2" }, sent);
  assert.equal(isDirty(saved), false);
  assert.equal(saved.baseTargetHash, "th2");
  const cleared = editTriggerDraft(saved, { type: "set-target", target: null });
  const removed = markSaved(cleared, { content: cleared.content, contentHash: "h2" }, { ...sent, target: { graphWorkflow: null } });
  assert.equal(isDirty(removed), false);
  assert.equal(removed.baseTargetHash, null);
  const failed = markSaved(draft, { content: draft.content, contentHash: "h2", targetError: "disk full" }, sent);
  assert.equal(isDirty(failed), true);
  assert.equal(failed.baseTargetHash, "th1");
});

test("a target file changed on disk reloads a clean trigger draft", () => {
  const created = createDraft(tref, targetedFile("ship"));
  assert.ok(created.ok);
  assert.equal(reconcileWithDisk(created.value, targetedFile("ship")).action, "keep");
  assert.equal(reconcileWithDisk(created.value, { ...targetedFile("other"), targetHash: "th9" }).action, "reload");
});

test("renaming a graph workflow rewrites a dirty trigger draft's target and expects the rewritten file", () => {
  const session: BuilderSession = { ...EMPTY_SESSION, drafts: { "triggers/t": dirtyTargeted() } };
  const after = applyRename(session, { kind: "graph-workflows", id: "ship" }, "ship-it", {
    changes: [{ path: ".praxis/trigger-targets/t.json", hashes: { previous: "th1", next: "th2" } }],
    unchecked: [],
    drafts: [],
    done: ["Rewrote .praxis/trigger-targets/t.json"],
  });
  const t = after.drafts["triggers/t"];
  assert.equal(t.target, "ship-it");
  assert.equal(t.baseTargetHash, "th2");
  assert.equal(t.content.source, "github", "the unsaved edit stays");
});

test("renaming a graph workflow drops a clean trigger draft whose target file it rewrote, so it reloads", () => {
  const created = createDraft(tref, targetedFile("ship"));
  assert.ok(created.ok);
  const session: BuilderSession = { ...EMPTY_SESSION, drafts: { "triggers/t": created.value } };
  const after = applyRename(session, { kind: "graph-workflows", id: "ship" }, "ship-it", {
    changes: [{ path: ".praxis/trigger-targets/t.json", hashes: { previous: "th1", next: "th2" } }],
    unchecked: [],
    drafts: [],
    done: ["Rewrote .praxis/trigger-targets/t.json"],
  });
  assert.equal(after.drafts["triggers/t"], undefined);
});

test("renaming a graph workflow rewrites an unsaved trigger draft's target, and another kind's rename leaves it", () => {
  const created = createNewDraft(tref, newTriggerContent("t"));
  assert.ok(created.ok);
  const unsaved = editTriggerDraft(created.value, { type: "set-target", target: "ship" });
  const session: BuilderSession = { ...EMPTY_SESSION, drafts: { "triggers/t": unsaved } };
  const none = { changes: [], unchecked: [], drafts: [], done: ["Wrote"] };
  assert.equal(applyRename(session, { kind: "graph-workflows", id: "ship" }, "ship-it", none).drafts["triggers/t"].target, "ship-it");
  assert.equal(applyRename(session, { kind: "contracts", id: "ship" }, "other", none).drafts["triggers/t"].target, "ship");
});
