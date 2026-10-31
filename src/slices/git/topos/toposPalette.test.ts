/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { toposPaletteEntries } from "./toposPalette.ts";

test("the palette offers New branch and Checkout while Topos targets a repo", () => {
  assert.deepEqual(
    toposPaletteEntries({ path: "C:/src/repo" }).map((e) => [e.id, e.title]),
    [
      ["topos-new-branch", "Topos: New branch…"],
      ["topos-checkout", "Topos: Checkout…"],
    ]
  );
});

test("with no repo for Topos to target, neither entry shows", () => {
  assert.deepEqual(toposPaletteEntries(null), []);
});
