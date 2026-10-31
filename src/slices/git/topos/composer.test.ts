/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendOutput, CommitDrafts, isCommitKey, commitFailure, committedMessage, composeMessage, composerView, splitMessage, summaryHint, type CommitContext } from "./composer.ts";

test("the summary counter is a plain count up to 50 characters", () => {
  assert.deepEqual(summaryHint("Fix the login redirect"), {
    count: 22,
    level: "ok",
    text: "22",
    spoken: "22 characters",
  });
  assert.equal(summaryHint("x".repeat(50)).level, "ok");
});

test("past 50 characters it turns amber and says so in words, past 72 red", () => {
  assert.deepEqual(summaryHint("x".repeat(51)), {
    count: 51,
    level: "long",
    text: "51 · over 50",
    spoken: "51 characters, over the 50 a summary usually keeps to",
  });
  assert.equal(summaryHint("x".repeat(72)).level, "long");
  assert.deepEqual(summaryHint("x".repeat(73)), {
    count: 73,
    level: "tooLong",
    text: "73 · over 72",
    spoken: "73 characters, over the 72 most tools show",
  });
});

test("the count is of characters, not UTF-16 units", () => {
  assert.equal(summaryHint("🚀 Ship it").count, 9);
});

test("a message joins its summary and description with one blank line", () => {
  assert.equal(composeMessage({ summary: "Fix login", description: "" }), "Fix login\n");
  assert.equal(composeMessage({ summary: "Fix login", description: "  \n" }), "Fix login\n");
  assert.equal(composeMessage({ summary: "Fix login", description: "It looped.\n\nNow it doesn't." }), "Fix login\n\nIt looped.\n\nNow it doesn't.\n");
});

test("a loaded message splits at its first line, dropping the blank lines between", () => {
  assert.deepEqual(splitMessage("Merge branch 'main' into feat\n"), { summary: "Merge branch 'main' into feat", description: "" });
  assert.deepEqual(splitMessage("Fix login\n\n\nIt looped.\n\nSigned-off-by: A <a@x>\n"), {
    summary: "Fix login",
    description: "It looped.\n\nSigned-off-by: A <a@x>",
  });
  assert.deepEqual(splitMessage("One\r\nTwo\r\n"), { summary: "One", description: "Two" });
  assert.deepEqual(splitMessage(""), { summary: "", description: "" });
});

const onFeat: CommitContext = {
  operation: "none",
  mergeMessage: null,
  branch: "feat",
  head: { oid: "a1b2c3d4e5", message: "init\n", onUpstream: false },
};
const ready = { context: onFeat, staged: 2, amend: false, summary: "Fix login" };

test("Commit needs a staged change and a summary that isn't blank", () => {
  assert.deepEqual(composerView(ready), { kind: "composer", button: "Commit", canCommit: true, blockedBy: null, amendAvailable: true, notes: [] });
  assert.deepEqual(composerView({ ...ready, staged: 0 }), {
    kind: "composer",
    button: "Commit",
    canCommit: false,
    blockedBy: "Stage a change to commit, or tick Amend",
    amendAvailable: true,
    notes: [],
  });
  const blank = composerView({ ...ready, summary: "   " });
  assert.equal(blank.kind === "composer" && blank.blockedBy, "Write a summary to commit");
});

test("Amend commits with nothing staged and warns, without blocking, when HEAD is on its upstream", () => {
  const amend = composerView({ ...ready, staged: 0, amend: true });
  assert.deepEqual(amend, { kind: "composer", button: "Amend commit", canCommit: true, blockedBy: null, amendAvailable: true, notes: [] });
  const pushed = composerView({ ...ready, amend: true, context: { ...onFeat, head: { ...onFeat.head!, onUpstream: true } } });
  assert.equal(pushed.kind === "composer" && pushed.canCommit, true);
  assert.deepEqual(pushed.kind === "composer" && pushed.notes, [
    { kind: "pushed", text: "HEAD is already on its upstream, so amending rewrites a commit others may have. Pushing it will need a force push." },
  ]);
  // Unticked, a pushed HEAD is no concern.
  const notAmending = composerView({ ...ready, context: { ...onFeat, head: { ...onFeat.head!, onUpstream: true } } });
  assert.deepEqual(notAmending.kind === "composer" && notAmending.notes, []);
});

test("an unborn branch has no HEAD to amend", () => {
  const unborn = composerView({ ...ready, context: { ...onFeat, head: null } });
  assert.equal(unborn.kind === "composer" && unborn.amendAvailable, false);
});

