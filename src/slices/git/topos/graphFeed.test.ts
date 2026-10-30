/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphFeed, LOAD_AHEAD_ROWS, MORE_ROWS } from "./graphFeed.ts";
import { GraphStore } from "./graphStore.ts";
import { decodeGraphPage, OPEN_ROW, type GraphPage } from "./graphPage.ts";
import { encodeTestPage } from "./fixtures/encodeTestPage.ts";

/** A page of `rowCount` rows, all in lane 0, with one new author per page. */
function encodePage(sessionId: number, pageIndex: number, firstRow: number, rowCount: number): ArrayBuffer {
  return encodeTestPage({ sessionId, pageIndex, firstRow, rowCount });
}

function started(feed: GraphFeed, sessionId: number) {
  assert.equal(feed.accept({ event: "started", sessionId }), true);
}

test("rows from the session's pages land in the store in order", () => {
  const feed = new GraphFeed();
  started(feed, 4);
  assert.equal(feed.accept(encodePage(4, 0, 0, 512)), true);
  assert.equal(feed.accept(encodePage(4, 1, 512, 3)), true);
  assert.equal(feed.accept({ event: "done", sessionId: 4, total: 515 }), true);
  assert.equal(feed.store?.rowCount, 515);
  assert.equal(feed.store?.subject(513), "commit 513");
  assert.deepEqual(feed.store?.author(513), { name: "Author 1", email: "a1@example.invalid" });
  assert.equal(feed.store?.authorTimeMs(1), 1_699_999_999_000);
  assert.deepEqual(feed.status, { state: "done" });
});

test("messages from another session are dropped", () => {
  const feed = new GraphFeed();
  started(feed, 4);
  assert.equal(feed.accept({ event: "started", sessionId: 3 }), false);
  assert.equal(feed.accept(encodePage(3, 0, 0, 10)), false);
  assert.equal(feed.accept({ event: "done", sessionId: 3, total: 10 }), false);
  assert.equal(feed.store?.rowCount, 0);
  assert.deepEqual(feed.status, { state: "loading" });
});

test("nothing is accepted before the session starts", () => {
  const feed = new GraphFeed();
  assert.equal(feed.accept(encodePage(1, 0, 0, 1)), false);
  assert.equal(feed.accept({ event: "paused", sessionId: 1, rowsLoaded: 1 }), false);
  assert.equal(feed.accept("not an event"), false);
});

test("nearing the loaded end of a paused session asks for more rows once", () => {
  const feed = new GraphFeed();
  started(feed, 1);
  for (let p = 0; p < 10; p++) feed.accept(encodePage(1, p, p * 512, 512));
  feed.accept({ event: "paused", sessionId: 1, rowsLoaded: 5120 });
  assert.equal(feed.rowsToRequest(100), null, "far from the end");
  assert.equal(feed.rowsToRequest(5120 - LOAD_AHEAD_ROWS), MORE_ROWS);
  assert.equal(feed.rowsToRequest(5120), null, "already asked");
  assert.deepEqual(feed.status, { state: "loading" });
  feed.accept(encodePage(1, 10, 5120, 512));
  feed.accept({ event: "paused", sessionId: 1, rowsLoaded: 5632 });
  assert.equal(feed.rowsToRequest(5632), MORE_ROWS, "a new pause allows a new request");
});

test("a done or truncated session asks for nothing more", () => {
  const done = new GraphFeed();
  started(done, 1);
  done.accept(encodePage(1, 0, 0, 5));
  done.accept({ event: "done", sessionId: 1, total: 5 });
  assert.equal(done.rowsToRequest(5), null);

  const truncated = new GraphFeed();
  started(truncated, 2);
  truncated.accept({ event: "truncated", sessionId: 2, cap: 2_000_000 });
  assert.deepEqual(truncated.status, { state: "truncated", cap: 2_000_000 });
  assert.equal(truncated.rowsToRequest(0), null);
  assert.equal(truncated.accept({ event: "paused", sessionId: 2, rowsLoaded: 1 }), false, "a finished session stays finished");
});

