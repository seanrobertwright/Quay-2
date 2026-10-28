/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphDraft, isDirty, markSaved, moveNodes, withChanges, type Draft } from "./drafts.ts";
import { applyBindingEdit, newBindingContent } from "./graphBinding.ts";
import { editDraft, type GraphEdit } from "./editor.ts";
import type { JsonObject } from "./model.ts";
import type { DefinitionFile } from "./types.ts";
import {
  applyDiskRead,
  applyRename,
  changeDraft,
  chooseBinding,
  chosenBinding,
  definitionKey,
  dirtyDrafts,
  dirtyProjectKeys,
  dropDraft,
  editGraph,
  EMPTY_SESSION,
  endDraftMerge,
  forgetHistories,
  graphBindingDrafts,
  redoDraft,
  removeDefinition,
  sessionFor,
  undoDraft,
  updateSession,
  type Sessions,
} from "./session.ts";

test("a project with no session yet gets an empty one", () => {
  assert.deepEqual(sessionFor(new Map(), "E:\\Projects\\A"), EMPTY_SESSION);
});

test("each project keeps its own session", () => {
  let sessions: Sessions = new Map();
  sessions = updateSession(sessions, "E:\\Projects\\A", (s) => ({ ...s, open: { kind: "graphs", id: "ship" } }));
  sessions = updateSession(sessions, "E:\\Projects\\B", (s) => ({ ...s, open: { kind: "grants", id: "budget" } }));
  assert.deepEqual(sessionFor(sessions, "E:\\Projects\\A").open, { kind: "graphs", id: "ship" });
  assert.deepEqual(sessionFor(sessions, "E:\\Projects\\B").open, { kind: "grants", id: "budget" });
});

test("updating a session leaves the old map and other projects untouched", () => {
  const before: Sessions = updateSession(new Map(), "E:\\A", (s) => ({ ...s, open: { kind: "graphs", id: "g" } }));
  const after = updateSession(before, "E:\\B", (s) => ({ ...s, open: { kind: "triggers", id: "t" } }));
  assert.equal(before.size, 1);
  assert.equal(after.size, 2);
  assert.equal(sessionFor(after, "E:\\A"), sessionFor(before, "E:\\A"));
});

test("one folder written two ways is one project", () => {
  const sessions = updateSession(new Map(), "E:\\Projects\\A\\", (s) => ({ ...s, open: { kind: "graphs", id: "g" } }));
  assert.deepEqual(sessionFor(sessions, "e:/Projects/A").open, { kind: "graphs", id: "g" });
});

test("viewports are kept per definition", () => {
  let sessions: Sessions = new Map();
  const g = definitionKey({ kind: "graphs", id: "g" });
  const h = definitionKey({ kind: "graphs", id: "h" });
  sessions = updateSession(sessions, "E:\\A", (s) => ({ ...s, viewports: { ...s.viewports, [g]: { x: 1, y: 2, zoom: 0.5 } } }));
  sessions = updateSession(sessions, "E:\\A", (s) => ({ ...s, viewports: { ...s.viewports, [h]: { x: 3, y: 4, zoom: 1 } } }));
  assert.deepEqual(sessionFor(sessions, "E:\\A").viewports[g], { x: 1, y: 2, zoom: 0.5 });
  assert.deepEqual(sessionFor(sessions, "E:\\A").viewports[h], { x: 3, y: 4, zoom: 1 });
  assert.notEqual(definitionKey({ kind: "graphs", id: "g" }), definitionKey({ kind: "grants", id: "g" }));
});

