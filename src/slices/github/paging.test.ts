import { test } from "node:test";
import assert from "node:assert/strict";
import { appendPage, canLoadMore, emptyPagedList, loadedCountLabel } from "./paging.ts";

const items = (...numbers: number[]) => numbers.map((number) => ({ number }));

test("a first page replaces the list, later pages append after it", () => {
  const stale = { items: items(9), endCursor: "old", hasNextPage: true };
  const first = appendPage(stale, { items: items(5, 4), endCursor: "a", hasNextPage: true }, true);
  assert.deepEqual(first, { items: items(5, 4), endCursor: "a", hasNextPage: true });
  const second = appendPage(first, { items: items(3, 2), endCursor: "b", hasNextPage: false }, false);
  assert.deepEqual(second.items, items(5, 4, 3, 2));
  assert.equal(second.endCursor, "b");
  assert.equal(second.hasNextPage, false);
});

test("an item already loaded is not added twice when the list shifts between pages", () => {
  const first = appendPage(emptyPagedList<{ number: number }>(), { items: items(5, 4), endCursor: "a", hasNextPage: true }, true);
  const second = appendPage(first, { items: items(4, 3), endCursor: "b", hasNextPage: true }, false);
  assert.deepEqual(second.items, items(5, 4, 3));
});

test("a page with no cursor ends paging even if it claims a next page", () => {
  const list = appendPage(emptyPagedList<{ number: number }>(), { items: items(1), endCursor: null, hasNextPage: true }, true);
  assert.equal(list.hasNextPage, false);
});

test("the count says how many are loaded and whether that is all of them", () => {
  assert.equal(loadedCountLabel({ items: items(1, 2), endCursor: "a", hasNextPage: true }), "2 loaded");
  assert.equal(loadedCountLabel({ items: items(1, 2), endCursor: null, hasNextPage: false }), "All 2 loaded");
});

test("a list stops paging at its cap, and its count says so", () => {
  const under = { items: items(1, 2), endCursor: "a", hasNextPage: true };
  assert.equal(canLoadMore(under, 3), true);
  const atCap = { items: items(1, 2, 3), endCursor: "b", hasNextPage: true };
  assert.equal(canLoadMore(atCap, 3), false);
  assert.equal(loadedCountLabel(atCap, 3), "First 3 shown; filter to narrow the list");
  const complete = { items: items(1, 2, 3), endCursor: null, hasNextPage: false };
  assert.equal(canLoadMore(complete, 3), false);
  assert.equal(loadedCountLabel(complete, 3), "All 3 loaded");
});
