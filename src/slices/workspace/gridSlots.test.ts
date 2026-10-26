/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseGridSlots } from "./gridSlots.ts";

test("when the grid is showing with all four slots filled, splitGrid leaves the slots unchanged", () => {
  const slots = chooseGridSlots({
    layout: "grid",
    currentSlots: ["test-architect", "feature-impl", "test-runner", "reviewer"],
    visibleTerminalIds: ["pwsh", "test-architect", "feature-impl", "test-runner", "reviewer"],
    activeTerminalId: "feature-impl",
  });

  assert.deepEqual(slots, ["test-architect", "feature-impl", "test-runner", "reviewer"]);
});

test("when the grid is showing with an empty slot, splitGrid fills only that slot with the first visible terminal not already in the grid", () => {
  const slots = chooseGridSlots({
    layout: "grid",
    currentSlots: ["test-architect", null, "test-runner", "reviewer"],
    visibleTerminalIds: ["test-architect", "pwsh", "feature-impl", "test-runner", "reviewer"],
    activeTerminalId: "reviewer",
  });

  assert.deepEqual(slots, ["test-architect", "pwsh", "test-runner", "reviewer"]);
});

test("switching into the grid from single puts the active terminal first, then fills in rail order", () => {
  const slots = chooseGridSlots({
    layout: "single",
    currentSlots: [null, null, null, null],
    visibleTerminalIds: ["pwsh", "test-architect", "feature-impl", "test-runner", "reviewer"],
    activeTerminalId: "feature-impl",
  });

  assert.deepEqual(slots, ["feature-impl", "pwsh", "test-architect", "test-runner"]);
});