function graphDraft(id: string): Draft {
  const result = createGraphDraft(
    { kind: "graphs", id },
    { id, kind: "graphs", missing: false, contentHash: "h", content: { id, nodes: [{ id: "end-1", kind: "END" }] } }
  );
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

test("dirty drafts are found in every project, and only dirty ones", () => {
  const clean = graphDraft("clean");
  const dirty = moveNodes(graphDraft("dirty"), [["end-1", { x: 500, y: 500 }]]);
  let sessions: Sessions = new Map();
  sessions = updateSession(sessions, "E:\A", (s) => ({ ...s, name: "A", drafts: { "graphs/clean": clean } }));
  sessions = updateSession(sessions, "E:\B", (s) => ({ ...s, name: "B", drafts: { "graphs/dirty": dirty, "graphs/clean": clean } }));
  const found = dirtyDrafts(sessions);
  assert.equal(found.length, 1);
  assert.equal(found[0].projectName, "B");
  assert.equal(found[0].draft, dirty);
  assert.deepEqual(dirtyProjectKeys(sessions), [found[0].projectPath]);
});

const ship = { kind: "graphs" as const, id: "ship" };
const shipFile = (hash: string, x = 0): DefinitionFile => ({
  id: "ship",
  kind: "graphs",
  missing: false,
  contentHash: hash,
  content: { id: "ship", nodes: [{ id: "end-1", kind: "END" }] },
  layout: { version: 1, nodes: { "end-1": { x, y: 0 } }, viewport: { x: 5, y: 6, zoom: 0.75 } },
});

test("the first read of a graph makes a clean draft and takes the layout's viewport", () => {
  const session = applyDiskRead(EMPTY_SESSION, ship, shipFile("h1"));
  const draft = session.drafts["graphs/ship"];
  assert.equal(draft.baseHash, "h1");
  assert.deepEqual(session.viewports["graphs/ship"], { x: 5, y: 6, zoom: 0.75 });
});

test("a viewport the session already has wins over the layout's", () => {
  const start = { ...EMPTY_SESSION, viewports: { "graphs/ship": { x: 1, y: 1, zoom: 1 } } };
  assert.deepEqual(applyDiskRead(start, ship, shipFile("h1")).viewports["graphs/ship"], { x: 1, y: 1, zoom: 1 });
});

test("reading the same file again keeps the session as it is", () => {
  const session = applyDiskRead(EMPTY_SESSION, ship, shipFile("h1"));
  assert.equal(applyDiskRead(session, ship, shipFile("h1")), session);
});

test("a changed file replaces a clean draft and keeps a dirty one", () => {
  const session = applyDiskRead(EMPTY_SESSION, ship, shipFile("h1"));
  const reloaded = applyDiskRead(session, ship, shipFile("h2", 300));
  assert.equal(reloaded.drafts["graphs/ship"].baseHash, "h2");
  assert.deepEqual(reloaded.drafts["graphs/ship"].positions.get("end-1"), { x: 300, y: 0 });

  const dirty = { ...session, drafts: { "graphs/ship": moveNodes(session.drafts["graphs/ship"], [["end-1", { x: 9, y: 9 }]]) } };
  const kept = applyDiskRead(dirty, ship, shipFile("h2", 300));
  assert.equal(kept.drafts["graphs/ship"], dirty.drafts["graphs/ship"]);
});

test("a deleted file marks the draft, and a missing file with no draft makes none", () => {
  const missing: DefinitionFile = { id: "ship", kind: "graphs", missing: true };
  const session = applyDiskRead(EMPTY_SESSION, ship, shipFile("h1"));
  assert.equal(applyDiskRead(session, ship, missing).drafts["graphs/ship"].deletedOnDisk, true);
  assert.equal(applyDiskRead(EMPTY_SESSION, ship, missing), EMPTY_SESSION);
});

test("a file that turned unreadable drops a clean draft so its problem shows", () => {
  const session = applyDiskRead(EMPTY_SESSION, ship, shipFile("h1"));
  const broken: DefinitionFile = { id: "ship", kind: "graphs", missing: false, contentHash: "h3", problem: { message: "Not valid JSON" } };
  assert.equal(applyDiskRead(session, ship, broken).drafts["graphs/ship"], undefined);
});

test("dropping a draft leaves the rest of the session", () => {
  const session = applyDiskRead(EMPTY_SESSION, ship, shipFile("h1"));
  const dropped = dropDraft(session, ship);
  assert.equal(dropped.drafts["graphs/ship"], undefined);
  assert.deepEqual(dropped.viewports, session.viewports);
  assert.equal(dropDraft(dropped, ship), dropped);
});

// Undo history of a graph workspace (#248).

const opened = () => applyDiskRead(EMPTY_SESSION, ship, shipFile("h1"));
const edit = (e: GraphEdit) => (d: Draft) => editDraft(d, e);
const shipDraft = (s: { drafts: Record<string, Draft> }) => s.drafts["graphs/ship"];
const nodeIdsOf = (d: Draft) => (d.content.nodes as { id: string }[]).map((n) => n.id);

test("an edit is one step, and undo and redo put the draft back and forth", () => {
  const start = opened();
  const added = changeDraft(start, ship, edit({ type: "add-node", id: "task-1", kind: "TASK", position: { x: 0, y: 200 } }), { label: "Add task-1" }, 0);
  assert.deepEqual(nodeIdsOf(shipDraft(added)), ["end-1", "task-1"]);

  const undone = undoDraft(added, ship)!;
  assert.equal(undone.label, "Add task-1");
  assert.deepEqual(nodeIdsOf(shipDraft(undone.session)), ["end-1"]);
  assert.equal(isDirty(shipDraft(undone.session)), false, "undoing back to the loaded state is clean");

  const redone = redoDraft(undone.session, ship)!;
  assert.deepEqual(nodeIdsOf(shipDraft(redone.session)), ["end-1", "task-1"]);
  assert.deepEqual(redone.changed, ["task-1"], "redo selects the node the step added");
  assert.equal(redoDraft(redone.session, ship), null);
});

test("a change that changes nothing, such as a drag dropped where it began, records no step", () => {
  const start = opened();
  const at = shipDraft(start).positions.get("end-1")!;
  const moved = changeDraft(start, ship, (d) => moveNodes(d, [["end-1", at]]), { label: "Move" }, 0);
  assert.equal(moved, start);
  assert.equal(undoDraft(moved, ship), null);
});

test("undo selects the nodes the step changed that still exist", () => {
  let s = opened();
  s = changeDraft(s, ship, edit({ type: "add-node", id: "task-1", kind: "TASK", position: { x: 0, y: 200 } }), { label: "Add" }, 0);
  s = changeDraft(s, ship, edit({ type: "connect", source: "task-1", target: "end-1" }), { label: "Connect" }, 1);
  s = changeDraft(s, ship, (d) => moveNodes(d, [["task-1", { x: 50, y: 50 }]]), { label: "Move" }, 2);
  assert.deepEqual(undoDraft(s, ship)!.changed, ["task-1"]);

  s = undoDraft(s, ship)!.session;
  assert.deepEqual(undoDraft(s, ship)!.changed, ["end-1"], "undoing the connection selects the node whose dependsOn changed");

  s = undoDraft(s, ship)!.session;
  assert.deepEqual(undoDraft(s, ship)!.changed, [], "undoing an add leaves nothing to select");
});

test("live typing in one field merges until the merge ends", () => {
  let s = changeDraft(opened(), ship, edit({ type: "add-node", id: "loop-1", kind: "LOOP", position: { x: 0, y: 200 } }), { label: "Add" }, 0);
  const typing = { label: "Edit maxIterations", merge: { key: "loop-1|config.maxIterations" } };
  for (const value of ["1", "12", "123"]) {
    s = changeDraft(s, ship, edit({ type: "set-config", id: "loop-1", key: "maxIterations", value }), typing, 1);
  }
  s = endDraftMerge(s, ship);
  s = changeDraft(s, ship, edit({ type: "set-config", id: "loop-1", key: "maxIterations", value: "1234" }), typing, 2);
  assert.equal(s.histories["graphs/ship"].past.length, 3);
  s = undoDraft(s, ship)!.session;
  s = undoDraft(s, ship)!.session;
  const loop = (shipDraft(s).content.nodes as { id: string; config: { maxIterations: string } }[])[1];
  assert.equal(loop.config.maxIterations, "3", "two undos go back past all three keystrokes to the default");
});

test("save keeps the history, and undoing past the save makes the draft dirty again", () => {
  let s = changeDraft(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 40, y: 40 }]]), { label: "Move" }, 0);
  const d = shipDraft(s);
  const layout = { nodes: [{ id: "end-1", x: 40, y: 40 }], viewport: null };
  s = { ...s, drafts: { "graphs/ship": markSaved(d, { content: d.content, contentHash: "h2" }, { content: d.content, layout }) } };
  assert.equal(isDirty(shipDraft(s)), false);
  s = undoDraft(s, ship)!.session;
  assert.equal(isDirty(shipDraft(s)), true);
});

