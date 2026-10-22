import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUtcTimestamp } from "./dates.ts";

test("a UTC timestamp reads as its moment, with or without fractional seconds", () => {
  assert.equal(parseUtcTimestamp("2026-10-21T19:03:04.123Z"), Date.UTC(2026, 9, 21, 19, 3, 4, 123));
  assert.equal(parseUtcTimestamp("2026-10-21T19:03:04Z"), Date.UTC(2026, 9, 21, 19, 3, 4));
  assert.equal(parseUtcTimestamp("2026-10-21T19:03:04.1234567Z"), Date.UTC(2026, 9, 21, 19, 3, 4, 123));
});

test("a timestamp with no zone, another zone or an impossible date or time is not read", () => {
  for (const text of ["2026-10-21T19:03:04", "2026-10-21T19:03:04+02:00", "2026-02-30T00:00:00Z", "2026-10-21T24:00:00Z", "2026-10-21", ""]) {
    assert.equal(parseUtcTimestamp(text), null, text);
  }
});
