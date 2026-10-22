/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { singleLayoutTerminalId } from "./singlePane.ts";

test("zoomed from a split, the stage shows the pane that had focus, not the left one", () => {
  // Ctrl+B O moved focus to the right-hand pane, then Ctrl+B Z zoomed.
  assert.equal(singleLayoutTerminalId({ primaryTerminalId: "lead-dev", activeTerminalId: "build-watcher", zoomed: true }), "build-watcher");
  assert.equal(singleLayoutTerminalId({ primaryTerminalId: "lead-dev", activeTerminalId: "lead-dev", zoomed: true }), "lead-dev");
});

test("a single layout that was never zoomed shows its primary terminal, or the active one when it has none", () => {
  assert.equal(singleLayoutTerminalId({ primaryTerminalId: "a", activeTerminalId: "b", zoomed: false }), "a");
  assert.equal(singleLayoutTerminalId({ primaryTerminalId: null, activeTerminalId: "b", zoomed: false }), "b");
  assert.equal(singleLayoutTerminalId({ primaryTerminalId: "a", activeTerminalId: null, zoomed: true }), "a");
});