test("a failure keeps the rows already loaded", () => {
  const feed = new GraphFeed();
  started(feed, 1);
  feed.accept(encodePage(1, 0, 0, 3));
  feed.accept({ event: "failed", sessionId: 1, error: { kind: "other", stderr: "fatal: bad object" } });
  assert.deepEqual(feed.status, { state: "failed", message: "fatal: bad object" });
  assert.equal(feed.store?.rowCount, 3);
});

test("a page out of order or a garbled page fails the feed", () => {
  const gap = new GraphFeed();
  started(gap, 1);
  assert.equal(gap.accept(encodePage(1, 1, 512, 3)), false);
  assert.equal(gap.status.state, "failed");

  const garbled = new GraphFeed();
  started(garbled, 1);
  assert.equal(garbled.accept(new ArrayBuffer(80)), false);
  assert.equal(garbled.status.state, "failed");
});

function page(sessionId: number, pageIndex: number, firstRow: number, rowCount: number): GraphPage {
  return decodeGraphPage(encodePage(sessionId, pageIndex, firstRow, rowCount));
}

test("the store's typed arrays grow by doubling, not per page", () => {
  const store = new GraphStore(9);
  const capacities = new Set<number>();
  for (let p = 0; p < 40; p++) {
    store.ingest(page(9, p, p * 512, 512));
    capacities.add(store.capacity);
  }
  assert.equal(store.rowCount, 20_480);
  // 40 pages, but only the doublings 1024, 2048, ... 32768.
  assert.deepEqual([...capacities], [1024, 2048, 4096, 8192, 16384, 32768]);
  assert.equal(store.oid(20_479), (20_479).toString(16).padStart(40, "0"));
});

test("the store refuses another session's page and pages that don't follow on", () => {
  const store = new GraphStore(9);
  assert.throws(() => store.ingest(page(8, 0, 0, 1)), /session 8/);
  store.ingest(page(9, 0, 0, 2));
  assert.throws(() => store.ingest(page(9, 1, 5, 2)), /expected page 1 at row 2/);
  assert.throws(() => store.ingest(page(9, 0, 2, 2)), /expected page 1/);
  const unknownAuthor = page(9, 1, 2, 1);
  unknownAuthor.authorIds[0] = 7;
  assert.throws(() => store.ingest(unknownAuthor), /unknown author 7/);
  assert.equal(store.rowCount, 2);
});

/**
 * A session of four rows: main runs A, B, C down lane 0, and the tip S of `side` in lane 1 joins
 * it at C. Edges: 0 = A→B, 1 = B→C (crossing row 2), 2 = S→C, opened at row 2.
 */
function sessionBeforeSplice(): GraphFeed {
  const feed = new GraphFeed();
  started(feed, 1);
  feed.accept(
    encodeTestPage({
      sessionId: 1,
      pageIndex: 0,
      firstRow: 0,
      rowCount: 4,
      oids: ["A", "B", "S", "C"],
      rows: [
        [0, 0],
        [0, 0],
        [1, 1],
        [0, 0],
      ],
      edges: [
        [0, 1, 0, 0, 0, 0],
        [1, 3, 0, 0, 0, 0],
        [2, 3, 1, 1, 0, 1],
      ],
      peakLanes: 2,
      newTracks: [
        { id: 0, key: "main", kind: "default", left: null, right: null },
        { id: 1, key: "side", kind: "named", left: null, right: null },
      ],
    })
  );
  feed.accept({ event: "done", sessionId: 1, total: 4 });
  return feed;
}