test("a quiet reload from disk clears the history, and a kept dirty draft keeps it", () => {
  const edited = changeDraft(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 40, y: 40 }]]), { label: "Move" }, 0);
  assert.notEqual(edited.histories["graphs/ship"], undefined);
  assert.equal(applyDiskRead(edited, ship, shipFile("h2")).histories["graphs/ship"], edited.histories["graphs/ship"]);

  const undone = undoDraft(edited, ship)!.session;
  const reloaded = applyDiskRead(undone, ship, shipFile("h2", 300));
  assert.equal(reloaded.histories["graphs/ship"], undefined);
});

test("dropping a draft, as Reload in the conflict prompt does, drops its history", () => {
  const edited = changeDraft(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 40, y: 40 }]]), { label: "Move" }, 0);
  assert.equal(dropDraft(edited, ship).histories["graphs/ship"], undefined);
});

test("removing a project forgets its histories but keeps its drafts", () => {
  let sessions: Sessions = new Map();
  sessions = updateSession(sessions, "E:\\A", () => changeDraft(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 1, y: 1 }]]), { label: "Move" }, 0));
  sessions = updateSession(sessions, "E:\\B", () => changeDraft(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 2, y: 2 }]]), { label: "Move" }, 0));
  const after = forgetHistories(sessions, ["e:/A/"]);
  assert.deepEqual(sessionFor(after, "E:\\A").histories, {});
  assert.notEqual(sessionFor(after, "E:\\A").drafts["graphs/ship"], undefined);
  assert.equal(sessionFor(after, "E:\\B"), sessionFor(sessions, "E:\\B"));
  assert.equal(forgetHistories(after, ["E:\\C"]), after);
});

