/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lru } from "./lru.ts";

test("past its capacity the cache drops the least recently used entry", () => {
  const cache = new Lru<string, number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.get("a"), undefined, "a was the oldest");
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 2);
});

test("reading an entry makes it the most recent", () => {
  const cache = new Lru<string, number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined, "b, not a, was the least recent");
  assert.equal(cache.get("a"), 1);
});

test("setting a key again replaces its value without growing the cache", () => {
  const cache = new Lru<string, number>(200);
  for (let n = 0; n < 250; n++) cache.set(`oid${n}`, n);
  cache.set("oid249", -1);
  assert.equal(cache.size, 200);
  assert.equal(cache.get("oid249"), -1);
  assert.equal(cache.get("oid49"), undefined);
  assert.equal(cache.get("oid50"), 50);
});
