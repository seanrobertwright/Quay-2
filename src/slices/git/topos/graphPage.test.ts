/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeGraphPage, GraphPageError, OPEN_ROW, PAGE_MAGIC } from "./graphPage.ts";

/** The page `page.rs`'s fixture test encodes: page 2 of session 7, rows 1024 to 1026. */
function fixture(): ArrayBuffer {
  const bytes = readFileSync(new URL("./fixtures/graph-page-v2.bin", import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test("decodes the page Rust encoded", () => {
  const page = decodeGraphPage(fixture());
  assert.equal(page.sessionId, 7);
  assert.equal(page.pageIndex, 2);
  assert.equal(page.firstRow, 1024);
  assert.equal(page.rowCount, 3);
  assert.deepEqual(page.oids, ["a".repeat(40), "b".repeat(40), "c".repeat(40)]);
  assert.deepEqual(page.subjects, ["Add the graph", 'Fix "quotes" and ünïcode', "Initial commit"]);
  assert.deepEqual([...page.authorTimeMs], [1_700_000_000_000, 1_699_999_000_000, 1_699_998_000_000]);
  // Author 0 came in an earlier page; this one adds Ada (1) and Bo (2).
  assert.deepEqual([...page.authorIds], [1, 2, 1]);
  assert.deepEqual(page.newAuthors, [
    { name: "Ada", email: "ada@example.invalid" },
    { name: "Bo", email: "bo@example.invalid" },
  ]);
});

test("decodes the lane layout Rust encoded", () => {
  const page = decodeGraphPage(fixture());
  assert.deepEqual([...page.rowLanes], [0, 1, 0]);
  assert.deepEqual([...page.rowTracks], [0, 5, 0]);
  assert.equal(page.firstEdge, 40);
  assert.equal(page.edgeCount, 2);
  // childRow, parentRow, lane, childLane, parentLane, track
  assert.deepEqual([...page.edges], [1024, 1026, 0, 0, 0, 0, 1025, OPEN_ROW, 1, 1, 1, 5]);
  assert.deepEqual([...page.closes], [39, 1025, 1]);
  assert.deepEqual([...page.checkpoint], [37, 39]);
  assert.equal(page.peakLanes, 3);
  assert.deepEqual(page.newTracks, [{ id: 5, key: "feature", kind: "named", left: 0, right: null }]);
});

test("the magic spells TGPG", () => {
  assert.equal(new TextDecoder().decode(new Uint8Array(fixture(), 0, 4)), "TGPG");
  assert.equal(new DataView(fixture()).getUint32(0, true), PAGE_MAGIC);
});

test("rejects an unknown magic", () => {
  const buffer = fixture();
  new DataView(buffer).setUint32(0, 0x12345678, true);
  assert.throws(() => decodeGraphPage(buffer), GraphPageError);
});

test("rejects an unknown format version", () => {
  const buffer = fixture();
  new DataView(buffer).setUint16(4, 1, true);
  assert.throws(() => decodeGraphPage(buffer), /format 1 is not supported/);
});

test("rejects a cut-off page or one whose sections lie outside it", () => {
  assert.throws(() => decodeGraphPage(fixture().slice(0, 40)), GraphPageError);
  assert.throws(() => decodeGraphPage(fixture().slice(0, 100)), GraphPageError);
  const buffer = fixture();
  new DataView(buffer).setUint32(20, 1_000_000, true);
  assert.throws(() => decodeGraphPage(buffer), GraphPageError);
  const edges = fixture();
  new DataView(edges).setUint32(24, 1_000_000, true);
  assert.throws(() => decodeGraphPage(edges), GraphPageError);
});

test("rejects a track record that isn't one", () => {
  const buffer = fixture();
  const bytes = new Uint8Array(buffer);
  const at = Buffer.from(bytes).indexOf('"named"');
  assert.ok(at > 0);
  bytes.set(new TextEncoder().encode('"other"'), at);
  assert.throws(() => decodeGraphPage(buffer), /doesn't match its rows/);
});
