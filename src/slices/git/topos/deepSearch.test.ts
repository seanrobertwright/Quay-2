/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { DeepSearch, deepCounter, parseSearch, ResultRoute, ResultScan, type DeepSearchState, type SearchBackend, type SearchEvent, type SearchQuery } from "./deepSearch.ts";
import { countingStore, withStringOids } from "./fixtures/oidRows.ts";

test("a plain query finds over the loaded rows", () => {
  assert.deepEqual(parseSearch("fix parser", false), { mode: "find", text: "fix parser" });
});

test("each prefix switches to a deep search of its kind, case-blind, with the text trimmed", () => {
  assert.deepEqual(parseSearch("msg: a+b (x)", false), { mode: "deep", kind: "message", text: "a+b (x)" });
  assert.deepEqual(parseSearch("Author:J. Doe ", false), { mode: "deep", kind: "author", text: "J. Doe" });
  assert.deepEqual(parseSearch("  path: docs/[ab].txt", false), { mode: "deep", kind: "path", text: "docs/[ab].txt" });
  assert.deepEqual(parseSearch("CODE: x.*y", false), { mode: "deep", kind: "code", text: "x.*y" });
});

test("a prefix with nothing after it searches nothing yet", () => {
  assert.deepEqual(parseSearch("msg:", false), { mode: "deep", kind: "message", text: "" });
  assert.deepEqual(parseSearch("path:   ", true), { mode: "deep", kind: "path", text: "" });
});

test("Search all history makes a plain query a message search", () => {
  assert.deepEqual(parseSearch("fix parser", true), { mode: "deep", kind: "message", text: "fix parser" });
  assert.deepEqual(parseSearch("author: ann", true), { mode: "deep", kind: "author", text: "ann" });
});

test("an unknown prefix, or a prefix not at the start, is plain text", () => {
  assert.deepEqual(parseSearch("fix: the build", false), { mode: "find", text: "fix: the build" });
  assert.deepEqual(parseSearch("see msg: here", false), { mode: "find", text: "see msg: here" });
  assert.deepEqual(parseSearch("message: x", false), { mode: "find", text: "message: x" });
});

/** Timers run by hand: `advance(ms)` fires every timer due by then, in order. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        pending.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (handle: unknown) => void pending.delete(handle as number),
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}

interface Started {
  repoPath: string;
  query: SearchQuery;
  emit: (event: SearchEvent) => void;
  resolve: (id: number) => void;
}

/** A backend whose searches start when the test resolves them. */
function fakeBackend() {
  const started: Started[] = [];
  const cancelled: number[] = [];
  const more: number[] = [];
  const backend: SearchBackend = {
    start: (repoPath, query, onEvent) =>
      new Promise<number>((resolve) => started.push({ repoPath, query, emit: onEvent, resolve })),
    more: (id) => void more.push(id),
    cancel: (id) => void cancelled.push(id),
  };
  return { backend, started, cancelled, more };
}

const BRANCHES = { kind: "branches" } as const;
const msg = (text: string): SearchQuery => ({ kind: "message", text, refs: BRANCHES });
const settle = () => new Promise<void>((r) => setImmediate(r));

function controller() {
  const clock = fakeTimers();
  const fake = fakeBackend();
  let state: DeepSearchState | null = null;
  const search = new DeepSearch({ backend: fake.backend, timers: clock.timers, onState: (s) => (state = s) });
  return { clock, fake, search, state: () => state! };
}

test("a query starts only after typing pauses for 300 ms", () => {
  const { clock, fake, search } = controller();
  search.ask("/repo", msg("f"));
  clock.advance(200);
  search.ask("/repo", msg("fi"));
  clock.advance(299);
  assert.equal(fake.started.length, 0);
  clock.advance(1);
  assert.equal(fake.started.length, 1);
  assert.deepEqual(fake.started[0].query, msg("fi"));
  assert.equal(fake.started[0].repoPath, "/repo");
});

test("results stream in, cap with Load more, and end in done", async () => {
  const { clock, fake, search, state } = controller();
  search.ask("/repo", msg("needle"));
  clock.advance(300);
  fake.started[0].resolve(7);
  await settle();
  fake.started[0].emit({ event: "matches", searchId: 7, oids: ["a", "b"] });
  assert.deepEqual(state().oids, ["a", "b"]);
  assert.equal(state().status, "running");
  fake.started[0].emit({ event: "capped", searchId: 7, total: 2 });
  assert.equal(state().status, "capped");

  search.loadMore();
  assert.deepEqual(fake.more, [7]);
  assert.equal(state().status, "running");
  fake.started[0].emit({ event: "matches", searchId: 7, oids: ["c"] });
  fake.started[0].emit({ event: "done", searchId: 7, total: 3 });
  assert.deepEqual(state().oids, ["a", "b", "c"]);
  assert.equal(state().status, "done");
});

test("typing a new query cancels the running search at once and drops its late events", async () => {
  const { clock, fake, search, state } = controller();
  search.ask("/repo", msg("old"));
  clock.advance(300);
  fake.started[0].resolve(1);
  await settle();
  fake.started[0].emit({ event: "matches", searchId: 1, oids: ["old1"] });

  search.ask("/repo", msg("new"));
  assert.deepEqual(fake.cancelled, [1], "cancelled before the debounce runs out");
  assert.deepEqual(state().oids, [], "the old results are gone");
  fake.started[0].emit({ event: "matches", searchId: 1, oids: ["old2"] });
  fake.started[0].emit({ event: "done", searchId: 1, total: 2 });
  assert.deepEqual(state().oids, []);
  assert.equal(state().status, "waiting");

  clock.advance(300);
  fake.started[1].resolve(2);
  await settle();
  fake.started[1].emit({ event: "matches", searchId: 2, oids: ["new1"] });
  assert.deepEqual(state().oids, ["new1"]);
});