test("in a merge the button reads Commit merge, needs nothing staged, and Amend is off", () => {
  const merge = composerView({ ...ready, staged: 0, context: { ...onFeat, operation: "merge", mergeMessage: "Merge branch 'main' into feat\n" } });
  assert.deepEqual(merge, { kind: "composer", button: "Commit merge", canCommit: true, blockedBy: null, amendAvailable: false, notes: [] });
});

test("during a rebase, cherry-pick or revert a pointer to the banner's Continue replaces the composer", () => {
  assert.deepEqual(composerView({ ...ready, context: { ...onFeat, operation: "rebase" } }), {
    kind: "pointer",
    operation: "rebase",
    text: "A rebase is under way. Continue it with Continue in the operation banner, which commits for each step.",
  });
  assert.equal(composerView({ ...ready, context: { ...onFeat, operation: "cherryPick" } }).kind, "pointer");
  const revert = composerView({ ...ready, context: { ...onFeat, operation: "revert" } });
  assert.equal(revert.kind === "pointer" && revert.text.startsWith("A revert is under way."), true);
});

test("on a detached HEAD a note says the commit is on no branch", () => {
  const detached = composerView({ ...ready, context: { ...onFeat, branch: null } });
  assert.deepEqual(detached.kind === "composer" && detached.notes, [
    { kind: "detached", text: "HEAD is detached, so this commit will be on no branch. Create a branch on it to keep it." },
  ]);
});

test("a failed hook names the hook, keeps its output for the panel, and says the message is kept", () => {
  assert.deepEqual(commitFailure({ kind: "hookFailed", hook: "pre-commit", output: "lint: 2 problems\n" }), {
    message: "The pre-commit hook failed, so nothing was committed. Your message is kept.",
    output: "lint: 2 problems\n",
  });
});

test("Cancel, a busy worktree and git's own errors each read plainly", () => {
  assert.deepEqual(commitFailure({ kind: "cancelled" }), {
    message: "Commit cancelled. The hook was stopped and nothing was committed.",
    output: null,
  });
  assert.equal(commitFailure({ kind: "stagingBusy" }).message, "Wait for the running staging operation to finish, then commit.");
  assert.deepEqual(commitFailure({ kind: "other", stderr: "fatal: unable to auto-detect email address\n" }), {
    message: "Couldn't commit: fatal: unable to auto-detect email address",
    output: null,
  });
});

test("a commit announces its short oid and where it went", () => {
  assert.equal(committedMessage("a1b2c3d4e5f6", { button: "Commit", branch: "feat" }), "Committed a1b2c3d on feat");
  assert.equal(committedMessage("a1b2c3d4e5f6", { button: "Commit merge", branch: "feat" }), "Committed merge a1b2c3d on feat");
  assert.equal(committedMessage("a1b2c3d4e5f6", { button: "Amend commit", branch: "feat" }), "Amended feat's last commit, now a1b2c3d");
  assert.equal(committedMessage("a1b2c3d4e5f6", { button: "Commit", branch: null }), "Committed a1b2c3d on a detached HEAD");
});

test("each worktree keeps its own draft for the session, and a commit clears only its own", () => {
  const drafts = new CommitDrafts();
  assert.deepEqual(drafts.get("C:/repo/wt"), { summary: "", description: "" });
  drafts.set("C:/repo/wt", { summary: "Fix login", description: "It looped." });
  drafts.set("C:/repo/other", { summary: "Other", description: "" });
  assert.deepEqual(drafts.get("C:/repo/wt"), { summary: "Fix login", description: "It looped." });
  drafts.clear("C:/repo/wt");
  assert.deepEqual(drafts.get("C:/repo/wt"), { summary: "", description: "" });
  assert.deepEqual(drafts.get("C:/repo/other"), { summary: "Other", description: "" });
});

test("Ctrl+Enter commits from either field; Enter alone and other chords don't", () => {
  const key = { key: "Enter", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false };
  assert.equal(isCommitKey(key), true);
  assert.equal(isCommitKey({ ...key, ctrlKey: false }), false);
  assert.equal(isCommitKey({ ...key, shiftKey: true }), false);
  assert.equal(isCommitKey({ ...key, altKey: true }), false);
  assert.equal(isCommitKey({ ...key, key: "k" }), false);
});

test("the hook panel keeps at most 64 KiB, dropping the oldest output", () => {
  assert.equal(appendOutput("a\n", "b\n"), "a\nb\n");
  const big = appendOutput("x".repeat(64 * 1024), "tail\n");
  assert.equal(big.length, 64 * 1024);
  assert.ok(big.endsWith("xtail\n"));
});
