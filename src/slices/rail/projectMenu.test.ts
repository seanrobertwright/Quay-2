/// <reference types="node" />
// The project row menu's items (#509), from the pure item builder: the items, in what order and
// groups, their hints, and the Collapse or Expand label for the row's current state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectMenu, projectMenuLabel, type ProjectMenuEntry } from "./projectMenu.ts";

/** Each item as `name` or `name [hint]`, with `---` between groups. */
function shown(items: ProjectMenuEntry[]): string[] {
  const out: string[] = [];
  items.forEach((item, i) => {
    if (i > 0 && items[i - 1].group !== item.group) out.push("---");
    const tail = !item.enabled ? ` (disabled: ${item.hint})` : item.hint ? ` [${item.hint}]` : "";
    out.push(`${item.name}${tail}`);
  });
  return out;
}

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
