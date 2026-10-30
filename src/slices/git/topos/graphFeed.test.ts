/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphFeed, LOAD_AHEAD_ROWS, MORE_ROWS } from "./graphFeed.ts";
import { GraphStore } from "./graphStore.ts";
import { PAGE_MAGIC, type GraphPage } from "./graphPage.ts";

/** A format-1 page laid out as `page.rs` lays it out, with one new author per page. */
function encodePage(sessionId: number, pageIndex: number, firstRow: number, rowCount: number): ArrayBuffer {
  const json = new TextEncoder().encode(
    JSON.stringify({
      oids: Array.from({ length: rowCount }, (_, i) => (firstRow + i).toString(16).padStart(40, "0")),
      subjects: Array.from({ length: rowCount }, (_, i) => `commit ${firstRow + i}`),
      newAuthors: [{ name: `Author ${pageIndex}`, email: `a${pageIndex}@example.invalid` }],
    })
  );
  const authorTimeAt = 48;
  const authorIdsAt = authorTimeAt + 8 * rowCount;
  const jsonAt = Math.ceil((authorIdsAt + 4 * rowCount) / 8) * 8;
  const buffer = new ArrayBuffer(jsonAt + json.length);
  const view = new DataView(buffer);
  view.setUint32(0, PAGE_MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 48, true);
  [sessionId, pageIndex, firstRow, rowCount, 0, 0, authorTimeAt, authorIdsAt, jsonAt, json.length].forEach(
    (value, i) => view.setUint32(8 + 4 * i, value, true)
  );
  for (let i = 0; i < rowCount; i++) {
    view.setFloat64(authorTimeAt + 8 * i, 1_700_000_000_000 - (firstRow + i) * 1000, true);
    view.setUint32(authorIdsAt + 4 * i, pageIndex, true);
  }
  new Uint8Array(buffer, jsonAt).set(json);
  return buffer;
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
  return {
    sessionId,
    pageIndex,
    firstRow,
    rowCount,
    authorTimeMs: new Float64Array(rowCount),
    authorIds: new Uint32Array(rowCount),
    oids: Array.from({ length: rowCount }, (_, i) => String(firstRow + i)),
    subjects: Array.from({ length: rowCount }, () => ""),
    newAuthors: pageIndex === 0 ? [{ name: "A", email: "a@x" }] : [],
  };
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
  assert.equal(store.oid(20_479), "20479");
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
