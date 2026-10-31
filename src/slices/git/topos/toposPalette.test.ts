/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { toposPaletteEntries } from "./toposPalette.ts";

test("the palette offers New branch, Checkout, Fetch, Pull and Push while Topos targets a repo", () => {
  assert.deepEqual(
    toposPaletteEntries({ path: "C:/src/repo" }).map((e) => [e.id, e.title, e.request]),
    [
      ["topos-new-branch", "Topos: New branch…", "newBranch"],
      ["topos-checkout", "Topos: Checkout…", "checkout"],
      ["topos-fetch", "Topos: Fetch", "fetch"],
      ["topos-pull", "Topos: Pull", "pull"],
      ["topos-push", "Topos: Push", "push"],
    ]
  );
});

test("with no repo for Topos to target, no entry shows", () => {
  assert.deepEqual(toposPaletteEntries(null), []);
});

test("network operations have no keys of their own", () => {
  for (const entry of toposPaletteEntries({ path: "C:/src/repo" })) {
    assert.equal(Object.prototype.hasOwnProperty.call(entry, "shortcut"), false, entry.id);
  }
});
