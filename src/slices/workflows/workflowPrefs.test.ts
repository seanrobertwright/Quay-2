// The Workflows panel's per-machine preferences (#645): pinned Archon workflows and the Praxis
// graphs opened most recently, kept in the WebView's localStorage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RECENT_GRAPHS, recentGraphs, workflowPrefs } from "./workflowPrefs.ts";

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
};

test("pins keep their order, ignore a repeat and survive a new store on the same storage", () => {
  const storage = memory();
  const prefs = workflowPrefs(storage);
  assert.deepEqual(prefs.readPins(), []);
  prefs.pin("owner/a");
  prefs.pin("owner/b");
  prefs.pin("owner/a");
  assert.deepEqual(workflowPrefs(storage).readPins(), ["owner/a", "owner/b"]);
  prefs.unpin("owner/a");
  assert.deepEqual(prefs.readPins(), ["owner/b"]);
});

test("stored pins that are not a list of names read as none", () => {
  for (const raw of ["not json", '{"a":1}', "[1,2]", '["", "ok"]']) {
    const pins = workflowPrefs(memory({ quay_workflow_pins: raw })).readPins();
    assert.deepEqual(pins, raw === '["", "ok"]' ? ["ok"] : [], raw);
  }
});

test("opening a graph puts it first among the project's recent graphs, kept per project and capped", () => {
  const prefs = workflowPrefs(memory());
  prefs.graphOpened("C:/repo", "g1");
  prefs.graphOpened("C:/repo", "g2");
  prefs.graphOpened("C:/other", "x");
  prefs.graphOpened("C:/repo", "g1");
  assert.deepEqual(prefs.readRecentGraphs("c:\\repo\\"), ["g1", "g2"]);
  for (let i = 0; i < MAX_RECENT_GRAPHS + 3; i++) prefs.graphOpened("C:/repo", `n${i}`);
  assert.equal(prefs.readRecentGraphs("C:/repo").length, MAX_RECENT_GRAPHS);
});

test("recent graphs list the recently opened ones that still exist first, then the rest in id order", () => {
  assert.deepEqual(recentGraphs(["a", "b", "c", "d"], ["c", "gone", "a"]), ["c", "a", "b", "d"]);
  assert.deepEqual(recentGraphs([], ["c"]), []);
});
