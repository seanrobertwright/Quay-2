/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dropMissingTerminals,
  findStoredView,
  restoreProjectView,
  showTerminal,
  switchLayout,
  toStoredView,
  type ProjectView,
} from "./viewState.ts";

const gridView: ProjectView = {
  layout: "grid",
  primaryTerminalId: "a",
  secondaryTerminalId: "b",
  gridTerminalIds: ["a", "b", "c", "d"],
  focusedPane: "grid-2",
  splitRatio: 35,
  zoomedFromLayout: null,
  activeTerminalId: "c",
};

test("a saved view comes back exactly as it was saved when all its terminals still exist", () => {
  const restored = restoreProjectView(toStoredView(gridView), ["a", "b", "c", "d"]);

  assert.deepEqual(restored, gridView);
});

test("a project with no saved view shows its first terminal on its own", () => {
  const restored = restoreProjectView(undefined, ["x", "y"]);

  assert.equal(restored.layout, "single");
  assert.equal(restored.primaryTerminalId, "x");
  assert.equal(restored.activeTerminalId, "x");
  assert.equal(restored.focusedPane, "primary");
  assert.equal(restored.splitRatio, 50);
  assert.deepEqual(restored.gridTerminalIds, [null, null, null, null]);
});

test("a project with no saved view and no terminals restores to an empty single pane", () => {
  const restored = restoreProjectView(null, []);

  assert.equal(restored.layout, "single");
  assert.equal(restored.primaryTerminalId, null);
  assert.equal(restored.activeTerminalId, null);
});

test("a saved terminal that no longer exists leaves its grid slot empty instead of pulling in another terminal", () => {
  const restored = restoreProjectView(toStoredView(gridView), ["a", "c", "d", "spare"]);

  assert.deepEqual(restored.gridTerminalIds, ["a", null, "c", "d"]);
  assert.equal(restored.secondaryTerminalId, null);
  assert.equal(restored.layout, "grid");
});

test("a missing terminal in a split leaves that pane empty and keeps the split", () => {
  const split: ProjectView = {
    ...gridView,
    layout: "split-vertical",
    focusedPane: "secondary",
    activeTerminalId: "b",
  };

  const restored = restoreProjectView(toStoredView(split), ["a", "other"]);

  assert.equal(restored.layout, "split-vertical");
  assert.equal(restored.primaryTerminalId, "a");
  assert.equal(restored.secondaryTerminalId, null);
  assert.equal(restored.focusedPane, "secondary");
  assert.equal(restored.activeTerminalId, null);
});

test("when the selected terminal is gone, the selection moves to the terminal in the focused pane", () => {
  const restored = restoreProjectView(
    toStoredView({ ...gridView, activeTerminalId: "gone", focusedPane: "grid-3" }),
    ["a", "b", "c", "d"]
  );

  assert.equal(restored.activeTerminalId, "d");
});

test("another project's terminals are never restored into this project's panes", () => {
  // The grid was saved while terminals from project B had leaked into it.
  const leaked = toStoredView({ ...gridView, gridTerminalIds: ["a", "b-of-other-project", null, null] });

  const restored = restoreProjectView(leaked, ["a", "b", "c", "d"]);

  assert.deepEqual(restored.gridTerminalIds, ["a", null, null, null]);
});

test("zoom is restored along with the layout it was zoomed from", () => {
  const zoomed: ProjectView = { ...gridView, layout: "single", zoomedFromLayout: "grid" };

  const restored = restoreProjectView(toStoredView(zoomed), ["a", "b", "c", "d"]);

  assert.equal(restored.layout, "single");
  assert.equal(restored.zoomedFromLayout, "grid");
});

test("a garbled saved view falls back to safe values field by field", () => {
  const restored = restoreProjectView(
    {
      layout: "triple",
      primary_terminal_id: 7,
      secondary_terminal_id: "b",
      grid_terminal_ids: ["a"],
      split_ratio: 400,
      zoomed_from_layout: "sideways",
      focused_pane: "grid-9",
      active_terminal_id: "b",
    },
    ["a", "b"]
  );

  assert.equal(restored.layout, "single");
  assert.equal(restored.primaryTerminalId, null);
  assert.equal(restored.secondaryTerminalId, "b");
  assert.deepEqual(restored.gridTerminalIds, ["a", null, null, null]);
  assert.equal(restored.splitRatio, 85);
  assert.equal(restored.zoomedFromLayout, null);
  assert.equal(restored.focusedPane, "primary");
  assert.equal(restored.activeTerminalId, "b");
});