test("a splice puts the new rows above the old rows from the match, renumbered", () => {
  const feed = sessionBeforeSplice();
  // N lands on main above A; the old rows from S (row 2) on are kept, one row lower.
  assert.equal(
    feed.accept({
      event: "splice",
      sessionId: 1,
      replaceRows: 2,
      newRows: 3,
      rowDelta: 1,
      edgesFrom: 2,
      edgesTo: 3,
      tracksFrom: 1,
      tracksTo: 1,
      crossingEdges: [[1, 2]],
      liveTracks: [[0, 0]],
    }),
    true
  );
  assert.deepEqual(feed.status, { state: "loading" });
  assert.equal(feed.store?.rowCount, 4, "the old rows show until the new ones arrive");
  feed.accept(
    encodeTestPage({
      sessionId: 1,
      pageIndex: 0,
      firstRow: 0,
      rowCount: 3,
      oids: ["N", "A", "B"],
      edges: [
        [0, 1, 0, 0, 0, 0],
        [1, 2, 0, 0, 0, 0],
        [2, OPEN_ROW, 0, 0, 0, 0],
      ],
    })
  );
  const store = feed.store!;
  assert.equal(store.rowCount, 5);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, r) => [store.oid(r), store.lane(r), store.trackKey(store.track(r))]),
    [
      ["N", 0, "main"],
      ["A", 0, "main"],
      ["B", 0, "main"],
      ["S", 1, "side"],
      ["C", 0, "main"],
    ]
  );
  assert.deepEqual(
    Array.from({ length: store.edgeCount }, (_, id) => store.edge(id)),
    [
      { childRow: 0, parentRow: 1, lane: 0, childLane: 0, parentLane: 0, track: 0 },
      { childRow: 1, parentRow: 2, lane: 0, childLane: 0, parentLane: 0, track: 0 },
      // B→C crosses the splice: the new edge takes the old one's close, one row lower.
      { childRow: 2, parentRow: 4, lane: 0, childLane: 0, parentLane: 0, track: 0 },
      { childRow: 3, parentRow: 4, lane: 1, childLane: 1, parentLane: 0, track: 1 },
    ]
  );
  assert.deepEqual(store.visibleEdges(3, 5).sort(), [2, 3], "the window below the splice still finds its edges");
  assert.equal(store.trackStartRow(1), 3);
  assert.deepEqual(store.author(3), { name: "Author 0", email: "a0@example.invalid" });
  assert.equal(store.rowOf("S"), 3);
  assert.equal(store.rowOf("gone"), -1);

  assert.equal(feed.accept({ event: "done", sessionId: 1, total: 5 }), true, "the finished walk says so again");
  assert.deepEqual(feed.status, { state: "done" });
});

test("a reset keeps the old rows on screen until the reload has as many, or ends", () => {
  const feed = new GraphFeed();
  started(feed, 2);
  feed.accept(encodeTestPage({ sessionId: 2, pageIndex: 0, firstRow: 0, rowCount: 4 }));
  feed.accept({ event: "paused", sessionId: 2, rowsLoaded: 4 });
  assert.equal(feed.accept({ event: "reset", sessionId: 2 }), true);
  assert.deepEqual(feed.status, { state: "loading" });
  feed.accept(encodeTestPage({ sessionId: 2, pageIndex: 0, firstRow: 0, rowCount: 2, oids: ["X", "Y"] }));
  assert.equal(feed.store?.oid(0), (0).toString(16).padStart(40, "0"), "still the old rows");
  feed.accept({ event: "done", sessionId: 2, total: 2 });
  assert.equal(feed.store?.rowCount, 2);
  assert.equal(feed.store?.oid(0), "X");
  assert.deepEqual(feed.status, { state: "done" });

  // A reload that reaches the old row count swaps in at once.
  assert.equal(feed.accept({ event: "reset", sessionId: 2 }), true, "a finished session can still refresh");
  feed.accept(encodeTestPage({ sessionId: 2, pageIndex: 0, firstRow: 0, rowCount: 3, oids: ["P", "Q", "R"] }));
  assert.equal(feed.store?.oid(2), "R");
});

test("refresh events from another session are dropped", () => {
  const feed = sessionBeforeSplice();
  assert.equal(feed.accept({ event: "reset", sessionId: 9 }), false);
  assert.equal(feed.store?.rowCount, 4);
});

test("the watch's state is kept for the live-updates marker", () => {
  const feed = new GraphFeed();
  started(feed, 3);
  assert.equal(feed.watch, null);
  assert.equal(feed.accept({ event: "watch", sessionId: 3, watch: { state: "gone" } }), true);
  assert.deepEqual(feed.watch, { state: "gone" });
  assert.equal(feed.accept({ event: "watch", sessionId: 4, watch: { state: "live" } }), false);
});
