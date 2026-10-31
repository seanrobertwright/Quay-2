/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerView, confirmAbort, confirmSkip, stepDoneMessage, stepFailure, type OpState } from "./operationBanner.ts";

/** A state as `git_operation_state` sends it, with nothing to resolve unless `over` says so. */
function state(over: Partial<OpState>): OpState {
  return { kind: "none", leftLabel: null, rightLabel: null, message: null, conflicts: [], conflictsTotal: 0, ...over };
}

const MERGE = state({
  kind: "merge",
  leftLabel: { role: "HEAD", name: "main" },
  rightLabel: { role: "Incoming", name: "feature" },
  message: "Merge branch 'feature'\n",
});

test("a merge names HEAD and the incoming branch, leaving ours and theirs to the tooltips", () => {
  const view = bannerView(MERGE, { running: false });
  assert.equal(view?.kind, "operation");
  if (view?.kind !== "operation") return;
  assert.equal(view.title, "Merge in progress");
  assert.equal(view.left.text, "HEAD · main");
  assert.equal(view.right.text, "Incoming · feature");
  for (const side of [view.left, view.right]) assert.doesNotMatch(`${view.title} ${side.text}`, /ours|theirs/i);
  assert.match(view.left.tooltip, /“ours”/);
  assert.match(view.right.tooltip, /“theirs”/);
});

const README_CONFLICT = { path: "README.md", xy: "UU", kind: "bothModified" } as const;

const REBASE = state({
  kind: "rebase",
  step: 2,
  total: 5,
  leftLabel: { role: "Onto", name: "main @abc1234" },
  rightLabel: { role: "Replaying", name: "Fix the login redirect" },
  message: "Fix the login redirect\n",
  conflicts: [README_CONFLICT],
  conflictsTotal: 1,
});

test("a rebase says which step it stopped at and names what it is onto and what it replays", () => {
  const view = bannerView(REBASE, { running: false });
  if (view?.kind !== "operation") return assert.fail("expected an operation banner");
  assert.equal(view.title, "Rebase in progress · step 2 of 5");
  assert.equal(view.left.text, "Onto · main @abc1234");
  assert.equal(view.right.text, "Replaying · Fix the login redirect");
});

test("Continue is enabled only when no conflict remains and nothing is running", () => {
  const blocked = bannerView(REBASE, { running: false });
  if (blocked?.kind !== "operation") return assert.fail("expected an operation banner");
  assert.equal(blocked.canContinue, false);
  assert.equal(blocked.continueBlockedBy, "Resolve and stage the 1 conflicted file to continue");

  const resolved = { ...REBASE, conflicts: [], conflictsTotal: 0 };
  const ready = bannerView(resolved, { running: false });
  assert.equal(ready?.kind === "operation" && ready.canContinue, true);
  assert.equal(ready?.kind === "operation" && ready.continueBlockedBy, null);

  const running = bannerView(resolved, { running: true });
  assert.equal(running?.kind === "operation" && running.canContinue, false);

  const many = bannerView({ ...REBASE, conflictsTotal: 12 }, { running: false });
  assert.equal(many?.kind === "operation" && many.continueBlockedBy, "Resolve and stage the 12 conflicted files to continue");
});

test("Skip is offered for a rebase, cherry-pick or revert, never a merge", () => {
  const skips = (kind: OpState["kind"]) => {
    const view = bannerView({ ...REBASE, kind }, { running: false });
    return view?.kind === "operation" && view.canSkip;
  };
  assert.deepEqual([skips("rebase"), skips("cherryPick"), skips("revert"), skips("merge")], [true, true, true, false]);
});

test("a conflict with no state file offers resolve-and-stage only", () => {
  const view = bannerView(state({ conflicts: [README_CONFLICT], conflictsTotal: 1 }), { running: false });
  assert.deepEqual(view, {
    kind: "conflictsOnly",
    title: "1 conflicted file, with no operation under way",
    detail: "Resolve the file and stage it. There is nothing to continue, skip or abort.",
  });
  assert.equal(bannerView(state({}), { running: false }), null, "nothing under way and nothing to resolve: no banner");
});

const PICK = state({
  kind: "cherryPick",
  leftLabel: { role: "HEAD", name: "main" },
  rightLabel: { role: "Picking", name: "Add <b>bold</b> & more" },
  message: "Add <b>bold</b> & more\n",
});

test("Abort confirms, naming the operation, where HEAD goes back to and what is lost", () => {
  assert.deepEqual(confirmAbort(MERGE), {
    title: "Abort the merge of feature?",
    detail: "main goes back to where it was before the merge. Every conflict resolution and every change staged since the merge started is lost.",
    confirmLabel: "Abort merge",
  });
  assert.deepEqual(confirmAbort(REBASE), {
    title: "Abort the rebase onto main @abc1234?",
    detail: "Your branch goes back to where it was before the rebase. The 1 commit already replayed and every resolution in this step are lost.",
    confirmLabel: "Abort rebase",
  });
  // A subject is untrusted text, kept as it is for the dialog to render as text.
  assert.equal(confirmAbort(PICK)?.title, "Abort the cherry-pick of “Add <b>bold</b> & more”?");
  assert.equal(confirmAbort(state({})), null);
});

test("Skip confirms, naming the commit it drops; a merge has no Skip", () => {
  assert.deepEqual(confirmSkip(REBASE), {
    title: "Skip “Fix the login redirect”?",
    detail: "The rebase goes on without this commit. Its changes, and your resolutions of them, are lost from the rebased branch.",
    confirmLabel: "Skip commit",
  });
  assert.equal(confirmSkip(PICK)?.detail, "The cherry-pick goes on without picking this commit. Your resolutions of it are lost.");
  assert.equal(confirmSkip(MERGE), null);
});

test("a failed step says why in words, and a failed hook keeps its output for the panel", () => {
  assert.deepEqual(stepFailure("continue", { kind: "hookFailed", hook: "pre-commit", output: "lint: 2 problems" }), {
    message: "The pre-commit hook failed, so Continue committed nothing. Your message is kept.",
    output: "lint: 2 problems",
  });
  assert.equal(stepFailure("continue", { kind: "cancelled" }).message, "Continue cancelled. The hook was stopped, and the operation is still under way.");
  assert.equal(stepFailure("continue", { kind: "conflictsRemain", count: 2 }).message, "Resolve and stage the 2 conflicted files first.");
  assert.equal(stepFailure("abort", { kind: "noOperation" }).message, "That operation is no longer under way, so nothing was aborted.");
  assert.equal(stepFailure("skip", { kind: "other", stderr: "error: could not skip\n" }).message, "Couldn't skip: error: could not skip");
});

test("a step that lands says how the operation stands now", () => {
  const ended = state({});
  assert.equal(stepDoneMessage("continue", MERGE, ended), "Merge concluded");
  assert.equal(stepDoneMessage("continue", REBASE, ended), "Rebase finished");
  assert.equal(stepDoneMessage("abort", REBASE, ended), "Rebase aborted");
  assert.equal(stepDoneMessage("skip", PICK, ended), "Skipped the commit; the cherry-pick is done");
  const next = { ...REBASE, step: 3 };
  assert.equal(stepDoneMessage("continue", REBASE, next), "Rebase stopped at step 3 of 5 with 1 conflicted file");
  assert.equal(stepDoneMessage("skip", REBASE, { ...next, conflicts: [], conflictsTotal: 0 }), "Skipped the commit; rebase stopped at step 3 of 5");
});
