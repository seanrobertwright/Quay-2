/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { definitionKey, EMPTY_SESSION, sessionFor, updateSession, type Sessions } from "./session.ts";

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
