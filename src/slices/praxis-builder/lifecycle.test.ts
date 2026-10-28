/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphDraft, createNewGraphDraft, isDirty, moveNodes, reconcileWithDisk, type GraphDraft } from "./drafts.ts";
import { parseGraph } from "./model.ts";
import { definitionIdProblem, idProblem, MAX_DEFINITION_ID, newGraphContent, nextDefinitionId } from "./lifecycle.ts";
import {
  addNewDraft,
  applyRename,
  changeGraph,
  definitionKey,
  EMPTY_SESSION,
  removeDefinition,
  renameUnsavedDraft,
  type BuilderSession,
} from "./session.ts";
import type { RenameOutcome } from "./types.ts";

// --- the id rule: the same cases as `validate_id` in store.rs --------------------------

test("filename-safe ids are accepted", () => {
  for (const id of ["ship-feature", "a", "Graph_2.v1", "x.", "con-x", "CONSOLE", "com10", "a".repeat(MAX_DEFINITION_ID)]) {
    assert.equal(idProblem(id), null, id);
  }
});

test("empty, long and leading-dot ids are refused", () => {
  for (const id of ["", "a".repeat(MAX_DEFINITION_ID + 1), ".hidden", ".", ".."]) {
    assert.notEqual(idProblem(id), null, id);
  }
});

test("characters outside the safe set are refused", () => {
  for (const id of ["a b", "a/b", "a\\b", "c:x", "a*", "é", "a\0", "../x", "a\nb"]) {
    assert.notEqual(idProblem(id), null, JSON.stringify(id));
  }
});

test("Windows reserved names are refused with or without an extension", () => {
  for (const id of ["CON", "con", "Prn", "AUX", "nul", "nul.x", "COM1", "com9.json", "LPT1", "lpt0", "COM0"]) {
    assert.notEqual(idProblem(id), null, id);
  }
});

test("an id taken ignoring case is refused, except the definition's own", () => {
  const taken = ["Ship", "build"];
  assert.match(definitionIdProblem("ship", taken) ?? "", /taken/);
  assert.match(definitionIdProblem("BUILD", taken) ?? "", /taken/);
  assert.equal(definitionIdProblem("other", taken), null);
  assert.equal(definitionIdProblem("SHIP", taken, "Ship"), null, "a case-only rename of itself");
  assert.match(definitionIdProblem("a b", taken) ?? "", /letters/);
});

test("a new id is the prefix and the smallest number free ignoring case", () => {
  assert.equal(nextDefinitionId("graph", []), "graph-1");
  assert.equal(nextDefinitionId("graph", ["graph-1", "GRAPH-2", "graph-4"]), "graph-3");
});

// --- new drafts --------------------------------------------------------------------------

const ref = { kind: "graphs" as const, id: "graph-1" };

