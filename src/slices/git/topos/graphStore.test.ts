/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphStore, shortOid, trackLabel } from "./graphStore.ts";
import { decodeGraphPage, OPEN_ROW, type GraphTrack } from "./graphPage.ts";
import { encodeTestPage, type TestPage } from "./fixtures/encodeTestPage.ts";

function ingest(store: GraphStore, p: Omit<TestPage, "sessionId">) {
  store.ingest(decodeGraphPage(encodeTestPage({ sessionId: 1, ...p })));
}

const track = (id: number, key: string, kind: GraphTrack["kind"], left: number | null = null, right: number | null = null) =>
  ({ id, key, kind, left, right }) as GraphTrack;

/**
 * Two pages of four rows. main runs down lane 0 (rows 0, 1, 2, 4...). feature opens at row 0 in
 * lane 1 and joins main at row 6, in the second page, so it is sent open and closed later.
 *
 * Edges: 0 = main 0→1, 1 = feature 0→6 (open), 2 = main 1→2, 3 = main 2→3, 4 = main 3→4 ...
 */
function twoPages(): GraphStore {
  const store = new GraphStore(1);
  ingest(store, {
    pageIndex: 0,
    firstRow: 0,
    rowCount: 4,
    rows: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    firstEdge: 0,
    edges: [
      [0, 1, 0, 0, 0, 0],
      [0, OPEN_ROW, 1, 0, 1, 1],
      [1, 2, 0, 0, 0, 0],
      [2, 3, 0, 0, 0, 0],
      [3, OPEN_ROW, 0, 0, 0, 0],
    ],
    peakLanes: 2,
    newTracks: [track(0, "main", "default"), track(1, "topic", "derived", 0)],
  });
  ingest(store, {
    pageIndex: 1,
    firstRow: 4,
    rowCount: 4,
    firstEdge: 5,
    checkpoint: [1, 4],
    edges: [
      [4, 5, 0, 0, 0, 0],
      [5, 6, 0, 0, 0, 0],
      [6, 7, 0, 0, 0, 0],
    ],
    closes: [
      [4, 4, 0],
      [1, 6, 0],
    ],
    peakLanes: 2,
  });
  return store;
}

test("rows keep their lane and track, and tracks their color slot", () => {
  const store = twoPages();
  assert.equal(store.lane(0), 0);
  assert.equal(store.track(5), 0);
  assert.equal(store.peakLanes, 2);
  assert.equal(store.trackKey(1), "topic");
  assert.equal(store.trackSlot(0), 0);
  // topic hashes to slot 3, clear of main's slot 0 to its left.
  assert.equal(store.trackSlot(1), 3);
});

test("a close from a later page completes the edge sent open", () => {
  const store = twoPages();
  assert.equal(store.edgeCount, 8);
  assert.deepEqual(store.edge(1), { childRow: 0, parentRow: 6, lane: 1, childLane: 0, parentLane: 0, track: 1 });
  assert.equal(store.edge(4).parentRow, 4);
});

test("visible edges are the page checkpoint plus the edges opened since, less those already closed", () => {
  const store = twoPages();
  // Rows 5 and 6: page 1's checkpoint gives edges 1 and 4, and edges 5 to 7 open in rows 4 to 6.
  // Edge 4 ends at row 4, the row above, and stays for the curve into it.
  assert.deepEqual(store.visibleEdges(5, 7).sort((a, b) => a - b), [1, 4, 5, 6, 7]);
  // Row 7 alone: edges 4 and 5 ended above row 6, so only those reaching row 6 or below are left.
  assert.deepEqual(store.visibleEdges(7, 8).sort((a, b) => a - b), [1, 6, 7]);
  assert.deepEqual(store.visibleEdges(0, 2).sort((a, b) => a - b), [0, 1, 2]);
});

test("an edge in a track the page never opened is refused", () => {
  const store = new GraphStore(1);
  assert.throws(
    () => ingest(store, { pageIndex: 0, firstRow: 0, rowCount: 1, edges: [[0, OPEN_ROW, 0, 0, 0, 3]] }),
    /unknown track 3/
  );
});

test("a close naming an edge not yet sent is refused", () => {
  const store = new GraphStore(1);
  ingest(store, { pageIndex: 0, firstRow: 0, rowCount: 1, newTracks: [track(0, "main", "default")] });
  assert.throws(() => ingest(store, { pageIndex: 1, firstRow: 1, rowCount: 1, closes: [[9, 1, 0]] }), /unknown edge 9/);
});

test("a track starts at its first row or the row of its first edge, whichever comes first", () => {
  const store = twoPages();
  assert.equal(store.trackStartRow(0), 0);
  // topic has no row of its own in these pages; the merge edge from row 0 opened it.
  assert.equal(store.trackStartRow(1), 0);
});

