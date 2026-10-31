/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGitError, type GitError } from "./gitVersion.ts";
import {
  appendCapped,
  deleteRemoteBranchPrompt,
  failureView,
  forcePushPrompt,
  needsTypedConfirm,
  remoteBranchOf,
  typedConfirmRefusal,
  typedForcePushPrompt,
  gitArgv,
  MAX_OUTPUT_BYTES,
  onOpEvent,
  startOp,
  STALL_NOTICE,
  syncView,
  toolbarLabel,
} from "./remoteOps.ts";
import { formatDateTime } from "../../../lib/dates.ts";

test("progress events become the toolbar button's label", () => {
  let op = startOp("fetch");
  assert.equal(toolbarLabel(op), "Fetching…");
  op = onOpEvent(op, { event: "progress", phase: "Receiving objects", percent: 45 });
  assert.equal(toolbarLabel(op), "Receiving objects 45%");
  op = onOpEvent(op, { event: "progress", phase: "Enumerating objects" });
  assert.equal(toolbarLabel(op), "Enumerating objects…");
});

test("the stall notice shows on a stall and clears on git's next output", () => {
  let op = startOp("push");
  assert.equal(op.stalled, false);
  op = onOpEvent(op, { event: "stalled" });
  assert.equal(op.stalled, true);
  assert.equal(STALL_NOTICE, "Waiting on the remote. Git may need a credential prompt.");
  op = onOpEvent(op, { event: "progress", phase: "Writing objects", percent: 10 });
  assert.equal(op.stalled, false);
  op = onOpEvent(op, { event: "stalled" });
  op = onOpEvent(op, { event: "output", chunk: "remote: hi\n" });
  assert.equal(op.stalled, false, "any output clears it");
});

test("a stall is a notice, not a timeout: the op keeps running and keeps its output", () => {
  let op = onOpEvent(startOp("pull"), { event: "output", chunk: "From ../origin\n" });
  op = onOpEvent(op, { event: "stalled" });
  assert.equal(op.output, "From ../origin\n");
  assert.equal(toolbarLabel(op), "Pulling…");
});

test("the output panel keeps the last 64 KiB of what git printed", () => {
  assert.equal(MAX_OUTPUT_BYTES, 64 * 1024);
  const line = "x".repeat(1023) + "\n";
  let text = "";
  for (let i = 0; i < 70; i++) text = appendCapped(text, line);
  assert.equal(text.length, 64 * 1024);
  text = appendCapped(text, "last\n");
  assert.ok(text.endsWith("x\nlast\n"));
  assert.ok(new TextEncoder().encode(text).length <= 64 * 1024);
  // Multi-byte text is measured in bytes, and never cut mid-character.
  const wide = appendCapped("", "é".repeat(40 * 1024));
  assert.ok(new TextEncoder().encode(wide).length <= 64 * 1024);
  assert.ok(/^é+$/.test(wide));
});

test("the new push and pull refusals parse from what the backend returns", () => {
  assert.deepEqual(parseGitError({ kind: "nonFastForward", ref: "refs/heads/main" }), { kind: "nonFastForward", ref: "refs/heads/main" });
  assert.deepEqual(parseGitError({ kind: "noUpstream", branch: "feat", remotes: ["origin", "fork"] }), {
    kind: "noUpstream",
    branch: "feat",
    remotes: ["origin", "fork"],
  });
  assert.deepEqual(
    parseGitError({ kind: "remoteRejected", ref: "refs/heads/main", reason: "pre-receive hook declined", remoteLines: ["<b>no</b>"] }),
    { kind: "remoteRejected", ref: "refs/heads/main", reason: "pre-receive hook declined", remoteLines: ["<b>no</b>"] }
  );
  for (const kind of ["authFailed", "hostKeyUnknown", "network", "divergentPullNeedsStrategy"] as const) {
    assert.deepEqual(parseGitError({ kind }), { kind });
  }
  assert.equal(parseGitError({ kind: "noUpstream", branch: "feat", remotes: "origin" }), null, "remotes must be a list");
});

test("each refusal shows its next action", () => {
  assert.deepEqual(failureView("push", { kind: "nonFastForward", ref: "refs/heads/main" }).actions, ["pull", "forcePushWithLease"]);
  assert.deepEqual(failureView("push", { kind: "noUpstream", branch: "feat", remotes: ["origin"] }).actions, ["pushSetUpstream"]);
  assert.deepEqual(failureView("push", { kind: "authFailed" }).actions, ["runInTerminal"]);
  assert.deepEqual(failureView("fetch", { kind: "hostKeyUnknown" }).actions, ["runInTerminal"]);
  assert.deepEqual(failureView("fetch", { kind: "network" }).actions, ["retry"]);
  assert.deepEqual(failureView("pull", { kind: "other", stderr: "fatal: boom" }).actions, ["retry"]);
});

