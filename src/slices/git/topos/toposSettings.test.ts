/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_COLUMN_WIDTH, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "./graphColumn.ts";
import { DEFAULT_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH, MIN_INSPECTOR_WIDTH } from "./stagingKeys.ts";
import { DEFAULT_PREFS } from "./toposSettings.ts";

// The Rust store validates topos.json against its own copy of these bounds, so a drift between the
// two would make it throw away a width the resize handle can reach.
const rust = readFileSync(new URL("../../../../src-tauri/src/slices/git/settings.rs", import.meta.url), "utf8");

function rustConst(name: string): string {
  const match = new RegExp(`pub const ${name}: [^=]+= ([^;]+);`).exec(rust);
  assert.ok(match, `settings.rs declares ${name}`);
  return match[1];
}

test("the store's width bounds and defaults are the resize handles'", () => {
  assert.equal(rustConst("GRAPH_COLUMN_WIDTHS"), `${MIN_COLUMN_WIDTH}..=${MAX_COLUMN_WIDTH}`);
  assert.equal(rustConst("INSPECTOR_WIDTHS"), `${MIN_INSPECTOR_WIDTH}..=${MAX_INSPECTOR_WIDTH}`);
  assert.equal(rustConst("DEFAULT_GRAPH_COLUMN_WIDTH"), String(DEFAULT_COLUMN_WIDTH));
  assert.equal(rustConst("DEFAULT_INSPECTOR_WIDTH"), String(DEFAULT_INSPECTOR_WIDTH));
});

test("Topos opens with the 220 px column, the 400 px inspector, a unified diff and a flat list", () => {
  assert.deepEqual(DEFAULT_PREFS, { graphColumnWidth: 220, inspectorWidth: 400, diffMode: "unified", fileListMode: "flat" });
});
