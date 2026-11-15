// Unit tests for the companion's remembered preferences (#636): its width, kept per machine, and
// the Companion opens on setting, both validated when read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage } from "./fixtures/companionFixtures.ts";

test("the width starts at 340 px and is remembered once set", () => {
  const storage = memoryStorage();
  assert.equal(companionPrefs(storage).readWidth(), 340);
  companionPrefs(storage).writeWidth(420);
  assert.equal(companionPrefs(storage).readWidth(), 420);
});

test("a stored width outside 340 to 560 px, or not a number, reads as the nearest allowed width or the default", () => {
  const read = (value: string) => companionPrefs(memoryStorage({ "quay_companion_width": value })).readWidth();
  assert.equal(read("200"), 340);
  assert.equal(read("900"), 560);
  assert.equal(read("abc"), 340);
  assert.equal(read(""), 340);
  assert.equal(read("NaN"), 340);
  assert.equal(read("450.6"), 451);
});

test("Companion opens on reads Pull request by default and for a value it does not know", () => {
  const read = (initial: Record<string, string>) => companionPrefs(memoryStorage(initial)).readOpensOn();
  assert.equal(read({}), "pull-request");
  assert.equal(read({ "quay_companion_opens_on": "ticket" }), "ticket");
  assert.equal(read({ "quay_companion_opens_on": "activity" }), "activity");
  assert.equal(read({ "quay_companion_opens_on": "repository" }), "pull-request");
  assert.equal(read({ "quay_companion_opens_on": "toString" }), "pull-request");
  assert.equal(read({ "quay_companion_opens_on": "" }), "pull-request");
});