test("the tracks passing a row are those that started above it, left to right by lane", () => {
  const store = twoPages();
  // At row 0 both tracks start on the row itself, so neither has scrolled away.
  assert.deepEqual(store.tracksPassing(0), []);
  // At row 3, main's node is on the row and topic's edge 0→6 crosses it in lane 1.
  assert.deepEqual(store.tracksPassing(3), [
    { track: 0, lane: 0, startRow: 0 },
    { track: 1, lane: 1, startRow: 0 },
  ]);
  // topic's edge ends at row 6, so below it only main is left.
  assert.deepEqual(
    store.tracksPassing(7).map((t) => store.trackKey(t.track)),
    ["main"]
  );
  assert.deepEqual(new GraphStore(1).tracksPassing(0), []);
});

test("a track opened by a tip in a later page starts at that tip's row", () => {
  const store = twoPages();
  ingest(store, {
    pageIndex: 2,
    firstRow: 8,
    rowCount: 3,
    rows: [
      [0, 0],
      [1, 2],
      [1, 2],
    ],
    firstEdge: 8,
    edges: [[9, 10, 1, 1, 1, 2]],
    newTracks: [track(2, "fix", "named")],
  });
  assert.equal(store.trackStartRow(2), 9);
  assert.deepEqual(store.tracksPassing(10).map((t) => [store.trackKey(t.track), t.startRow]), [["fix", 9]]);
});

test("a track's label is its branch name, or a short oid for an anonymous track", () => {
  assert.equal(trackLabel("feature/x", "named"), "feature/x");
  assert.equal(trackLabel("topic", "derived"), "topic");
  assert.equal(trackLabel("0123456789abcdef0123456789abcdef01234567", "anonymous"), "0123456");
  assert.equal(trackLabel("0123456789abcdef0123456789abcdef01234567^2", "anonymous"), "0123456^2");
});

test("a short oid is the oid's first seven characters", () => {
  assert.equal(shortOid("0123456789abcdef0123456789abcdef01234567"), "0123456");
  assert.equal(shortOid("abc"), "abc");
});

test("the store names a track by its id", () => {
  const store = twoPages();
  assert.equal(store.trackLabel(0), "main");
  assert.equal(store.trackLabel(1), "topic");
});

test("each row keeps the agent its page gave it, and a human commit has none", () => {
  const store = new GraphStore(1);
  ingest(store, {
    pageIndex: 0,
    firstRow: 0,
    rowCount: 3,
    agents: [
      { row: 0, kind: "codex", source: "stamp" },
      { row: 2, kind: "claude", source: "coauthor" },
    ],
  });
  ingest(store, { pageIndex: 1, firstRow: 3, rowCount: 2, agents: [{ row: 1, kind: null, source: "stamp", raw: "<b>x</b>" }] });
  assert.deepEqual(
    Array.from({ length: 5 }, (_, r) => store.agent(r)),
    [
      { kind: "codex", source: "stamp" },
      null,
      { kind: "claude", source: "coauthor" },
      null,
      { kind: null, source: "stamp", raw: "<b>x</b>" },
    ]
  );
});

/** Every string reachable from `root` through objects, arrays, maps and sets. */
function reachableStrings(root: unknown): string[] {
  const seen = new Set<unknown>();
  const out: string[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === "string") {
      out.push(v);
      continue;
    }
    if (typeof v !== "object" || v === null || seen.has(v) || ArrayBuffer.isView(v)) continue;
    seen.add(v);
    if (v instanceof Map) for (const [k, x] of v) stack.push(k, x);
    else if (v instanceof Set) for (const x of v) stack.push(x);
    else for (const x of Object.values(v)) stack.push(x);
  }
  return out;
}

const HEX_OID = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

test("the store holds no oid as a string of its own, and decodes each row's oid on demand", () => {
  const store = new GraphStore(1);
  ingest(store, { pageIndex: 0, firstRow: 0, rowCount: 600 });
  ingest(store, { pageIndex: 1, firstRow: 600, rowCount: 600 });
  assert.deepEqual(reachableStrings(store).filter((s) => HEX_OID.test(s)), []);
  // The fixture names each row by its row number in hex.
  assert.equal(store.oid(0), "0000000000000000000000000000000000000000");
  assert.equal(store.oid(1199), "00000000000000000000000000000000000004af");
});

const SHA256_A = "6f1ed002ab5595859014ebf0951522d9d4a2b4e1d71c2a1b8e3f0b5a6c7d8e9f";
const SHA256_B = "0000000000000000000000000000000000000000000000000000000000000abc";