test("a push the remote rejects shows its remote lines as they are", () => {
  const view = failureView("push", {
    kind: "remoteRejected",
    ref: "refs/heads/main",
    reason: "pre-receive hook declined",
    remoteLines: ["protected: main is frozen", "<script>x</script>"],
  });
  assert.equal(view.title, "The remote rejected refs/heads/main: pre-receive hook declined");
  assert.deepEqual(view.lines, ["protected: main is frozen", "<script>x</script>"]);
  assert.deepEqual(view.actions, []);
});

test("no upstream names the branch the push would set up", () => {
  const view = failureView("push", { kind: "noUpstream", branch: "feat", remotes: ["origin"] });
  assert.equal(view.title, "feat has no upstream branch");
  assert.equal(view.setUpstreamLabel, "Push and set upstream to origin/feat");
  const several = failureView("push", { kind: "noUpstream", branch: "feat", remotes: ["origin", "fork"] });
  assert.equal(several.setUpstreamLabel, "Push and set upstream…");
});

test("Run in terminal types the same git command the operation ran", () => {
  assert.deepEqual(gitArgv({ kind: "fetch", from: { kind: "all" }, prune: true }), ["git", "fetch", "--prune", "--all"]);
  assert.deepEqual(gitArgv({ kind: "fetch", from: { kind: "remote", name: "origin" }, prune: false }), ["git", "fetch", "--", "origin"]);
  assert.deepEqual(gitArgv({ kind: "pull", strategy: null, remember: false }), ["git", "pull"]);
  assert.deepEqual(gitArgv({ kind: "pull", strategy: "rebase", remember: false }), ["git", "pull", "--rebase"]);
  assert.deepEqual(gitArgv({ kind: "pull", strategy: "merge", remember: true }), ["git", "pull", "--no-rebase", "--ff"]);
  assert.deepEqual(gitArgv({ kind: "pull", strategy: "fastForward", remember: false }), ["git", "pull", "--ff-only"]);
  assert.deepEqual(gitArgv({ kind: "push", branch: "feat", remote: null, setUpstream: false }), ["git", "push"]);
  assert.deepEqual(gitArgv({ kind: "push", branch: "feat", remote: "origin", setUpstream: true }), [
    "git",
    "push",
    "--set-upstream",
    "--",
    "origin",
    "feat",
  ]);
});

test("the counts read as of the last fetch, through the date helper", () => {
  const at = Date.UTC(2026, 9, 31, 14, 6, 11);
  const view = syncView({ branch: "feat", upstream: "origin/feat", ahead: 2, behind: 3, fetchedAtMs: at, remotes: [] });
  assert.equal(view.label, "↑2 ↓3");
  assert.equal(view.title, `2 ahead and 3 behind origin/feat, as of ${formatDateTime(at)}`);
  assert.equal(syncView({ branch: "feat", upstream: "origin/feat", ahead: 0, behind: 0, fetchedAtMs: null, remotes: [] }).title, "Up to date with origin/feat, as of no fetch yet");
  const none = syncView({ branch: "feat", upstream: null, ahead: 0, behind: 0, fetchedAtMs: at, remotes: [] });
  assert.equal(none.label, null);
  assert.equal(none.title, "feat tracks no upstream");
  assert.equal(syncView({ branch: null, upstream: null, ahead: 0, behind: 0, fetchedAtMs: null, remotes: [] }).title, "HEAD is detached");
});

const plan = (overwrites: number, defaultBranch: string | null, remoteRef = "refs/heads/feat") => ({
  remote: "origin",
  remoteRef,
  tracking: `origin/${remoteRef.slice("refs/heads/".length)}`,
  expectedSha: "b".repeat(40),
  overwrites,
  defaultBranch,
});

test("force push (with lease) is offered only after a push is refused as non-fast-forward", () => {
  assert.deepEqual(failureView("push", { kind: "nonFastForward", ref: "refs/heads/feat" }).actions, ["pull", "forcePushWithLease"]);
  const others: GitError[] = [
    { kind: "noUpstream", branch: "feat", remotes: ["origin"] },
    { kind: "remoteRejected", ref: "refs/heads/feat", reason: "hook", remoteLines: [] },
    { kind: "authFailed" },
    { kind: "network" },
    { kind: "leaseRefused", ref: "refs/heads/feat" },
    { kind: "other", stderr: "boom" },
  ];
  for (const error of others) {
    assert.ok(!failureView("push", error).actions.includes("forcePushWithLease"), error.kind);
  }
  for (const kind of ["fetch", "pull", "pushTag", "pushDelete"] as const) {
    assert.ok(!failureView(kind, { kind: "nonFastForward", ref: "refs/heads/feat" }).actions.includes("forcePushWithLease"), kind);
  }
});

