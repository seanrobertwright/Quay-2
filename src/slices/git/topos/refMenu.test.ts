/// <reference types="node" />
// The badge and commit-row menus as the shared context menu shows them (#510): the same items as
// `badgeMenu` and `commitMenu` give, in order, with each disabled one's reason as its hint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeMenu, commitMenu, refMenuItems, type RefAction, type RefContext } from "./refActions.ts";

const A = "a".repeat(40);

const ctx: RefContext = {
  selectedPath: "C:/src/repo-feat",
  worktrees: [
    { path: "C:/src/repo", oid: A, branch: "main" },
    { path: "C:/src/repo-feat", oid: A, branch: "feat" },
  ],
  busy: null,
  remotes: ["origin"],
};

/** Each item as the menu shows it: its name, whether it runs, and its hint. */
const shown = (items: ReturnType<typeof refMenuItems>) => items.map((i) => [i.name, i.enabled, i.hint]);

test("a badge's menu shows its items in order, a disabled one with its reason as the hint", () => {
  const items = refMenuItems(badgeMenu({ kind: "local", name: "main" }, A, ctx), () => {});
  assert.deepEqual(shown(items), [
    ["Checkout", false, "Checked out in worktree repo"],
    ["Show that worktree", true, undefined],
    ["Create branch here…", true, undefined],
    ["Rename…", true, undefined],
    ["Set upstream…", true, undefined],
    ["Delete…", false, "Checked out in worktree repo"],
    ["Show only this branch", true, undefined],
  ]);
  // One group, so no separator splits the list.
  assert.equal(new Set(items.map((i) => i.group)).size, 1);
});

test("choosing an enabled item runs the action it stands for", () => {
  const ran: RefAction[] = [];
  const items = refMenuItems(commitMenu(A, ctx), (action) => ran.push(action));
  assert.deepEqual(
    items.map((i) => i.name),
    ["Create branch here…", "Create tag here…", "Checkout detached", "Copy SHA"]
  );
  for (const item of items) item.onChoose();
  assert.deepEqual(ran, [
    { kind: "createBranch", at: A },
    { kind: "createTag", at: A },
    { kind: "checkout", target: { kind: "detached", at: A } },
    { kind: "copySha", oid: A },
  ]);
});

test("while a checkout can't run, the commit's Checkout detached says why and runs nothing", () => {
  const ran: RefAction[] = [];
  const busy = { ...ctx, busy: "A rebase is under way" };
  const checkout = refMenuItems(commitMenu(A, busy), (action) => ran.push(action))[2];
  assert.deepEqual([checkout.name, checkout.enabled, checkout.hint], ["Checkout detached", false, "A rebase is under way"]);
  checkout.onChoose();
  assert.deepEqual(ran, []);
});