test("a search superseded before its id came back is cancelled once it does", async () => {
  const { clock, fake, search, state } = controller();
  search.ask("/repo", msg("old"));
  clock.advance(300);
  search.ask("/repo", msg("new"));
  clock.advance(300);
  fake.started[1].resolve(2);
  fake.started[0].resolve(1);
  await settle();
  assert.deepEqual(fake.cancelled, [1]);
  fake.started[0].emit({ event: "matches", searchId: 1, oids: ["stale"] });
  assert.deepEqual(state().oids, []);
});

test("an event naming another search on the current channel is dropped", async () => {
  const { clock, fake, search, state } = controller();
  search.ask("/repo", msg("x"));
  clock.advance(300);
  fake.started[0].resolve(5);
  await settle();
  fake.started[0].emit({ event: "matches", searchId: 4, oids: ["stale"] });
  assert.deepEqual(state().oids, []);
});

test("clearing the query cancels the search and empties the results without waiting", async () => {
  const { clock, fake, search, state } = controller();
  search.ask("/repo", msg("x"));
  clock.advance(300);
  fake.started[0].resolve(3);
  await settle();
  search.ask("/repo", null);
  assert.deepEqual(fake.cancelled, [3]);
  assert.equal(state().status, "idle");
  clock.advance(1000);
  assert.equal(fake.started.length, 1);
});

test("asking again for the same query keeps the running search", async () => {
  const { clock, fake, search } = controller();
  search.ask("/repo", msg("x"));
  clock.advance(300);
  search.ask("/repo", msg("x"));
  clock.advance(300);
  assert.equal(fake.started.length, 1);
  assert.deepEqual(fake.cancelled, []);
});

test("a failed search says why", async () => {
  const { clock, fake, search, state } = controller();
  search.ask("/repo", msg("x"));
  clock.advance(300);
  fake.started[0].resolve(3);
  await settle();
  fake.started[0].emit({ event: "failed", searchId: 3, error: { kind: "other", stderr: "fatal: bad revision" } });
  assert.equal(state().status, "failed");
  assert.match(state().error ?? "", /bad revision/);
});

/** Loaded rows as the scan reads them: just their oids. */
function rowsOf(oids: string[]) {
  return withStringOids({ rowCount: oids.length, oid: (row: number) => oids[row] });
}

test("results among the loaded rows become Find's sorted match rows, whatever order they came in", () => {
  const rows = rowsOf(["r0", "r1", "r2", "r3", "r4"]);
  const scan = new ResultScan(["r3", "zz-not-loaded", "r1"]);
  assert.equal(scan.scan(rows, 2), false, "a budget of two rows stops short");
  assert.equal(scan.scan(rows, 100), true);
  assert.deepEqual([...scan.matches], [1, 3]);
});

test("a result routes in place when loaded, loads the graph down while more rows remain, and opens only its details past the end", () => {
  const loaded = rowsOf(["r0", "r1", "r2"]);
  assert.deepEqual(new ResultRoute("r1").step(loaded, "paused"), { kind: "inPlace", row: 1 });

  const deep = new ResultRoute("r5");
  assert.deepEqual(deep.step(loaded, "paused"), { kind: "loadMore" }, "below the loaded rows, more are asked for");
  assert.deepEqual(deep.step(loaded, "loading"), { kind: "wait" }, "nothing more to do until they land");
  const more = rowsOf(["r0", "r1", "r2", "r3", "r4"]);
  assert.deepEqual(deep.step(more, "paused"), { kind: "loadMore" }, "still below: more again");
  const reached = rowsOf(["r0", "r1", "r2", "r3", "r4", "r5", "r6"]);
  assert.deepEqual(deep.step(reached, "paused"), { kind: "inPlace", row: 5 });

  // The session stopped at its hard ceiling of rows: the result lies past it.
  assert.deepEqual(new ResultRoute("r9").step(loaded, "truncated"), { kind: "detailsOnly" });
  assert.deepEqual(new ResultRoute("r9").step(loaded, "done"), { kind: "detailsOnly" });
  assert.deepEqual(new ResultRoute("r9").step(loaded, "failed"), { kind: "detailsOnly" });
});

test("the deep counter says what was found in history and where the selection is among the loaded ones", () => {
  const loaded = Int32Array.from([2, 7]);
  assert.equal(deepCounter("waiting", 0, loaded, null), "Searching all history…");
  assert.equal(deepCounter("running", 0, new Int32Array(0), null), "Searching all history…");
  assert.equal(deepCounter("done", 0, new Int32Array(0), null), "No matches in history");
  assert.equal(deepCounter("running", 40, loaded, null), "40 found so far · 2 loaded");
  assert.equal(deepCounter("capped", 1000, loaded, 7), "1,000 found, more remain · 2 of 2 loaded");
  assert.equal(deepCounter("done", 1, new Int32Array(0), null), "1 found · none loaded");
  assert.equal(deepCounter("failed", 3, loaded, null), "Search failed");
});

test("over the graph store, results are matched and routed without building any row's oid", () => {
  const { rows, built } = countingStore();
  const hex = (row: number) => row.toString(16).padStart(40, "0");
  const scan = new ResultScan([hex(700), hex(5000), hex(3)]);
  assert.equal(scan.scan(rows, 500), false);
  assert.equal(scan.scan(rows, 500), true);
  assert.deepEqual([...scan.matches], [3, 700]);
  assert.deepEqual(new ResultRoute(hex(812)).step(rows, "done"), { kind: "inPlace", row: 812 });
  assert.deepEqual(new ResultRoute(hex(5000)).step(rows, "done"), { kind: "detailsOnly" });
  assert.equal(built(), 0);
});
