/// <reference types="node" />
// The graph workflow record's rules (#459): its group in the definitions list, a new one's
// record, its draft and its edits' undo steps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDraft, createNewDraft, editGraphWorkflowDraft, isDirty, withId } from "./drafts.ts";
import { applyGraphWorkflowEdit, graphWorkflowStepFor, newGraphWorkflowContent } from "./graphWorkflow.ts";
import { RECORD_KINDS } from "./kinds.ts";
import { hostNameProblem, nextDefinitionId } from "./lifecycle.ts";
import { applyDiskRead, changeDraft, definitionKey, EMPTY_SESSION, undoDraft } from "./session.ts";

test("graph workflows are listed as Graph workflows, after templates, and the builder creates them", () => {
  const kinds = RECORD_KINDS.map((k) => k.kind);
  assert.equal(kinds.indexOf("graph-workflows"), kinds.indexOf("templates") + 1);
  const entry = RECORD_KINDS.find((k) => k.kind === "graph-workflows");
  assert.equal(entry?.label, "Graph workflows");
  assert.equal(entry?.singular, "graph workflow");
  assert.ok(entry?.newRecord);
  // A new one's name starts from a prefix the host's rule accepts.
  const first = nextDefinitionId(entry?.idPrefix ?? entry?.singular ?? "", []);
  assert.equal(first, "graph-workflow-1");
  assert.equal(hostNameProblem("graph-workflows", first), null);
});

test("a new graph workflow names nothing yet and holds no id", () => {
  assert.deepEqual(newGraphWorkflowContent(), { version: 1, contractId: "", graphId: "", graphBindingId: "" });
});

test("a graph workflow opens as a clean draft, a new one is dirty, and a rename puts no id inside", () => {
  const ref = { kind: "graph-workflows" as const, id: "a" };
  const content = { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" };
  const opened = createDraft(ref, { id: "a", kind: "graph-workflows", missing: false, content, contentHash: "h" });
  assert.ok(opened.ok);
  assert.equal(isDirty(opened.value), false);
  const fresh = createNewDraft(ref, newGraphWorkflowContent());
  assert.ok(fresh.ok);
  assert.equal(isDirty(fresh.value), true);
  const renamed = withId(opened.value, { kind: "graph-workflows", id: "b" });
  assert.deepEqual(renamed.content, content);
  assert.equal(renamed.ref.id, "b");
});

test("setting a reference makes the draft dirty, and setting it back makes it clean", () => {
  const ref = { kind: "graph-workflows" as const, id: "a" };
  const content = { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" };
  const opened = createDraft(ref, { id: "a", kind: "graph-workflows", missing: false, content, contentHash: "h" });
  assert.ok(opened.ok);
  const edited = editGraphWorkflowDraft(opened.value, { type: "set-field", key: "graphId", value: "h" });
  assert.equal(edited.content.graphId, "h");
  assert.equal(isDirty(edited), true);
  const back = editGraphWorkflowDraft(edited, { type: "set-field", key: "graphId", value: "g" });
  assert.equal(isDirty(back), false);
  assert.equal(editGraphWorkflowDraft(opened.value, { type: "set-field", key: "graphId", value: "g" }), opened.value, "no change, same draft");
});

test("typing a reference merges into one undo step; a pick is a step of its own", () => {
  assert.deepEqual(graphWorkflowStepFor({ type: "set-field", key: "contractId", value: "c", live: true }), {
    label: "Set contract",
    merge: { key: "graph-workflow|contractId" },
  });
  assert.deepEqual(graphWorkflowStepFor({ type: "set-field", key: "graphBindingId", value: "b" }), { label: "Set graph binding" });
  assert.deepEqual(applyGraphWorkflowEdit({ graphId: "g" }, { type: "set-field", key: "graphId", value: "h" }), { graphId: "h" });
});

test("an edit is a step of the draft's own history, which undo takes back to the clean file", () => {
  const ref = { kind: "graph-workflows" as const, id: "ship" };
  const content = { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" };
  const loaded = applyDiskRead(EMPTY_SESSION, ref, { id: "ship", kind: "graph-workflows", missing: false, content, contentHash: "h" });
  const edit = { type: "set-field" as const, key: "contractId", value: "d" };
  const edited = changeDraft(loaded, ref, (d) => editGraphWorkflowDraft(d, edit), graphWorkflowStepFor(edit), 1);
  assert.equal(isDirty(edited.drafts[definitionKey(ref)]), true);
  const undone = undoDraft(edited, ref);
  assert.equal(undone?.label, "Set contract");
  assert.deepEqual(undone?.session.drafts[definitionKey(ref)].content, content);
  assert.equal(isDirty(undone!.session.drafts[definitionKey(ref)]), false);
});
