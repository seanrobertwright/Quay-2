// Unit tests for the module bar's badge and spend ticker text (#633).
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeText, spendText } from "./barBadges.ts";

test("a badge shows nothing at zero and caps at 99+", () => {
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(1), "1");
  assert.equal(badgeText(99), "99");
  assert.equal(badgeText(100), "99+");
});

test("the spend ticker fits the 48 px bar: cents below $100, whole dollars below $1,000, then thousands", () => {
  assert.equal(spendText(0), "$0.00");
  assert.equal(spendText(3.456), "$3.46");
  assert.equal(spendText(99.994), "$99.99");
  assert.equal(spendText(123.4), "$123");
  assert.equal(spendText(1234), "$1.2k");
  assert.equal(spendText(25_000), "$25k");
});

test("the spend ticker shows no amount for a missing or bad figure", () => {
  assert.equal(spendText(Number.NaN), "$–");
  assert.equal(spendText(-1), "$–");
});
