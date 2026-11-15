/// <reference types="node" />
// Component tests for the companion's pull request view (#638): the header, the readiness card and
// its cells, the merge split button with its confirm step, and the controls after a merge or close.
// GitHub is reached through Tauri's `invoke`, the out-of-process boundary these tests fake.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo, TerminalLink } from "../terminal/types.ts";
import type { PullRequestReadiness, PullRequestState } from "../github/types.ts";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo } from "./fixtures/companionFixtures.ts";

const { Companion, COMPANION_VIEWS } = await import("./Companion.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  fakeInvoke((cmd) => Promise.reject(new Error(`no fake for ${cmd}`)));
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
});

const SHA = "0123456789abcdef0123456789abcdef01234567";
const pr = (over: Partial<PullRequestReadiness> = {}): PullRequestReadiness => ({
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
  additions: 120,
  deletions: 30,
  changedFiles: 3,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  checks: { failing: 0, pending: 0, skipped: 0, passing: 4 },
  comments: { total: 2, unresolved: 1 },
  commits: 3,
  ...over,
});

const link: TerminalLink = {
  ticket: null,
  pull_request: { repo: "o/r", number: 12, source: "branch", pinned: false, at: 1 },
  candidates: [],
};

/** Flushes the promise callbacks a fake `invoke` answer queues, inside `act`. */
const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

async function render(answer: (cmd: string, args: Record<string, unknown>) => unknown) {
  const calls: [string, Record<string, unknown>][] = [];
  fakeInvoke(async (cmd, args) => {
    calls.push([cmd, args]);
    return answer(cmd, args);
  });
  const terminal: TerminalInfo = { ...terminalInfo("a", "E:/alpha"), link };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(Companion, {
        selectedTerminal: terminal,
        projects: [{ path: "E:/alpha", name: "Alpha", terminal_ids: [] }],
        projectWorktrees: {},
        views: COMPANION_VIEWS,
        prefs: companionPrefs(memoryStorage()),
      }),
    ),
  );
  mounted = { root, container };
  await settle();
  return { container, calls };
}