// --- graph workspaces: a graph and its bindings share one history (#248, #273) ----------------


const workspaceGraph: JsonObject = {
  id: "g",
  revision: "r",
  nodes: [
    { id: "task-1", kind: "TASK", dependsOn: [], config: { executionKind: "AGENT" } },
    { id: "end-1", kind: "END", dependsOn: ["task-1"], config: {} },
  ],
};

function readInto(session: typeof EMPTY_SESSION, kind: "graphs" | "graph-bindings", id: string, content: object, hash = "h") {
  const file: DefinitionFile = { id, kind, missing: false, contentHash: hash, content: content as never };
  return applyDiskRead(session, { kind, id }, file);
}

/** A session with graph g and two of its bindings read from disk, and a binding of another graph. */
function workspace() {
  let s = readInto(EMPTY_SESSION, "graphs", "g", workspaceGraph);
  s = readInto(s, "graph-bindings", "g-1", newBindingContent("g-1", workspaceGraph));
  s = readInto(s, "graph-bindings", "g-2", newBindingContent("g-2", workspaceGraph));
  s = readInto(s, "graph-bindings", "h-1", { ...newBindingContent("h-1", workspaceGraph), graphId: "h" });
  return s;
}

const G = { kind: "graphs", id: "g" } as const;
const B1 = { kind: "graph-bindings", id: "g-1" } as const;
const entryKeys = (s: typeof EMPTY_SESSION, key: string) => Object.keys(s.drafts[key].content.nodes as object);

test("a binding read from disk makes a clean draft, and is found among its graph's bindings", () => {
  const s = workspace();
  assert.equal(isDirty(s.drafts["graph-bindings/g-1"]), false);
  assert.deepEqual(graphBindingDrafts(s, "g").map((d) => d.ref.id), ["g-1", "g-2"]);
});

test("a binding edit is a step of its graph's history, and undo puts it back", () => {
  const edit = { type: "set-entry-field", node: "task-1", key: "agentId", value: "codex" } as const;
  let s = workspace();
  s = changeDraft(s, B1, (d) => withChanges(d, applyBindingEdit(d.content, edit), d.positions), { label: "Set agentId" }, 0);
  assert.equal(isDirty(s.drafts["graph-bindings/g-1"]), true);
  assert.equal(s.histories["graph-bindings/g-1"], undefined);
  assert.equal(s.histories["graphs/g"].past.length, 1);
  const undone = undoDraft(s, G)!;
  assert.equal(undone.label, "Set agentId");
  assert.equal(isDirty(undone.session.drafts["graph-bindings/g-1"]), false);
  const redone = redoDraft(undone.session, G)!;
  assert.equal(isDirty(redone.session.drafts["graph-bindings/g-1"]), true);
});

