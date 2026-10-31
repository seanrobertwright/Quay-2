/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badgeMenu,
  checkoutDone,
  commitMenu,
  graphKey,
  nextBadge,
  primaryAction,
  refFailure,
  type RefContext,
} from "./refActions.ts";

const A = "a".repeat(40);

const ctx: RefContext = {
  selectedPath: "C:/src/repo-feat",
  worktrees: [
    { path: "C:/src/repo", oid: A, branch: "main" },
    { path: "C:/src/repo-feat", oid: A, branch: "feat" },
  ],
  busy: null,
};

/** Each item as `label` or `label (disabled: why)`, for a readable comparison. */
const shown = (items: ReturnType<typeof badgeMenu>) =>
  items.map((i) => (i.action === null ? `${i.label} (disabled: ${i.disabledReason})` : i.label));

test("a local branch's menu checks it out and creates a branch at its commit", () => {
  const menu = badgeMenu({ kind: "local", name: "side" }, A, ctx);
  assert.deepEqual(shown(menu), ["Checkout", "Create branch here…"]);
  assert.deepEqual(menu[0].action, { kind: "checkout", target: { kind: "branch", name: "side" } });
  assert.deepEqual(menu[1].action, { kind: "createBranch", at: A });
});

test("a branch checked out in another worktree can't be checked out, and offers that worktree", () => {
  const menu = badgeMenu({ kind: "local", name: "main" }, A, ctx);
  assert.deepEqual(shown(menu), [
    "Checkout (disabled: Checked out in worktree repo)",
    "Show that worktree",
    "Create branch here…",
  ]);
  assert.deepEqual(menu[1].action, { kind: "showWorktree", path: "C:/src/repo" });
});

test("the branch the selected worktree has checked out is already checked out", () => {
  const menu = badgeMenu({ kind: "local", name: "feat" }, A, { ...ctx, selectedPath: "c:\\src\\repo-feat\\" });
  assert.deepEqual(shown(menu), ["Checkout (disabled: Already checked out here)", "Create branch here…"]);
});

test("a remote branch checks out its tracking branch, and a tag checks out detached", () => {
  assert.deepEqual(badgeMenu({ kind: "remote", name: "origin/topic" }, A, ctx)[0].action, {
    kind: "checkout",
    target: { kind: "remote", name: "origin/topic" },
  });
  const tag = badgeMenu({ kind: "tag", name: "v1" }, A, ctx);
  assert.deepEqual(shown(tag), ["Checkout detached", "Create branch here…"]);
  assert.deepEqual(tag[0].action, { kind: "checkout", target: { kind: "detached", at: A } });
});

test("another worktree's HEAD offers that worktree; the selected one's has no menu of its own", () => {
  assert.deepEqual(badgeMenu({ kind: "head", name: "repo", path: "C:/src/repo", current: false }, A, ctx), [
    { label: "Show that worktree", action: { kind: "showWorktree", path: "C:/src/repo" } },
  ]);
  assert.deepEqual(badgeMenu({ kind: "head", name: "repo-feat", path: "C:/src/repo-feat", current: true }, A, ctx), []);
});

test("the commit row offers create branch, create tag (not yet), checkout detached and copy SHA", () => {
  const menu = commitMenu(A, ctx);
  assert.deepEqual(shown(menu), [
    "Create branch here…",
    "Create tag here… (disabled: Tags arrive in a later version)",
    "Checkout detached",
    "Copy SHA",
  ]);
  assert.deepEqual(menu[2].action, { kind: "checkout", target: { kind: "detached", at: A } });
  assert.deepEqual(menu[3].action, { kind: "copySha", oid: A });
});

test("while an operation is under way every checkout is disabled with the reason", () => {
  const busy = { ...ctx, busy: "Finish or abort the merge first" };
  const why = "Checkout (disabled: Finish or abort the merge first)";
  assert.equal(shown(badgeMenu({ kind: "local", name: "side" }, A, busy))[0], why);
  assert.equal(shown(badgeMenu({ kind: "remote", name: "origin/topic" }, A, busy))[0], why);
  assert.equal(shown(commitMenu(A, busy))[2], "Checkout detached (disabled: Finish or abort the merge first)");
  assert.equal(shown(badgeMenu({ kind: "local", name: "side" }, A, busy))[1], "Create branch here…", "creating stays");
});

test("double-click or Enter checks out a local or remote badge, and only says why when it can't", () => {
  assert.deepEqual(primaryAction({ kind: "local", name: "side" }, A, ctx), {
    action: { kind: "checkout", target: { kind: "branch", name: "side" } },
  });
  assert.deepEqual(primaryAction({ kind: "remote", name: "origin/topic" }, A, ctx), {
    action: { kind: "checkout", target: { kind: "remote", name: "origin/topic" } },
  });
  assert.deepEqual(primaryAction({ kind: "local", name: "main" }, A, ctx), {
    blocked: "Checked out in worktree repo",
    worktree: "C:/src/repo",
  });
  assert.deepEqual(primaryAction({ kind: "local", name: "side" }, A, { ...ctx, busy: "Finish the rebase first" }), {
    blocked: "Finish the rebase first",
    worktree: null,
  });
});