test("a refused lease says nothing was overwritten and offers a fetch", () => {
  assert.deepEqual(parseGitError({ kind: "leaseRefused", ref: "refs/heads/feat" }), { kind: "leaseRefused", ref: "refs/heads/feat" });
  const view = failureView("push", { kind: "leaseRefused", ref: "refs/heads/feat" });
  assert.equal(view.title, "refs/heads/feat on the remote moved since Topos last fetched, so the force push overwrote nothing. Fetch and look again.");
  assert.deepEqual(view.actions, ["fetch"]);
});

test("the force push confirm names the remote branch and how many remote commits it overwrites", () => {
  assert.deepEqual(forcePushPrompt("feat", plan(3, "main")), {
    title: "Force push feat to origin/feat",
    detail: `Overwrites 3 commits on origin/feat that feat lacks, as of the last fetch (at ${"b".repeat(7)}). If the remote moved since, git refuses and overwrites nothing.`,
    confirmLabel: "Force push",
  });
  assert.match(forcePushPrompt("feat", plan(1, null)).detail, /^Overwrites 1 commit on origin\/feat /);
  assert.match(forcePushPrompt("feat", plan(0, null)).detail, /^Overwrites no commits on origin\/feat /);
});

test("a force push to main, master or the remote's detected default branch needs the name typed", () => {
  assert.equal(needsTypedConfirm(plan(1, null, "refs/heads/main")), true);
  assert.equal(needsTypedConfirm(plan(1, null, "refs/heads/master")), true);
  assert.equal(needsTypedConfirm(plan(1, "trunk", "refs/heads/trunk")), true, "the default branch from refs/remotes/origin/HEAD");
  assert.equal(needsTypedConfirm(plan(1, "trunk", "refs/heads/feat")), false);
  assert.equal(needsTypedConfirm(plan(1, null, "refs/heads/feat")), false);
  assert.equal(needsTypedConfirm(plan(1, null, "refs/heads/main-old")), false);
  assert.equal(needsTypedConfirm(plan(1, null, "refs/heads/release/main")), false);
});

test("the typed confirmation takes only the branch name exactly", () => {
  const typed = typedForcePushPrompt(plan(2, "trunk", "refs/heads/trunk"));
  assert.equal(typed.title, "Force push to trunk, origin's default branch");
  assert.equal(typed.field.label, "Type trunk to confirm");
  assert.equal(typed.field.initial, "");
  assert.equal(typedForcePushPrompt(plan(2, null, "refs/heads/master")).title, "Force push to master");
  assert.equal(typedConfirmRefusal("trunk", "trunk"), null);
  for (const wrong of ["", "Trunk", "trunk ", " trunk", "trun", "origin/trunk"]) {
    assert.equal(typedConfirmRefusal(wrong, "trunk"), "Type trunk exactly to force push", JSON.stringify(wrong));
  }
});

test("Run in terminal types a lease push, a tag push and a remote delete as they ran", () => {
  const sha = "b".repeat(40);
  assert.deepEqual(
    gitArgv({ kind: "push", branch: "feat", remote: "origin", setUpstream: false, lease: { expectedSha: sha, remoteRef: "refs/heads/feat" } }),
    ["git", "push", `--force-with-lease=refs/heads/feat:${sha}`, "--force-if-includes", "--", "origin", "refs/heads/feat:refs/heads/feat"]
  );
  assert.deepEqual(gitArgv({ kind: "pushTag", remote: "origin", name: "v1" }), ["git", "push", "--no-follow-tags", "--", "origin", "refs/tags/v1:refs/tags/v1"]);
  assert.deepEqual(gitArgv({ kind: "pushDelete", remote: "origin", ref: "refs/heads/topic" }), ["git", "push", "--delete", "--", "origin", "refs/heads/topic"]);
});

test("a remote-tracking branch splits into its remote and branch by the longest remote that matches", () => {
  assert.deepEqual(remoteBranchOf("origin/topic", ["origin"]), { remote: "origin", branch: "topic" });
  assert.deepEqual(remoteBranchOf("team/x/feat/a", ["team", "team/x"]), { remote: "team/x", branch: "feat/a" });
  assert.equal(remoteBranchOf("origin/HEAD", ["origin"]), null);
  assert.equal(remoteBranchOf("origin/", ["origin"]), null);
  assert.equal(remoteBranchOf("fork/topic", ["origin"]), null);
});

test("deleting a remote branch confirms, naming the remote and saying there is no undo", () => {
  assert.deepEqual(deleteRemoteBranchPrompt("origin", "<b>topic</b>"), {
    title: "Delete <b>topic</b> from origin",
    detail: "Deletes the branch <b>topic</b> on the remote origin. Others may be using it. There is no undo.",
    confirmLabel: "Delete from origin",
  });
});
