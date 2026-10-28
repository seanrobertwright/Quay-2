import { test } from "node:test";
import assert from "node:assert/strict";
import {
  epochMsFromLocalParts,
  formatLocalDateTimeInput,
  formatUtcDateTime,
  localPartsOf,
  localTimeZoneName,
  parseUtcTimestamp,
  wallClockPartsOf,
} from "./dates.ts";

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

// The local-zone helpers read the process's zone, so these tests fix it. New York skips
// 02:00 to 03:00 on 2026-03-08 and repeats 01:00 to 02:00 on 2026-11-01.
test("local parts build the moment they name in the local zone", () => {
  process.env.TZ = "America/New_York";
  assert.equal(epochMsFromLocalParts({ year: 2026, month: 10, day: 21, hour: 14, minute: 6 }), Date.UTC(2026, 9, 21, 18, 6));
  assert.equal(epochMsFromLocalParts({ year: 2026, month: 1, day: 5, hour: 0, minute: 0 }), Date.UTC(2026, 0, 5, 5, 0));
  const ancient = epochMsFromLocalParts({ year: 50, month: 6, day: 1, hour: 12, minute: 0 });
  assert.notEqual(ancient, null);
  assert.equal(localPartsOf(ancient!).year, 50, "a two-digit year isn't read as 19xx");
});

test("parts that name no day, or a time the zone skips, build nothing", () => {
  process.env.TZ = "America/New_York";
  const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
    epochMsFromLocalParts({ year, month, day, hour, minute });
  assert.equal(at(2026, 2, 30), null);
  assert.equal(at(2026, 13, 1), null);
  assert.equal(at(2026, 1, 1, 24), null);
  assert.equal(at(2026, 1, 1, 0, 60), null);
  assert.equal(at(2026, 1, 1.5), null);
  assert.equal(at(Number.NaN, 1, 1), null);
  assert.equal(at(0, 1, 1), null);
  assert.equal(at(2026, 3, 8, 2, 30), null, "skipped when clocks go forward");
  assert.equal(at(2026, 11, 1, 1, 30), Date.UTC(2026, 10, 1, 5, 30), "the earlier of a repeated time");
});

test("a moment shows as local input text and as UTC", () => {
  process.env.TZ = "America/New_York";
  const ms = Date.UTC(2026, 9, 21, 18, 6, 59);
  assert.equal(formatLocalDateTimeInput(ms), "2026-10-21T14:06");
  assert.equal(formatUtcDateTime(ms), "2026-10-21 18:06 UTC");
  assert.deepEqual(wallClockPartsOf(Date.UTC(2026, 9, 21, 14, 6)), { year: 2026, month: 10, day: 21, hour: 14, minute: 6 });
  assert.equal(localTimeZoneName(), "America/New_York");
});
