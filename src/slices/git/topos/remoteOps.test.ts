/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGitError } from "./gitVersion.ts";
import {
  appendCapped,
  failureView,
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
  assert.deepEqual(failureView("push", { kind: "nonFastForward", ref: "refs/heads/main" }).actions, ["pull"]);
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
  const view = syncView({ branch: "feat", upstream: "origin/feat", ahead: 2, behind: 3, fetchedAtMs: at });
  assert.equal(view.label, "↑2 ↓3");
  assert.equal(view.title, `2 ahead and 3 behind origin/feat, as of ${formatDateTime(at)}`);
  assert.equal(syncView({ branch: "feat", upstream: "origin/feat", ahead: 0, behind: 0, fetchedAtMs: null }).title, "Up to date with origin/feat, as of no fetch yet");
  const none = syncView({ branch: "feat", upstream: null, ahead: 0, behind: 0, fetchedAtMs: at });
  assert.equal(none.label, null);
  assert.equal(none.title, "feat tracks no upstream");
  assert.equal(syncView({ branch: null, upstream: null, ahead: 0, behind: 0, fetchedAtMs: null }).title, "HEAD is detached");
});
