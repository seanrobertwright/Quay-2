/// <reference types="node" />
// The neon part names are a contract between the components that mark a live part and the shell
// look stylesheet that draws it: every name has a rule, and every rule names a part.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEON_PARTS, neonPart } from "./neon.ts";

const STYLESHEET = readFileSync(new URL("../slices/shell/shellLook.css", import.meta.url), "utf8");

test("every neon part has a rule in the shell look stylesheet, and every rule names a part", () => {
  const styled = new Set([...STYLESHEET.matchAll(/\[data-neon="([^"]+)"\]/g)].map((m) => m[1]));
  assert.deepEqual([...styled].sort(), [...NEON_PARTS].sort());
});

test("a part is marked only while it is lit", () => {
  assert.equal(neonPart("row", true), "row");
  assert.equal(neonPart("row", false), undefined);
});
