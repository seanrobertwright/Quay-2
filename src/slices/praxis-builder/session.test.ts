/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphDraft, moveNodes, type GraphDraft } from "./drafts.ts";
import type { DefinitionFile } from "./types.ts";
import {
  applyDiskRead,
  definitionKey,
  dirtyDrafts,
  dirtyProjectKeys,
  dropDraft,
  EMPTY_SESSION,
  sessionFor,
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
