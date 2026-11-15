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
import type {
  PullRequestCheck,
  PullRequestCommit,
  PullRequestFile,
  PullRequestReadiness,
  PullRequestState,
  PullRequestTimeline,
} from "../github/types.ts";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo } from "./fixtures/companionFixtures.ts";
import type { DiffLensTarget } from "./diffLensTarget.ts";

const { Companion, COMPANION_VIEWS } = await import("./Companion.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  fakeInvoke((cmd) => Promise.reject(new Error(`no fake for ${cmd}`)));
  unmount();
});

/** Unmounts the rendered companion, so a test can render another. */
function unmount() {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
}

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

async function render(answer: (cmd: string, args: Record<string, unknown>) => unknown, extra: Record<string, unknown> = {}) {
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
        ...extra,
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

// ---- The cells' details (#639) ----

const cellButton = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-cell="${id}"] button`) ?? undefined;
const detail = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-cell-detail]");
const description = (container: HTMLElement) => container.querySelector('[aria-label="Description"]');

const checks: PullRequestCheck[] = [
  { checkRunId: 1, name: "build", workflow: "CI", outcome: "passing", description: null, url: null },
  { checkRunId: 2, name: "lint", workflow: "CI", outcome: "skipped", description: null, url: null },
  { checkRunId: 3, name: "test", workflow: "CI", outcome: "failing", description: "2 tests failed", url: "https://github.com/o/r/runs/3" },
  { checkRunId: null, name: "deploy/preview", workflow: null, outcome: "pending", description: "Deploying", url: null },
];

/** A GitHub that answers every read the pull request view makes, with `over` taking precedence. */
const github =
  (over: (cmd: string, args: Record<string, unknown>) => unknown = () => undefined, readiness: Partial<PullRequestReadiness> = {}) =>
  (cmd: string, args: Record<string, unknown>) => {
    const answer = over(cmd, args);
    if (answer !== undefined) return answer;
    switch (cmd) {
      case "get_github_pr_readiness":
        return pr(readiness);
      case "get_github_pr_checks":
        return checks;
      case "get_github_check_log":
        return { text: "error: 2 tests failed", truncated: false };
      case "get_github_pr_timeline":
        return { viewer: "me", items: [], truncated: false };
      case "get_github_pr_files":
        return [];
      case "get_github_pr_commits":
        return [];
      default:
        return null;
    }
  };

test("the header shows the title, state pill, base and head branch chips, and diffstat", async () => {
  const { container, calls } = await render(github());
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
  const { container } = await render(github());
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
  const { container } = await render(github());
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
  const { container, calls } = await render(
    github((cmd) => {
      if (cmd === "merge_github_pr") {
        state = "MERGED";
        return { branchDeleted: true, branchError: null };
      }
      return cmd === "get_github_pr_readiness" ? pr({ state, headBranchExists: state === "OPEN" }) : undefined;
    }),
  );
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
  const { container } = await render(
    github((cmd) => {
      if (cmd === "merge_github_pr") throw "GitHub did not finish the merge within 58 s.";
    }),
  );
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
  const { container } = await render(
    github(undefined, { mergeStateStatus: "BLOCKED", checks: { failing: 1, pending: 0, skipped: 0, passing: 3 } }),
  );
  assert.equal(container.querySelector('[aria-label="Readiness"] h3')?.textContent, "1 check failing");
  assert.equal((byName(container, "button", "Squash and merge") as HTMLButtonElement).disabled, true);
});

test("clicking a cell opens its detail under the card, clicking it again closes it, and with none open the description shows", async () => {
  const { container } = await render(github(undefined, { comments: { total: 2, unresolved: 0 } }));
  const button = cellButton(container, "checks");
  assert.equal(button?.getAttribute("aria-expanded"), "false");
  assert.equal(detail(container), null);
  assert.ok(description(container), "the description shows with no cell open");
  await click(button);
  assert.equal(button?.getAttribute("aria-expanded"), "true");
  assert.equal(detail(container)?.getAttribute("aria-label"), "Checks");
  assert.equal(detail(container)?.id, button?.getAttribute("aria-controls"));
  assert.equal(description(container), null, "an open cell takes the description's place");
  await click(cellButton(container, "commits"));
  assert.equal(detail(container)?.getAttribute("aria-label"), "Commits");
  assert.equal(button?.getAttribute("aria-expanded"), "false");
  await click(cellButton(container, "commits"));
  assert.equal(detail(container), null);
  assert.ok(description(container));
});

test("on arrival the view opens Checks for a failing check, else Comments on the unresolved threads, else nothing", async () => {
  const failing = await render(github(undefined, { checks: { failing: 1, pending: 1, skipped: 1, passing: 1 } }));
  assert.equal(detail(failing.container)?.getAttribute("aria-label"), "Checks");
  assert.equal(cellButton(failing.container, "checks")?.getAttribute("aria-expanded"), "true");
  unmount();

  const unresolved = await render(github(undefined, { comments: { total: 3, unresolved: 1 } }));
  assert.equal(detail(unresolved.container)?.getAttribute("aria-label"), "Comments");
  const picked = unresolved.container.querySelector<HTMLInputElement>('[data-cell-detail] input[type="radio"]:checked');
  assert.equal(picked?.closest("label")?.textContent, "Unresolved");
  unmount();

  const clean = await render(github(undefined, { comments: { total: 3, unresolved: 0 } }));
  assert.equal(detail(clean.container), null);
  assert.ok(description(clean.container));
});

test("Checks are grouped failing, pending, skipped and successful, with a failing check's log open", async () => {
  const { container, calls } = await render(github(undefined, { checks: { failing: 1, pending: 1, skipped: 1, passing: 1 } }));
  const groups = [...container.querySelectorAll<HTMLElement>("[data-check-group]")];
  assert.deepEqual(
    groups.map((g) => [g.querySelector("h4")?.textContent, [...g.querySelectorAll<HTMLElement>("[data-check]")].map((c) => c.dataset.check)]),
    [
      ["Failing 1", ["test"]],
      ["Pending 1", ["deploy/preview"]],
      ["Skipped 1", ["lint"]],
      ["Successful 1", ["build"]],
    ],
  );
  assert.deepEqual(calls.find(([cmd]) => cmd === "get_github_check_log")?.[1], { repoPath: "E:/alpha", repo: "o/r", checkRunId: 3 });
  const failing = container.querySelector<HTMLElement>('[data-check="test"]') as HTMLElement;
  assert.equal(failing.querySelector("[data-check-log] pre")?.textContent, "error: 2 tests failed");
  const toggle = byName(failing, "button", "Hide log");
  assert.equal(toggle?.getAttribute("aria-expanded"), "true");
  await click(toggle);
  assert.equal(container.querySelectorAll("[data-check-log]").length, 0, "only failing checks have a log, and it closes");
  assert.ok(byName(failing, "button", "Show log"));
});

const timeline: PullRequestTimeline = {
  viewer: "me",
  truncated: false,
  items: [
    { id: "C1", kind: "comment", author: "ann", createdAt: "2026-11-01T10:00:00Z", body: "First", url: null, reviewState: null, path: null, resolved: null, replies: [] },
    { id: "R1", kind: "review", author: "bob", createdAt: "2026-11-02T10:00:00Z", body: "", url: null, reviewState: "CHANGES_REQUESTED", path: null, resolved: null, replies: [] },
    {
      id: "T1",
      kind: "thread",
      author: "bob",
      createdAt: "2026-11-02T10:30:00Z",
      body: "Why?",
      url: null,
      reviewState: null,
      path: "src/a.ts",
      resolved: false,
      replies: [{ id: "TC2", author: "me", createdAt: "2026-11-02T12:00:00Z", body: "Because" }],
    },
    { id: "T2", kind: "thread", author: "ann", createdAt: "2026-11-03T09:00:00Z", body: "Nit", url: null, reviewState: null, path: "src/b.ts", resolved: true, replies: [] },
    { id: "C2", kind: "comment", author: "me", createdAt: "2026-11-04T10:00:00Z", body: "Done", url: null, reviewState: null, path: null, resolved: null, replies: [] },
  ],
};

const shownItems = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[data-timeline-item]")].map((item) => item.dataset.timelineItem);
const radio = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.closest("label")?.textContent === label);
const checkbox = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((r) => r.closest("label")?.textContent?.trim() === label);

test("Comments shows the whole timeline, filtered All, Unresolved or Mine, oldest first unless Newest first", async () => {
  const { container } = await render(
    github((cmd) => (cmd === "get_github_pr_timeline" ? timeline : undefined), { comments: { total: 5, unresolved: 0 } }),
  );
  await click(cellButton(container, "comments"));
  assert.equal(radio(container, "All")?.checked, true);
  assert.deepEqual(shownItems(container), ["C1", "R1", "T1", "T2", "C2"]);
  await click(radio(container, "Unresolved"));
  assert.deepEqual(shownItems(container), ["T1"]);
  await click(radio(container, "Mine"));
  assert.deepEqual(shownItems(container), ["T1", "C2"], "a thread the viewer replied in is theirs too");
  await click(checkbox(container, "Newest first"));
  assert.deepEqual(shownItems(container), ["C2", "T1"]);
  await click(radio(container, "All"));
  assert.deepEqual(shownItems(container), ["C2", "T2", "T1", "R1", "C1"]);
  const thread = container.querySelector<HTMLElement>('[data-timeline-item="T1"]') as HTMLElement;
  assert.match(thread.textContent ?? "", /src\/a\.ts/);
  assert.equal(thread.querySelector("[data-resolved]")?.textContent, "Unresolved");
  assert.match(thread.textContent ?? "", /Because/);
});

test("each Comments filter says so when it keeps nothing", async () => {
  const onlyOthers: PullRequestTimeline = { ...timeline, items: timeline.items.filter((item) => item.id === "C1") };
  const { container } = await render(
    github((cmd) => (cmd === "get_github_pr_timeline" ? onlyOthers : undefined), { comments: { total: 1, unresolved: 0 } }),
  );
  await click(cellButton(container, "comments"));
  const empty = () => detail(container)?.querySelector("ol")?.previousElementSibling?.textContent;
  await click(radio(container, "Unresolved"));
  assert.equal(empty(), "No unresolved comments.");
  await click(radio(container, "Mine"));
  assert.equal(empty(), "No comments of yours.");
});

/** Types `text` into a React-controlled field. */
const type = (field: HTMLTextAreaElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

test("the comment box sits above the items, with Close pull request beside Comment, and posting a comment works", async () => {
  let posted: string[] = [];
  const { container, calls } = await render(
    github(
      (cmd, args) => {
        if (cmd === "comment_on_github_pr") {
          posted = [...posted, args.body as string];
          return null;
        }
        if (cmd === "get_github_pr_timeline") {
          const extra = posted.map((body, i) => ({ ...timeline.items[0], id: `N${i}`, author: "me", body, createdAt: "2026-11-05T10:00:00Z" }));
          return { ...timeline, items: [...timeline.items, ...extra] };
        }
        return undefined;
      },
      { comments: { total: 5, unresolved: 0 } },
    ),
  );
  await click(cellButton(container, "comments"));
  const section = detail(container) as HTMLElement;
  const form = section.querySelector('form[aria-label="Add a comment"]') as HTMLFormElement;
  const firstItem = section.querySelector("[data-timeline-item]") as HTMLElement;
  assert.ok(form.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING, "the box comes before the items");
  assert.deepEqual([...form.querySelectorAll("button")].map((b) => b.textContent), ["Close pull request", "Comment"]);
  const comment = byName(form, "button", "Comment") as HTMLButtonElement;
  assert.equal(comment.disabled, true, "an empty comment cannot be posted");
  const box = form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]') as HTMLTextAreaElement;
  type(box, "Looks good");
  assert.deepEqual([...form.querySelectorAll("button")].map((b) => b.textContent), ["Close pull request", "Comment"], "typing does not relabel Close");
  await click(comment);
  assert.deepEqual(calls.find(([cmd]) => cmd === "comment_on_github_pr")?.[1], { repoPath: "E:/alpha", repo: "o/r", number: 12, body: "Looks good" });
  assert.equal(box.value, "", "the box empties once the comment is posted");
  assert.ok(shownItems(container).includes("N0"), "the timeline is read again and shows the new comment");
  assert.ok(calls.filter(([cmd]) => cmd === "get_github_pr_readiness").length >= 2, "the card's counts are read again");
});

test("a comment GitHub refuses says why and keeps what was typed", async () => {
  const { container } = await render(
    github((cmd) => {
      if (cmd === "comment_on_github_pr") throw "HTTP 403: Resource not accessible";
    }, { comments: { total: 0, unresolved: 0 } }),
  );
  await click(cellButton(container, "comments"));
  const box = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]') as HTMLTextAreaElement;
  type(box, "Looks good");
  await click(byName(container, "button", "Comment"));
  assert.match(detail(container)?.querySelector('[role="alert"]')?.textContent ?? "", /Comment failed: HTTP 403/);
  assert.equal(box.value, "Looks good");
});

test("Close pull request closes it, and a closed pull request offers no close", async () => {
  let state: PullRequestState = "OPEN";
  const { container, calls } = await render(
    github((cmd) => {
      if (cmd === "close_github_pr") state = "CLOSED";
      return cmd === "get_github_pr_readiness" ? pr({ state, comments: { total: 0, unresolved: 0 } }) : undefined;
    }),
  );
  await click(cellButton(container, "comments"));
  await click(byName(container, "button", "Close pull request"));
  assert.deepEqual(calls.find(([cmd]) => cmd === "close_github_pr")?.[1], { repoPath: "E:/alpha", repo: "o/r", number: 12 });
  assert.equal(calls.some(([cmd]) => cmd === "comment_on_github_pr"), false, "an empty box posts no comment");
  assert.equal(container.querySelector('[aria-label="Readiness"] h3')?.textContent, "Closed without merging");
  assert.equal(byName(container, "button", "Close pull request"), undefined);
});

test("Close pull request with text in the box closes it without posting the text", async () => {
  const { container, calls } = await render(github(undefined, { comments: { total: 0, unresolved: 0 } }));
  await click(cellButton(container, "comments"));
  const box = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]') as HTMLTextAreaElement;
  type(box, "Not posted");
  await click(byName(container, "button", "Close pull request"));
  assert.ok(calls.some(([cmd]) => cmd === "close_github_pr"));
  assert.equal(calls.some(([cmd]) => cmd === "comment_on_github_pr"), false);
});

const files: PullRequestFile[] = [
  { path: "src/a.ts", previousPath: null, status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-old\n+new\n+more" },
  { path: "src/b.ts", previousPath: null, status: "modified", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+b" },
  { path: "img/logo.png", previousPath: null, status: "added", additions: 0, deletions: 0, patch: null },
];

test("Files shows one file at a time, with a picker that marks files with comments, and previous and next", async () => {
  const { container } = await render(
    github((cmd) => (cmd === "get_github_pr_files" ? files : cmd === "get_github_pr_timeline" ? timeline : undefined), {
      comments: { total: 5, unresolved: 0 },
    }),
  );
  await click(cellButton(container, "files"));
  const picker = container.querySelector<HTMLSelectElement>('select[aria-label="File"]') as HTMLSelectElement;
  assert.deepEqual([...picker.options].map((o) => o.textContent), ["💬 src/a.ts (1 comment)", "💬 src/b.ts (1 comment)", "img/logo.png"]);
  const shown = () => [...container.querySelectorAll<HTMLElement>("[data-file]")].map((f) => f.dataset.file);
  assert.deepEqual(shown(), ["src/a.ts"]);
  assert.equal(container.querySelector("[data-file] pre")?.textContent, "@@ -1 +1,2 @@-old+new+more");
  const previous = byName(container, "button", "Previous") as HTMLButtonElement;
  const next = byName(container, "button", "Next") as HTMLButtonElement;
  assert.equal(previous.disabled, true);
  await click(next);
  assert.deepEqual(shown(), ["src/b.ts"]);
  await click(next);
  assert.deepEqual(shown(), ["img/logo.png"]);
  assert.equal(next.disabled, true);
  assert.match(container.querySelector("[data-file]")?.textContent ?? "", /No diff to show/);
  act(() => {
    picker.value = "0";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  assert.deepEqual(shown(), ["src/a.ts"]);
});

test("Commits lists the pull request's commits", async () => {
  const commits: PullRequestCommit[] = [
    { sha: "abc1234def", headline: "Add the thing", author: "ann", authoredAt: "2026-11-01T10:00:00Z", url: null },
    { sha: "def5678abc", headline: "Fix the thing", author: "bob", authoredAt: "2026-11-02T10:00:00Z", url: null },
  ];
  const { container } = await render(
    github((cmd) => (cmd === "get_github_pr_commits" ? commits : undefined), { comments: { total: 0, unresolved: 0 }, commits: 2 }),
  );
  await click(cellButton(container, "commits"));
  const rows = [...container.querySelectorAll<HTMLElement>("[data-commit]")];
  assert.deepEqual(
    rows.map((r) => [r.querySelector("code")?.textContent, (r.textContent ?? "").includes("the thing"), (r.textContent ?? "").includes(r === rows[0] ? "ann" : "bob")]),
    [
      ["abc1234", true, true],
      ["def5678", true, true],
    ],
  );
});

test("line comments, formal reviews, re-running checks and reviewer edits are not offered", async () => {
  const { container } = await render(
    github((cmd) => (cmd === "get_github_pr_files" ? files : cmd === "get_github_pr_timeline" ? timeline : undefined), {
      checks: { failing: 1, pending: 1, skipped: 1, passing: 1 },
      comments: { total: 5, unresolved: 1 },
    }),
  );
  const offered = new Set<string>();
  for (const cell of ["checks", "comments", "files", "commits"]) {
    if (cellButton(container, cell)?.getAttribute("aria-expanded") !== "true") await click(cellButton(container, cell));
    for (const control of container.querySelectorAll<HTMLElement>("[data-cell-detail] button, [data-cell-detail] textarea")) {
      offered.add((control.getAttribute("aria-label") ?? control.textContent ?? "").trim());
    }
  }
  assert.deepEqual([...offered].sort(), ["Close pull request", "Comment", "Hide log", "Next", "Previous"]);
  assert.equal(container.querySelectorAll("[data-file] textarea, [data-file] button").length, 0, "the diff takes no line comments");
});

// ---- The diff lens (#640) ----

/** A lens control that records what the companion asks of it, with `shown` open. */
const lensControl = (shown: DiffLensTarget | null = null) => {
  const asked: (DiffLensTarget | "close")[] = [];
  return { asked, lens: { shown, openDiff: (target: DiffLensTarget) => void asked.push(target), close: () => void asked.push("close") } };
};
const lensOn = (file: string | null): DiffLensTarget => ({ terminalId: "a", repoPath: "E:/alpha", repo: "o/r", number: 12, file });

test("the companion header's Diff lens button opens the lens on the terminal's pull request", async () => {
  const { asked, lens } = lensControl();
  const { container } = await render(github(), { lens });
  const toggle = byName(container, "button", "Diff lens");
  assert.equal(toggle?.getAttribute("aria-pressed"), "false");
  await click(toggle);
  assert.deepEqual(asked, [lensOn(null)]);
});

test("with the lens open, the header button shows pressed and closes it", async () => {
  const { asked, lens } = lensControl(lensOn(null));
  const { container } = await render(github(), { lens });
  const toggle = byName(container, "button", "Diff lens");
  assert.equal(toggle?.getAttribute("aria-pressed"), "true");
  await click(toggle);
  assert.deepEqual(asked, ["close"]);
});

test("the Files detail opens the lens on the file it shows", async () => {
  const { asked, lens } = lensControl();
  const { container } = await render(
    github((cmd) => (cmd === "get_github_pr_files" ? files : cmd === "get_github_pr_timeline" ? timeline : undefined), {
      comments: { total: 5, unresolved: 0 },
    }),
    { lens },
  );
  await click(cellButton(container, "files"));
  await click(byName(container, "button", "Next"));
  await click(byName(container, "button", "Open in the diff lens"));
  assert.deepEqual(asked, [lensOn("src/b.ts")]);
});

test("a click on a readiness cell closes the open lens", async () => {
  const { asked, lens } = lensControl(lensOn(null));
  const { container } = await render(github(undefined, { comments: { total: 0, unresolved: 0 } }), { lens });
  await click(cellButton(container, "commits"));
  assert.deepEqual(asked, ["close"]);
  assert.equal(cellButton(container, "commits")?.getAttribute("aria-expanded"), "true", "the cell still opens its detail");
});

test("with no lens open, a click on a readiness cell asks nothing of the lens", async () => {
  const { asked, lens } = lensControl();
  const { container } = await render(github(undefined, { comments: { total: 0, unresolved: 0 } }), { lens });
  await click(cellButton(container, "commits"));
  assert.deepEqual(asked, []);
});
