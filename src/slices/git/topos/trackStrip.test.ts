/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitStrip, STRIP_LIMIT } from "./trackStrip.ts";

const tracks = (n: number) => Array.from({ length: n }, (_, i) => i);

test("a narrow history shows every passing track, with nothing behind More (#409)", () => {
  assert.deepEqual(splitStrip(tracks(3)), { shown: [0, 1, 2], more: [] });
  assert.deepEqual(splitStrip(tracks(STRIP_LIMIT)), { shown: tracks(STRIP_LIMIT), more: [] });
  assert.deepEqual(splitStrip([]), { shown: [], more: [] });
});

test("a wide history shows the leftmost tracks and puts the rest behind More, in order", () => {
  const { shown, more } = splitStrip(tracks(450));
  assert.deepEqual(shown, tracks(STRIP_LIMIT));
  assert.equal(more.length, 450 - STRIP_LIMIT);
  assert.equal(more[0], STRIP_LIMIT);
  assert.equal(more[more.length - 1], 449);
});

test("the strip's inline names never grow with the number of tracks", () => {
  assert.deepEqual(splitStrip(tracks(STRIP_LIMIT + 1)), { shown: tracks(STRIP_LIMIT), more: [STRIP_LIMIT] });
  assert.equal(splitStrip(tracks(10_000)).shown.length, STRIP_LIMIT);
});
