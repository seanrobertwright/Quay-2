/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphDraft, isDirty, markSaved, moveNodes, type GraphDraft } from "./drafts.ts";
import { editDraft, type GraphEdit } from "./editor.ts";
import type { DefinitionFile } from "./types.ts";
import {
  applyDiskRead,
  changeGraph,
  definitionKey,
  dirtyDrafts,
  dirtyProjectKeys,
  dropDraft,
  EMPTY_SESSION,
  endGraphMerge,
  forgetHistories,
  redoGraph,
  sessionFor,
  undoGraph,
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

function graphDraft(id: string): GraphDraft {
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
const edit = (e: GraphEdit) => (d: GraphDraft) => editDraft(d, e);
const shipDraft = (s: { drafts: Record<string, GraphDraft> }) => s.drafts["graphs/ship"];
const nodeIdsOf = (d: GraphDraft) => (d.content.nodes as { id: string }[]).map((n) => n.id);

test("an edit is one step, and undo and redo put the draft back and forth", () => {
  const start = opened();
  const added = changeGraph(start, ship, edit({ type: "add-node", id: "task-1", kind: "TASK", position: { x: 0, y: 200 } }), { label: "Add task-1" }, 0);
  assert.deepEqual(nodeIdsOf(shipDraft(added)), ["end-1", "task-1"]);

  const undone = undoGraph(added, ship)!;
  assert.equal(undone.label, "Add task-1");
  assert.deepEqual(nodeIdsOf(shipDraft(undone.session)), ["end-1"]);
  assert.equal(isDirty(shipDraft(undone.session)), false, "undoing back to the loaded state is clean");

  const redone = redoGraph(undone.session, ship)!;
  assert.deepEqual(nodeIdsOf(shipDraft(redone.session)), ["end-1", "task-1"]);
  assert.deepEqual(redone.changed, ["task-1"], "redo selects the node the step added");
  assert.equal(redoGraph(redone.session, ship), null);
});

test("a change that changes nothing, such as a drag dropped where it began, records no step", () => {
  const start = opened();
  const at = shipDraft(start).positions.get("end-1")!;
  const moved = changeGraph(start, ship, (d) => moveNodes(d, [["end-1", at]]), { label: "Move" }, 0);
  assert.equal(moved, start);
  assert.equal(undoGraph(moved, ship), null);
});

test("undo selects the nodes the step changed that still exist", () => {
  let s = opened();
  s = changeGraph(s, ship, edit({ type: "add-node", id: "task-1", kind: "TASK", position: { x: 0, y: 200 } }), { label: "Add" }, 0);
  s = changeGraph(s, ship, edit({ type: "connect", source: "task-1", target: "end-1" }), { label: "Connect" }, 1);
  s = changeGraph(s, ship, (d) => moveNodes(d, [["task-1", { x: 50, y: 50 }]]), { label: "Move" }, 2);
  assert.deepEqual(undoGraph(s, ship)!.changed, ["task-1"]);

  s = undoGraph(s, ship)!.session;
  assert.deepEqual(undoGraph(s, ship)!.changed, ["end-1"], "undoing the connection selects the node whose dependsOn changed");

  s = undoGraph(s, ship)!.session;
  assert.deepEqual(undoGraph(s, ship)!.changed, [], "undoing an add leaves nothing to select");
});

test("live typing in one field merges until the merge ends", () => {
  let s = changeGraph(opened(), ship, edit({ type: "add-node", id: "loop-1", kind: "LOOP", position: { x: 0, y: 200 } }), { label: "Add" }, 0);
  const typing = { label: "Edit maxIterations", merge: { key: "loop-1|config.maxIterations" } };
  for (const value of ["1", "12", "123"]) {
    s = changeGraph(s, ship, edit({ type: "set-config", id: "loop-1", key: "maxIterations", value }), typing, 1);
  }
  s = endGraphMerge(s, ship);
  s = changeGraph(s, ship, edit({ type: "set-config", id: "loop-1", key: "maxIterations", value: "1234" }), typing, 2);
  assert.equal(s.histories["graphs/ship"].past.length, 3);
  s = undoGraph(s, ship)!.session;
  s = undoGraph(s, ship)!.session;
  const loop = (shipDraft(s).content.nodes as { id: string; config: { maxIterations: string } }[])[1];
  assert.equal(loop.config.maxIterations, "3", "two undos go back past all three keystrokes to the default");
});

test("save keeps the history, and undoing past the save makes the draft dirty again", () => {
  let s = changeGraph(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 40, y: 40 }]]), { label: "Move" }, 0);
  const d = shipDraft(s);
  const layout = { nodes: [{ id: "end-1", x: 40, y: 40 }], viewport: null };
  s = { ...s, drafts: { "graphs/ship": markSaved(d, { content: d.content, contentHash: "h2" }, { content: d.content, layout }) } };
  assert.equal(isDirty(shipDraft(s)), false);
  s = undoGraph(s, ship)!.session;
  assert.equal(isDirty(shipDraft(s)), true);
});

test("a quiet reload from disk clears the history, and a kept dirty draft keeps it", () => {
  const edited = changeGraph(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 40, y: 40 }]]), { label: "Move" }, 0);
  assert.notEqual(edited.histories["graphs/ship"], undefined);
  assert.equal(applyDiskRead(edited, ship, shipFile("h2")).histories["graphs/ship"], edited.histories["graphs/ship"]);

  const undone = undoGraph(edited, ship)!.session;
  const reloaded = applyDiskRead(undone, ship, shipFile("h2", 300));
  assert.equal(reloaded.histories["graphs/ship"], undefined);
});

test("dropping a draft, as Reload in the conflict prompt does, drops its history", () => {
  const edited = changeGraph(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 40, y: 40 }]]), { label: "Move" }, 0);
  assert.equal(dropDraft(edited, ship).histories["graphs/ship"], undefined);
});

test("removing a project forgets its histories but keeps its drafts", () => {
  let sessions: Sessions = new Map();
  sessions = updateSession(sessions, "E:\\A", () => changeGraph(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 1, y: 1 }]]), { label: "Move" }, 0));
  sessions = updateSession(sessions, "E:\\B", () => changeGraph(opened(), ship, (d) => moveNodes(d, [["end-1", { x: 2, y: 2 }]]), { label: "Move" }, 0));
  const after = forgetHistories(sessions, ["e:/A/"]);
  assert.deepEqual(sessionFor(after, "E:\\A").histories, {});
  assert.notEqual(sessionFor(after, "E:\\A").drafts["graphs/ship"], undefined);
  assert.equal(sessionFor(after, "E:\\B"), sessionFor(sessions, "E:\\B"));
  assert.equal(forgetHistories(after, ["E:\\C"]), after);
});
