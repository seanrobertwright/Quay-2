/// <reference types="node" />
// The project row menu's items (#509), from the pure item builder: the items, in what order and
// groups, their hints, and the Collapse or Expand label for the row's current state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shownMenu as shown } from "../../test-support/menuEntries.ts";
import { projectMenu, projectMenuLabel } from "./projectMenu.ts";

test("an expanded project's menu lists its items in their groups, ending with Collapse and Remove workspace…", () => {
  assert.deepEqual(shown(projectMenu({ collapsed: false })), [
    "New terminal",
    "New worktree… [Ctrl+Shift+B w]",
    "Swarm preset…",
    "---",
    "Open Topos",
    "GitHub issues & PRs",
    "Workspace settings…",
    "---",
    "Copy path",
    "Open folder in Explorer",
    "---",
    "Collapse",
    "Remove workspace…",
  ]);
});

test("a collapsed project's menu offers Expand in Collapse's place", () => {
  const fold = projectMenu({ collapsed: true }).find((i) => i.action === "toggleCollapse");
  assert.equal(fold?.name, "Expand");
});

test("the menu is named for the workspace it acts on", () => {
  assert.equal(projectMenuLabel({ name: "Quay-2" }), "Workspace Quay-2");
});