function newDraft(): GraphDraft {
  const result = createNewGraphDraft(ref, newGraphContent(ref.id));
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

test("a new graph has its id and a single END node, and the canvas can draw it", () => {
  const content = newGraphContent("graph-1");
  assert.equal(content.id, "graph-1");
  const graph = parseGraph(content);
  assert.ok(graph.ok);
  assert.deepEqual(
    graph.value.nodes.map((n) => [n.id, n.kind]),
    [["end-1", "END"]]
  );
});

test("a new draft is unsaved, with no file to expect, and placed", () => {
  const draft = newDraft();
  assert.equal(isDirty(draft), true);
  assert.equal(draft.baseHash, null);
  assert.ok(draft.positions.has("end-1"));
});

test("a new draft whose file doesn't exist yet isn't marked deleted on disk", () => {
  const decision = reconcileWithDisk(newDraft(), { id: ref.id, kind: "graphs", missing: true });
  assert.equal(decision.action, "keep");
  assert.equal(decision.action === "keep" && decision.draft.deletedOnDisk, false);
});

test("adding a new draft opens it", () => {
  const session = addNewDraft(EMPTY_SESSION, ref, newDraft());
  assert.deepEqual(session.open, ref);
  assert.equal(session.drafts[definitionKey(ref)].ref, ref);
});

// --- renaming in the session -------------------------------------------------------------

test("renaming an unsaved draft rekeys it, sets its id and clears its history", () => {
  let session = addNewDraft(EMPTY_SESSION, ref, newDraft());
  session = changeGraph(session, ref, (d) => moveNodes(d, [["end-1", { x: 9, y: 9 }]]), { label: "Move" }, 1);
  session = { ...session, viewports: { [definitionKey(ref)]: { x: 1, y: 1, zoom: 1 } } };
  const to = { kind: "graphs" as const, id: "ship" };
  const next = renameUnsavedDraft(session, ref, to.id);
  const draft = next.drafts[definitionKey(to)];
  assert.equal(draft.content.id, "ship");
  assert.deepEqual(draft.ref, to);
  assert.equal(draft.positions.get("end-1")?.x, 9);
  assert.equal(next.drafts[definitionKey(ref)], undefined);
  assert.deepEqual(next.histories, {});
  assert.deepEqual(next.open, to);
  assert.deepEqual(next.viewports, { [definitionKey(to)]: { x: 1, y: 1, zoom: 1 } });
});

function savedDraft(id: string, hash: string): GraphDraft {
  const result = createGraphDraft(
    { kind: "graphs", id },
    { id, kind: "graphs", missing: false, contentHash: hash, content: { id, revision: "r", nodes: [{ id: "end-1", kind: "END", dependsOn: [], config: {} }] } }
  );
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

const noOutcome: RenameOutcome = { changes: [], unchecked: [], drafts: [], done: [] };

test("a rename drops the renamed definition's draft and history and opens the new id", () => {
  const g = { kind: "graphs" as const, id: "g" };
  let session: BuilderSession = { ...EMPTY_SESSION, open: g, drafts: { "graphs/g": savedDraft("g", "h1") } };
  session = changeGraph(session, g, (d) => moveNodes(d, [["end-1", { x: 9, y: 9 }]]), { label: "Move" }, 1);
  session = changeGraph(session, g, (d) => moveNodes(d, [["end-1", { x: 0, y: 0 }]]), { label: "Move" }, 2);
  session = { ...session, viewports: { "graphs/g": { x: 1, y: 2, zoom: 1 } } };
  const next = applyRename(session, g, "h", noOutcome);
  assert.deepEqual(next.drafts, {}, "the new file is read again");
  assert.deepEqual(next.histories, {});
  assert.deepEqual(next.open, { kind: "graphs", id: "h" });
  assert.deepEqual(next.viewports, { "graphs/h": { x: 1, y: 2, zoom: 1 } });
});

test("a rename rewrites dirty drafts that refer to it and expects their rewritten files", () => {
  const g = { kind: "graphs" as const, id: "g" };
  const other = { kind: "graphs" as const, id: "o" };
  const clean = { kind: "graphs" as const, id: "c" };
  let session: BuilderSession = {
    ...EMPTY_SESSION,
    open: other,
    drafts: { "graphs/o": savedDraft("o", "o1"), "graphs/c": savedDraft("c", "c1") },
  };
  session = changeGraph(session, other, (d) => moveNodes(d, [["end-1", { x: 9, y: 9 }]]), { label: "Move" }, 1);
  session = changeGraph(session, clean, (d) => moveNodes(d, [["end-1", { x: 9, y: 9 }]]), { label: "Move" }, 1);
  session = { ...session, drafts: { ...session.drafts, "graphs/c": savedDraft("c", "c1") } };
  const rewritten = { ...session.drafts["graphs/o"].content, refersTo: "h" };
  const outcome: RenameOutcome = {
    ...noOutcome,
    changes: [
      { path: ".praxis/graphs/o.json", hashes: { previous: "o1", next: "o2" } },
      { path: ".praxis/graphs/c.json", hashes: { previous: "c1", next: "c2" } },
    ],
    drafts: [
      { kind: "graphs", id: "o", content: rewritten },
      { kind: "graphs", id: "c", content: { ...session.drafts["graphs/c"].content, refersTo: "h" } },
    ],
  };
  const next = applyRename(session, g, "h", outcome);
  const o = next.drafts["graphs/o"];
  assert.deepEqual(o.content, rewritten);
  assert.equal(o.baseHash, "o2");
  assert.equal(isDirty(o), true);
  assert.equal(next.drafts["graphs/c"], undefined, "a clean draft reloads its rewritten file");
  assert.deepEqual(next.histories, {}, "the histories it touched are cleared");
  assert.deepEqual(next.open, other);
});

test("a rewritten file whose draft had already changed on disk keeps the draft's expected hash", () => {
  const g = { kind: "graphs" as const, id: "g" };
  const other = { kind: "graphs" as const, id: "o" };
  let session: BuilderSession = { ...EMPTY_SESSION, drafts: { "graphs/o": savedDraft("o", "stale") } };
  session = changeGraph(session, other, (d) => moveNodes(d, [["end-1", { x: 9, y: 9 }]]), { label: "Move" }, 1);
  const outcome: RenameOutcome = {
    ...noOutcome,
    changes: [{ path: ".praxis/graphs/o.json", hashes: { previous: "o1", next: "o2" } }],
  };
  assert.equal(applyRename(session, g, "h", outcome).drafts["graphs/o"].baseHash, "stale");
});

// --- deleting from the session -----------------------------------------------------------

test("deleting drops the definition's draft, history and viewport, and closes it", () => {
  const g = { kind: "graphs" as const, id: "g" };
  let session: BuilderSession = {
    ...EMPTY_SESSION,
    open: g,
    drafts: { "graphs/g": savedDraft("g", "h1"), "graphs/k": savedDraft("k", "k1") },
    viewports: { "graphs/g": { x: 0, y: 0, zoom: 1 } },
  };
  session = changeGraph(session, g, (d) => moveNodes(d, [["end-1", { x: 9, y: 9 }]]), { label: "Move" }, 1);
  const next = removeDefinition(session, g);
  assert.deepEqual(Object.keys(next.drafts), ["graphs/k"]);
  assert.deepEqual(next.histories, {});
  assert.deepEqual(next.viewports, {});
  assert.equal(next.open, null);
  assert.deepEqual(removeDefinition(session, { kind: "graphs", id: "k" }).open, g, "another definition stays open");
});