const byName = (container: HTMLElement, role: string, name: string) =>
  [...container.querySelectorAll<HTMLElement>(`[role="${role}"], ${role === "button" ? "button" : role}`)].find(
    (el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim() === name,
  );
const click = async (el: HTMLElement | undefined) => {
  assert.ok(el, "element to click");
  act(() => el.click());
  await settle();
};

test("the header shows the title, state pill, base and head branch chips, and diffstat", async () => {
  const { container, calls } = await render(() => pr());
  assert.deepEqual(calls[0], ["get_github_pr_readiness", { repoPath: "E:/alpha", repo: "o/r", number: 12 }]);
  const header = container.querySelector('[data-pr-header]') as HTMLElement;
  assert.ok(header, "pull request header");
  assert.match(header.querySelector("h2")?.textContent ?? "", /Add the thing\s*#12/);
  assert.equal(header.querySelector("[data-state-pill]")?.textContent, "Open");
  assert.deepEqual(
    [...header.querySelectorAll("[data-branch-chip]")].map((c) => [c.getAttribute("title"), c.textContent]),
    [["Base branch", "master"], ["Head branch", "ticket-5"]],
  );
  assert.equal(header.querySelector("[data-diffstat]")?.getAttribute("aria-label"), "120 lines added, 30 deleted, in 3 files");
});

test("the readiness card shows the headline, its reason, and the four cells with counts and bars", async () => {
  const { container } = await render(() => pr());
  const card = container.querySelector('[aria-label="Readiness"]') as HTMLElement;
  assert.equal(card.querySelector("h3")?.textContent, "Ready to merge");
  assert.match(card.textContent ?? "", /All 4 checks passed\./);
  const cells = [...card.querySelectorAll<HTMLElement>("[data-cell]")];
  assert.deepEqual(cells.map((c) => [c.dataset.cell, c.querySelector("[data-count]")?.textContent]), [
    ["checks", "4"],
    ["comments", "2"],
    ["files", "3"],
    ["commits", "3"],
  ]);
  const comments = cells[1].querySelectorAll("[data-segment]");
  assert.deepEqual([...comments].map((s) => s.getAttribute("title")), ["1 unresolved", "1 other"]);
});

test("merge is a split button on squash by default, whose menu picks merge commit, squash or rebase", async () => {
  const { container } = await render(() => pr());
  assert.ok(byName(container, "button", "Squash and merge"));
  const toggle = byName(container, "button", "Choose a merge method") as HTMLElement;
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const options = [...container.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  assert.deepEqual(options.map((o) => [o.textContent, o.getAttribute("aria-checked")]), [
    ["Create a merge commit", "false"],
    ["Squash and merge", "true"],
    ["Rebase and merge", "false"],
  ]);
  await click(options[2]);
  assert.equal(container.querySelector('[role="menu"]'), null);
  assert.ok(byName(container, "button", "Rebase and merge"));
});

test("the confirm step shows the commit message and Delete branch after merge, ticked, then merges with them", async () => {
  let state: PullRequestState = "OPEN";
  const { container, calls } = await render((cmd) => {
    if (cmd === "merge_github_pr") {
      state = "MERGED";
      return { branchDeleted: true, branchError: null };
    }
    return pr({ state, headBranchExists: state === "OPEN" });
  });
  await click(byName(container, "button", "Squash and merge"));
  const title = container.querySelector<HTMLInputElement>('input[aria-label="Commit title"]');
  const message = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Commit message"]');
  assert.equal(title?.value, "Add the thing (#12)");
  assert.equal(message?.value, "Closes #5");
  const del = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (box) => box.closest("label")?.textContent?.trim() === "Delete branch after merge",
  );
  assert.equal(del?.checked, true);
  await click(byName(container, "button", "Confirm squash and merge"));
  const merge = calls.find(([cmd]) => cmd === "merge_github_pr");
  assert.deepEqual(merge?.[1], {
    repoPath: "E:/alpha",
    repo: "o/r",
    number: 12,
    method: "squash",
    commitTitle: "Add the thing (#12)",
    commitMessage: "Closes #5",
    headSha: SHA,
    headBranch: "ticket-5",
    deleteBranch: true,
  });
  const card = container.querySelector('[aria-label="Readiness"]') as HTMLElement;
  assert.equal(card.querySelector("h3")?.textContent, "Merged");
  assert.ok(byName(container, "button", "Restore branch"));
});

test("a failed merge says why, and the merge control stays", async () => {
  const { container } = await render((cmd) => {
    if (cmd === "merge_github_pr") throw "GitHub did not finish the merge within 58 s.";
    return pr();
  });
  await click(byName(container, "button", "Squash and merge"));
  await click(byName(container, "button", "Confirm squash and merge"));
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /Merge failed: GitHub did not finish the merge within 58 s\./);
  assert.ok(byName(container, "button", "Squash and merge"));
  assert.ok(byName(container, "button", "Confirm squash and merge"), "the confirm step stays open to try again");
});

test("a closed pull request offers Delete branch and Reopen, and each acts on GitHub", async () => {
  let state: PullRequestState = "CLOSED";
  let branch = true;
  const { container, calls } = await render((cmd) => {
    if (cmd === "reopen_github_pr") state = "OPEN";
    if (cmd === "delete_github_branch") branch = false;
    return cmd === "get_github_pr_readiness" ? pr({ state, headBranchExists: branch }) : null;
  });
  assert.equal(container.querySelector('[aria-label="Readiness"] h3')?.textContent, "Closed without merging");
  await click(byName(container, "button", "Delete branch"));
  assert.deepEqual(calls.find(([cmd]) => cmd === "delete_github_branch")?.[1], { repoPath: "E:/alpha", repo: "o/r", branch: "ticket-5" });
  await click(byName(container, "button", "Restore branch"));
  assert.deepEqual(calls.find(([cmd]) => cmd === "restore_github_branch")?.[1], {
    repoPath: "E:/alpha",
    repo: "o/r",
    branch: "ticket-5",
    sha: SHA,
  });
  await click(byName(container, "button", "Reopen"));
  assert.deepEqual(calls.find(([cmd]) => cmd === "reopen_github_pr")?.[1], { repoPath: "E:/alpha", repo: "o/r", number: 12 });
  assert.ok(byName(container, "button", "Squash and merge"));
});

test("a disabled merge stays visible but cannot be pressed", async () => {
  const { container } = await render(() => pr({ mergeStateStatus: "BLOCKED", checks: { failing: 1, pending: 0, skipped: 0, passing: 3 } }));
  assert.equal(container.querySelector('[aria-label="Readiness"] h3')?.textContent, "1 check failing");
  assert.equal((byName(container, "button", "Squash and merge") as HTMLButtonElement).disabled, true);
});
