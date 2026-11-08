/// <reference types="node" />
// The worktree row menu's items (#509), from the pure item builder: the items, in what order and
// groups, and Copy branch name on a worktree whose HEAD is detached.
import { test } from "node:test";
import assert from "node:assert/strict";
import { worktreeBranch, worktreeMenu, worktreeMenuLabel, type WorktreeMenuEntry } from "./worktreeMenu.ts";

/** Each item as `name` or `name (disabled: why)`, with `---` between groups. */
function shown(items: WorktreeMenuEntry[]): string[] {
  const out: string[] = [];
  items.forEach((item, i) => {
    if (i > 0 && items[i - 1].group !== item.group) out.push("---");
    const tail = !item.enabled ? ` (disabled: ${item.hint})` : item.hint ? ` [${item.hint}]` : "";
    out.push(`${item.name}${tail}`);
  });
  return out;
}

test("a worktree on a branch lists its items in their groups", () => {
  assert.deepEqual(shown(worktreeMenu({ branch: "refs/heads/ticket-509" })), [
    "New terminal here",
    "---",
    "Copy path",
    "Copy branch name",
    "Open folder in Explorer",
    "---",
    "Remove worktree…",
  ]);
});

test("a worktree with a detached HEAD has no branch name to copy, and says so", () => {
  const copy = worktreeMenu({ branch: "" }).find((i) => i.action === "copyBranchName");
  assert.deepEqual(copy && { enabled: copy.enabled, hint: copy.hint }, { enabled: false, hint: "Detached HEAD" });
});

test("the branch name drops git's refs/heads/ prefix, and a detached HEAD has none", () => {
  assert.equal(worktreeBranch({ branch: "refs/heads/feat/menus" }), "feat/menus");
  assert.equal(worktreeBranch({ branch: "" }), null);
});

test("the menu is named for the worktree it acts on", () => {
  assert.equal(worktreeMenuLabel("ticket-509"), "Worktree ticket-509");
});