test("a tag and the selected worktree's HEAD have no double-click action; another HEAD shows its worktree", () => {
  assert.equal(primaryAction({ kind: "tag", name: "v1" }, A, ctx), null);
  assert.equal(primaryAction({ kind: "local", name: "feat" }, A, ctx), null);
  assert.equal(primaryAction({ kind: "head", name: "repo-feat", path: "C:/src/repo-feat", current: true }, A, ctx), null);
  assert.deepEqual(primaryAction({ kind: "head", name: "repo", path: "C:/src/repo", current: false }, A, ctx), {
    action: { kind: "showWorktree", path: "C:/src/repo" },
  });
});

const plain = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };

test("in the graph, b creates a branch, Enter checks out, and Shift+F10 or the menu key opens the menu", () => {
  const keys = ["b", "B", "Enter", "ContextMenu", "ArrowRight", "ArrowLeft", "t", "x", "F10"].map((key) =>
    graphKey({ key, ...plain }, false)
  );
  assert.deepEqual(keys, ["createBranch", "createBranch", "checkout", "menu", "nextBadge", "previousBadge", null, null, null]);
  assert.equal(graphKey({ key: "F10", ...plain, shiftKey: true }, false), "menu");
});

test("graph keys never act in a text field or with Ctrl, Alt or Meta", () => {
  assert.equal(graphKey({ key: "b", ...plain }, true), null);
  assert.equal(graphKey({ key: "Enter", ...plain }, true), null);
  for (const mod of ["ctrlKey", "altKey", "metaKey"] as const) {
    for (const key of ["b", "Enter", "ContextMenu", "ArrowRight"]) {
      assert.equal(graphKey({ key, ...plain, [mod]: true }, false), null, `${mod}+${key}`);
    }
  }
});

test("the badge cursor moves right from the row onto its badges and left back off them", () => {
  assert.equal(nextBadge(null, 3, "nextBadge"), 0);
  assert.equal(nextBadge(0, 3, "nextBadge"), 1);
  assert.equal(nextBadge(2, 3, "nextBadge"), 2, "stops on the last badge");
  assert.equal(nextBadge(1, 3, "previousBadge"), 0);
  assert.equal(nextBadge(0, 3, "previousBadge"), null, "back to the row itself");
  assert.equal(nextBadge(null, 0, "nextBadge"), null, "a row without badges keeps the row");
  assert.equal(nextBadge(5, 2, "nextBadge"), 1, "a cursor past a shorter row comes back onto its last badge");
});

test("a checkout that would overwrite local changes lists the files and points to the inspector", () => {
  const failure = refFailure("side", { kind: "checkoutWouldOverwrite", paths: ["README.md", "src/<b>.ts"] });
  assert.deepEqual(failure, {
    text: "Checking out side would overwrite changes to 2 files. Commit, stash or discard them in the inspector first.",
    lines: ["README.md", "src/<b>.ts"],
    worktree: null,
    openInspector: true,
  });
});

test("a long list of files is cut to the first few and a count", () => {
  const paths = Array.from({ length: 9 }, (_, i) => `f${i}.txt`);
  const failure = refFailure("side", { kind: "checkoutWouldOverwrite", paths });
  assert.deepEqual(failure.lines, ["f0.txt", "f1.txt", "f2.txt", "f3.txt", "f4.txt", "and 4 more"]);
});

test("a branch in another worktree names it and offers it; a bad name and git's own words read as they are", () => {
  assert.deepEqual(refFailure("main", { kind: "branchInOtherWorktree", worktree: "C:/src/repo" }), {
    text: "main is checked out in worktree repo",
    lines: [],
    worktree: "C:/src/repo",
    openInspector: false,
  });
  assert.equal(refFailure("a..b", { kind: "invalidRefName", name: "a..b" }).text, "a..b isn't a valid branch name or commit");
  assert.equal(refFailure("x", { kind: "other", stderr: "fatal: a branch named 'x' already exists" }).text, "fatal: a branch named 'x' already exists");
  assert.equal(refFailure("x", { kind: "stagingBusy" }).text, "Another git operation is running in this worktree; try again once it's done");
});

test("a checkout's toast names the branch the worktree landed on, or the commit it detached at", () => {
  assert.equal(checkoutDone({ kind: "branch", name: "side" }, "side"), "Checked out side");
  assert.equal(checkoutDone({ kind: "remote", name: "origin/topic" }, "topic"), "Checked out topic, tracking origin/topic");
  assert.equal(checkoutDone({ kind: "detached", at: A }, null), "Checked out aaaaaaa, detached");
});