test("a node rename rewrites the key in every binding of the graph in the same undo step", () => {
  let s = workspace();
  s = editGraph(s, G, { type: "rename-node", from: "task-1", to: "build" }, 0);
  assert.deepEqual(entryKeys(s, "graph-bindings/g-1"), ["build"]);
  assert.deepEqual(entryKeys(s, "graph-bindings/g-2"), ["build"]);
  assert.equal(isDirty(s.drafts["graph-bindings/g-1"]), true);
  // Another graph's binding is left alone.
  assert.deepEqual(entryKeys(s, "graph-bindings/h-1"), ["task-1"]);
  assert.equal(s.histories["graphs/g"].past.length, 1);
  const undone = undoDraft(s, G)!;
  assert.deepEqual(entryKeys(undone.session, "graph-bindings/g-1"), ["task-1"]);
  assert.deepEqual(entryKeys(undone.session, "graph-bindings/g-2"), ["task-1"]);
  assert.equal(isDirty(undone.session.drafts["graphs/g"]), false);
});

test("a node delete leaves the bindings' entries for a retarget to drop", () => {
  let s = workspace();
  s = editGraph(s, G, { type: "delete-node", id: "task-1" }, 0);
  assert.deepEqual(entryKeys(s, "graph-bindings/g-1"), ["task-1"]);
  assert.equal(isDirty(s.drafts["graph-bindings/g-1"]), false);
});

test("Retarget to current graph is one step of the graph's history", () => {
  let s = workspace();
  s = editGraph(s, G, { type: "delete-node", id: "task-1" }, 0);
  const retargeted = { ...s.drafts["graph-bindings/g-1"].content, nodes: {}, graphRevision: "r2", graphDigest: "d2" };
  s = changeDraft(s, B1, (d) => withChanges(d, retargeted, d.positions), { label: "Retarget g-1" }, 1);
  assert.equal(s.histories["graphs/g"].past.length, 2);
  const undone = undoDraft(s, G)!;
  assert.equal(undone.label, "Retarget g-1");
  assert.deepEqual(entryKeys(undone.session, "graph-bindings/g-1"), ["task-1"]);
});

test("a binding that reloads from disk clears its graph's history", () => {
  let s = editGraph(workspace(), G, { type: "rename-node", from: "end-1", to: "done" }, 0);
  assert.equal(s.histories["graphs/g"].past.length, 1);
  s = readInto(s, "graph-bindings", "g-2", { ...newBindingContent("g-2", workspaceGraph), costUnit: "x" }, "h2");
  assert.equal(s.histories["graphs/g"], undefined);
});

test("the binding chosen for a graph is remembered per graph, outside the history", () => {
  let s = workspace();
  assert.equal(chosenBinding(s, "g"), null);
  s = chooseBinding(s, "g", "g-2");
  s = chooseBinding(s, "h", "h-1");
  assert.equal(chosenBinding(s, "g"), "g-2");
  assert.equal(chosenBinding(s, "h"), "h-1");
  assert.equal(s.histories["graphs/g"], undefined);
  assert.equal(chosenBinding(chooseBinding(s, "g", null), "g"), null);
});

test("the binding choice follows a rename of its graph or binding, and goes when either is deleted", () => {
  const plan = { changes: [], unchecked: [], drafts: [], done: ["Wrote"] };
  let s = chooseBinding(workspace(), "g", "g-1");
  s = applyRename(s, G, "h", plan);
  assert.equal(chosenBinding(s, "g"), null);
  assert.equal(chosenBinding(s, "h"), "g-1");
  s = applyRename(s, B1, "h-9", plan);
  assert.equal(chosenBinding(s, "h"), "h-9");
  assert.equal(chosenBinding(removeDefinition(s, { kind: "graph-bindings", id: "h-9" }), "h"), null);
  assert.equal(chosenBinding(removeDefinition(s, { kind: "graphs", id: "h" }), "h"), null);
});
