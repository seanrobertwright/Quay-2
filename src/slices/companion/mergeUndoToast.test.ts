/// <reference types="node" />
// The Merge undo window's toast (#650): a Merge started through `useMergeUndo` counts down in a
// toast with Cancel; Cancel stops it; when it ends `merge_github_pr` runs with the pull request
// view's defaults; with the window Off the caller's confirm step opens instead. GitHub is reached
// through Tauri's `invoke`, the boundary these tests fake, and the clock through `mock.timers`.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PullRequestReadiness } from "../github/types.ts";
import type { MergeJob, MergeUndo } from "./useMergeUndo.ts";

const { useMergeUndo } = await import("./useMergeUndo.ts");
const { MergeUndoToast } = await import("./MergeUndoToast.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  mock.timers.reset();
  fakeInvoke((cmd) => Promise.reject(new Error(`no fake for ${cmd}`)));
});

const SHA = "0123456789abcdef0123456789abcdef01234567";
const pr: PullRequestReadiness = {
  repo: "o/r",
  number: 12,
  title: "Add the thing",
  body: "Closes #5",
  url: "https://github.com/o/r/pull/12",
  state: "OPEN",
  isDraft: false,
  baseRefName: "master",
  headRefName: "ticket-5",
  headRefOid: SHA,
  headBranchExists: true,
  isCrossRepository: false,
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  checks: { failing: 0, pending: 0, skipped: 0, passing: 1 },
  comments: { total: 0, unresolved: 0 },
  commits: 1,
};
const job = (method: MergeJob["method"] = "squash"): MergeJob => ({ location: { repoPath: "E:/alpha", repo: "o/r", number: 12 }, pr, method });

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

/** Renders the toast for a `useMergeUndo` window of `seconds`, and hands back the hook and what it called. */
function render(seconds: number, answer: (cmd: string, args: Record<string, unknown>) => unknown = () => ({ branchDeleted: true, branchError: null })) {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const calls: [string, Record<string, unknown>][] = [];
  fakeInvoke(async (cmd, args) => {
    calls.push([cmd, args]);
    return answer(cmd, args);
  });
  const confirmed: MergeJob[] = [];
  const merged: MergeJob[] = [];
  const hook: { current: MergeUndo | null } = { current: null };
  const Harness = () => {
    const undo = useMergeUndo(seconds, { onConfirm: (j) => confirmed.push(j), onMerged: (j) => merged.push(j) });
    hook.current = undo;
    return createElement(MergeUndoToast, { undo });
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Harness)));
  mounted = { root, container };
  return { container, calls, confirmed, merged, start: (j: MergeJob) => act(() => hook.current!.start(j)) };
}

const tick = async (ms: number) => {
  act(() => mock.timers.tick(ms));
  await settle();
};
const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name);

test("a Merge shows a countdown toast with Cancel, counting down each second", async () => {
  const { container, calls, start } = render(5);
  assert.equal(container.textContent, "");
  start(job());
  assert.match(container.textContent ?? "", /Squash and merge #12/);
  assert.match(container.textContent ?? "", /5 s/);
  assert.ok(button(container, "Cancel"), "Cancel");
  await tick(1_000);
  assert.match(container.textContent ?? "", /4 s/);
  assert.deepEqual(calls, []);
});

test("Cancel stops the window: the toast goes and nothing merges", async () => {
  const { container, calls, start } = render(5);
  start(job());
  await tick(2_000);
  act(() => button(container, "Cancel")!.click());
  assert.equal(container.textContent, "");
  await tick(10_000);
  assert.deepEqual(calls, []);
});

test("when the window ends the merge runs with squash and Delete branch on, and the toast says it merged", async () => {
  const { container, calls, merged, start } = render(3);
  start(job());
  await tick(3_000);
  assert.deepEqual(calls, [
    [
      "merge_github_pr",
      {
        repoPath: "E:/alpha",
        repo: "o/r",
        number: 12,
        method: "squash",
        commitTitle: "Add the thing (#12)",
        commitMessage: "Closes #5",
        headSha: SHA,
        headBranch: "ticket-5",
        deleteBranch: true,
      },
    ],
  ]);
  assert.equal(merged.length, 1);
  assert.match(container.textContent ?? "", /Merged #12/);
  act(() => button(container, "Dismiss")!.click());
  assert.equal(container.textContent, "");
});

test("a second-ring slice's method is the one that merges", async () => {
  const { calls, start } = render(3);
  start(job("rebase"));
  await tick(3_000);
  assert.equal(calls[0][1].method, "rebase");
  assert.equal(calls[0][1].commitTitle, null);
  assert.equal(calls[0][1].deleteBranch, true);
});

test("a merge GitHub refuses says why in the toast", async () => {
  const { container, merged, start } = render(3, () => Promise.reject("Pull request is not mergeable"));
  start(job());
  await tick(3_000);
  assert.equal(merged.length, 0);
  const alert = container.querySelector('[role="alert"]');
  assert.match(alert?.textContent ?? "", /Merge #12 failed: Pull request is not mergeable/);
});

test("with the window set to Off, a Merge opens the confirm step and shows no toast", async () => {
  const { container, calls, confirmed, start } = render(0);
  start(job("merge"));
  assert.deepEqual(confirmed, [job("merge")]);
  assert.equal(container.textContent, "");
  await tick(10_000);
  assert.deepEqual(calls, []);
});