test("a SHA-256 repository's 64-digit oids come back as they went in, and are found by lookup", () => {
  const store = new GraphStore(1);
  ingest(store, { pageIndex: 0, firstRow: 0, rowCount: 2, oids: [SHA256_A, SHA256_B] });
  assert.equal(store.oid(0), SHA256_A);
  assert.equal(store.oid(1), SHA256_B);
  assert.equal(store.rowOf(SHA256_B), 1);
  assert.equal(store.rowOf(SHA256_A.slice(0, 40)), -1, "a 40-digit oid can't name a SHA-256 row");
});

test("a page whose oids aren't 40 or 64 lowercase hex digits, or change width, is refused", () => {
  assert.throws(() => ingest(new GraphStore(1), { pageIndex: 0, firstRow: 0, rowCount: 1, oids: ["abc123"] }), /not an oid/);
  assert.throws(
    () => ingest(new GraphStore(1), { pageIndex: 0, firstRow: 0, rowCount: 1, oids: ["G".repeat(40)] }),
    /isn't lowercase hex/
  );
  const store = new GraphStore(1);
  ingest(store, { pageIndex: 0, firstRow: 0, rowCount: 1 });
  assert.throws(() => ingest(store, { pageIndex: 1, firstRow: 1, rowCount: 1, oids: [SHA256_A] }), /not a 40-digit oid/);
});

test("looking up an oid finds its row, and an oid not loaded or not an oid finds none", () => {
  const store = twoPages();
  assert.equal(store.rowOf("0000000000000000000000000000000000000006"), 6);
  assert.equal(store.rowOf("0000000000000000000000000000000000000009"), -1);
  assert.equal(store.rowOf("000000"), -1);
  assert.equal(store.rowOf("not an oid"), -1);
  assert.equal(new GraphStore(1).rowOf("0000000000000000000000000000000000000000"), -1);
});

test("trimming drops the slack doubling left, keeps every row, and the store still grows after", () => {
  const store = new GraphStore(1);
  ingest(store, { pageIndex: 0, firstRow: 0, rowCount: 1000 });
  ingest(store, { pageIndex: 1, firstRow: 1000, rowCount: 500 });
  assert.equal(store.capacity, 2048);
  store.trim();
  assert.equal(store.capacity, 1500);
  assert.equal(store.oid(1499), "00000000000000000000000000000000000005db");
  assert.equal(store.subject(1499), "commit 1499");
  ingest(store, { pageIndex: 2, firstRow: 1500, rowCount: 10 });
  assert.equal(store.capacity, 3000);
  assert.equal(store.oid(1499), "00000000000000000000000000000000000005db");
  assert.equal(store.rowOf("00000000000000000000000000000000000005e5"), 1509);
  assert.deepEqual(store.author(1499), { name: "Author 1", email: "a1@example.invalid" });
});

test("a row's oid matches a hex prefix of it, of any length up to the whole oid", () => {
  const store = new GraphStore(1);
  ingest(store, { pageIndex: 0, firstRow: 0, rowCount: 2, oids: ["a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", SHA256_B.slice(0, 40)] });
  assert.equal(store.hasOidPrefix(0, "a1b2c"), true);
  assert.equal(store.hasOidPrefix(0, "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"), true);
  assert.equal(store.hasOidPrefix(0, ""), true);
  assert.equal(store.hasOidPrefix(0, "a1b2d"), false);
  assert.equal(store.hasOidPrefix(0, "a1b2c3d4e5f60718293a4b5c6d7e8f90123456780"), false, "longer than the oid");
  assert.equal(store.hasOidPrefix(0, "fix"), false);
  assert.equal(store.hasOidPrefix(1, "a1"), false);
  const sha256 = new GraphStore(1);
  ingest(sha256, { pageIndex: 0, firstRow: 0, rowCount: 1, oids: [SHA256_A] });
  assert.equal(sha256.hasOidPrefix(0, SHA256_A.slice(0, 50)), true);
});

test("a matcher for a set of oids answers for each row whether its oid is one of them", () => {
  const store = twoPages();
  const isOne = store.oidMatcher([
    "0000000000000000000000000000000000000002",
    "0000000000000000000000000000000000000007",
    // Shares its first eight digits with every row, but is none of them.
    "0000000000000000000000000000000000000fff",
    "not an oid",
  ]);
  assert.deepEqual(
    Array.from({ length: store.rowCount }, (_, r) => r).filter(isOne),
    [2, 7]
  );
  assert.equal(new GraphStore(1).oidMatcher(["0000000000000000000000000000000000000000"])(0), false);
});
