/// <reference types="node" />
// Unit tests for how the builder's canvases move their view for its view keys (motion.ts): the
// graph canvas and the run canvas both move it through `moveView`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveView, type ViewCommand } from "./motion.ts";

const VIEW_COMMANDS: ViewCommand[] = ["fit-view", "zoom-in", "zoom-out", "zoom-reset"];

/** A canvas's React Flow instance that records each move asked of it, by its method's name and arguments. */
function recordingView() {
  const moves: unknown[][] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      moves.push([name, ...args]);
      return true;
    };
  return { moves, view: { fitView: record("fitView"), zoomIn: record("zoomIn"), zoomOut: record("zoomOut"), zoomTo: record("zoomTo") } };
}

/** Runs `body` with the system answering the reduced-motion query with `reduced`. */
function withReducedMotion(reduced: boolean, body: () => void): void {
  const g = globalThis as Record<string, unknown>;
  const window = g.window;
  g.window = { matchMedia: (query: string) => ({ matches: reduced && query === "(prefers-reduced-motion: reduce)" }) };
  try {
    body();
  } finally {
    g.window = window;
  }
}

test("each view key fits the view, zooms in, zooms out or zooms to 100%, over 200 ms", () => {
  const { moves, view } = recordingView();
  withReducedMotion(false, () => {
    for (const command of VIEW_COMMANDS) moveView(view, command);
  });
  assert.deepEqual(moves, [
    ["fitView", { duration: 200 }],
    ["zoomIn", { duration: 200 }],
    ["zoomOut", { duration: 200 }],
    ["zoomTo", 1, { duration: 200 }],
  ]);
});

test("when the system asks for reduced motion, each view key moves the view at once", () => {
  const { moves, view } = recordingView();
  withReducedMotion(true, () => {
    for (const command of VIEW_COMMANDS) moveView(view, command);
  });
  assert.deepEqual(moves, [
    ["fitView", { duration: 0 }],
    ["zoomIn", { duration: 0 }],
    ["zoomOut", { duration: 0 }],
    ["zoomTo", 1, { duration: 0 }],
  ]);
});