test("the split ratio is kept between 15% and 85%", () => {
  assert.equal(restoreProjectView({ split_ratio: 3 }, []).splitRatio, 15);
  assert.equal(restoreProjectView({ split_ratio: 61.5 }, []).splitRatio, 61.5);
  assert.equal(restoreProjectView({ split_ratio: Number.NaN }, []).splitRatio, 50);
});

test("toStoredView writes the snake_case record the backend keeps", () => {
  assert.deepEqual(toStoredView(gridView), {
    layout: "grid",
    primary_terminal_id: "a",
    secondary_terminal_id: "b",
    grid_terminal_ids: ["a", "b", "c", "d"],
    split_ratio: 35,
    zoomed_from_layout: null,
    focused_pane: "grid-2",
    active_terminal_id: "c",
  });
});

test("dropMissingTerminals returns the same object when nothing is missing", () => {
  assert.equal(dropMissingTerminals(gridView, ["a", "b", "c", "d"]), gridView);
});

test("dropMissingTerminals empties a secondary pane that shows the primary's terminal", () => {
  const dup: ProjectView = { ...gridView, layout: "split-horizontal", secondaryTerminalId: "a" };

  assert.equal(dropMissingTerminals(dup, ["a", "b", "c", "d"]).secondaryTerminalId, null);
});

test("showTerminal focuses the pane already showing the terminal", () => {
  const shown = showTerminal(gridView, "b");

  assert.equal(shown.focusedPane, "grid-1");
  assert.equal(shown.activeTerminalId, "b");
  assert.deepEqual(shown.gridTerminalIds, gridView.gridTerminalIds);
});

test("showTerminal puts a terminal that isn't showing into the focused pane", () => {
  const split: ProjectView = { ...gridView, layout: "split-horizontal", focusedPane: "secondary" };

  const shown = showTerminal(split, "z");

  assert.equal(shown.secondaryTerminalId, "z");
  assert.equal(shown.primaryTerminalId, "a");
  assert.equal(shown.activeTerminalId, "z");
});

test("showTerminal in a single pane makes the terminal the primary", () => {
  const single: ProjectView = { ...gridView, layout: "single", focusedPane: "primary" };

  const shown = showTerminal(single, "z");

  assert.equal(shown.primaryTerminalId, "z");
  assert.equal(shown.activeTerminalId, "z");
});

test("switching into a split fills an empty second pane with another terminal", () => {
  const single: ProjectView = { ...gridView, layout: "single", secondaryTerminalId: null };

  const split = switchLayout(single, "split-vertical", ["a", "b", "c"]);

  assert.equal(split.layout, "split-vertical");
  assert.equal(split.secondaryTerminalId, "b");
});

test("switching into a split keeps a second pane that already shows another terminal", () => {
  const single: ProjectView = { ...gridView, layout: "single", secondaryTerminalId: "c" };

  assert.equal(switchLayout(single, "split-horizontal", ["a", "b", "c"]).secondaryTerminalId, "c");
});

test("switching into a split with only one terminal stays in the current layout", () => {
  const single: ProjectView = { ...gridView, layout: "single", secondaryTerminalId: null };

  assert.equal(switchLayout(single, "split-horizontal", ["a"]), single);
});

test("switching to single or grid only changes the layout", () => {
  const split: ProjectView = { ...gridView, layout: "split-horizontal" };

  assert.deepEqual(switchLayout(split, "single", ["a"]), { ...split, layout: "single" });
  assert.deepEqual(switchLayout(split, "grid", ["a"]), { ...split, layout: "grid" });
});

test("findStoredView matches a project path the way isSamePath does", () => {
  const stored = toStoredView(gridView);
  const views = { "C:\\Repos\\Quay": stored };

  assert.equal(findStoredView(views, "c:/Repos/Quay/"), stored);
  assert.equal(findStoredView(views, "C:\\Repos\\Quay-2"), undefined);
});
