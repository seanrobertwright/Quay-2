/// <reference types="node" />
// Component tests for the Source control panel (#642): its pull request and issue lists with their
// filters and paging, picking a row for the companion, and the tools it opens. GitHub is reached
// through Tauri's `invoke`, the out-of-process boundary these tests fake.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GithubIssue, GithubPullRequest } from "./types.ts";
import type { GithubPage } from "./paging.ts";

const { SourceControlPanel, REPO_SETTLE_MS } = await import("./SourceControlPanel.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  fakeInvoke((cmd) => Promise.reject(new Error(`no fake for ${cmd}`)));
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

const pr = (number: number, title: string, over: Partial<GithubPullRequest> = {}): GithubPullRequest => ({
  number,
  title,
  state: "OPEN",
  isDraft: false,
  headRefName: `ticket-${number}`,
  baseRefName: "master",
  labels: [],
  author: { login: "you" },
  mergeable: "MERGEABLE",
  url: `https://github.com/o/r/pull/${number}`,
  closingIssues: [],
  ...over,
});

const issue = (number: number, title: string, over: Partial<GithubIssue> = {}): GithubIssue => ({
  number,
  title,
  state: "OPEN",
  author: { login: "you" },
  labels: [],
  assignees: [],
  updatedAt: "2026-11-14T10:00:00Z",
  url: `https://github.com/o/r/issues/${number}`,
  blockedBy: [],
  openBlockerCount: 0,
  ...over,
});

const page = <T>(items: T[], endCursor: string | null = null): GithubPage<T> => ({ items, endCursor, hasNextPage: endCursor !== null });

type Answer = (cmd: string, args: Record<string, unknown>) => unknown;

/** A GitHub with the pull requests and issues given, every list on one page, and `over` first. */
const github =
  (prs: GithubPullRequest[], issues: GithubIssue[], over: Answer = () => undefined): Answer =>
  (cmd, args) => {
    const answer = over(cmd, args);
    if (answer !== undefined) return answer;
    if (cmd === "get_github_repo_info") return { owner: "o", name: "r", nwo: "o/r", is_authenticated: true };
    if (cmd === "list_github_prs") return page(prs);
    if (cmd === "list_github_issues") return page(issues);
    return null;
  };

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

interface Calls {
  calls: unknown[][];
}

async function render(answer: Answer, props: Record<string, unknown> = {}) {
  const calls: Calls["calls"] = [];
  const invoked: [string, Record<string, unknown>][] = [];
  fakeInvoke(async (cmd, args) => {
    invoked.push([cmd, args]);
    return answer(cmd, args);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  const element = (extra: Record<string, unknown>) =>
    createElement(SourceControlPanel, {
      isOpen: true,
      repoPath: "E:/repo",
      repoName: "repo",
      pickTarget: "agent",
      onPick: (...args: unknown[]) => calls.push(["pick", ...args]),
      onOpenTopos: () => calls.push(["topos"]),
      onOpenDiffs: () => calls.push(["diffs"]),
      onOpenPrePrAudit: () => calls.push(["audit"]),
      ...props,
      ...extra,
    });
  act(() => root.render(element({})));
  await settle();
  return { container, calls, invoked, rerender: (extra: Record<string, unknown>) => act(() => root.render(element(extra))) };
}

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Pull requests"] button[data-row], [aria-label="Issues"] button[data-row]')];
const button = (container: HTMLElement, name: string) => {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );
  assert.ok(found, `no button ${name}`);
  return found;
};

test("the panel lists the repository's open pull requests, and picking one opens it in the companion", async () => {
  const { container, calls, invoked } = await render(github([pr(12, "Source control panel"), pr(11, "Ticket view")], []));
  assert.deepEqual(
    rows(container).map((r) => r.textContent?.includes("#12") ? "12" : r.textContent?.includes("#11") ? "11" : "?"),
    ["12", "11"],
  );
  const prList = invoked.find(([cmd]) => cmd === "list_github_prs");
  assert.equal(prList?.[1].repoPath, "E:/repo");
  assert.equal(prList?.[1].state, "open");
  act(() => rows(container)[0].click());
  assert.deepEqual(calls, [["pick", "pull_request", { repo: "o/r", number: 12 }]]);
});

const radio = (container: HTMLElement, group: string, name: string) => {
  const found = [...container.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`)].find(
    (r) => r.textContent?.trim().startsWith(name),
  );
  assert.ok(found, `no ${name} in ${group}`);
  return found;
};

test("the Issues choice lists open issues, and picking one opens it as the terminal's ticket", async () => {
  const { container, calls } = await render(github([pr(12, "Source control panel")], [issue(642, "Source control panel"), issue(643, "Agents panel")]));
  const issues = radio(container, "List", "Issues");
  act(() => issues.click());
  assert.equal(issues.getAttribute("aria-checked"), "true");
  assert.equal(rows(container).length, 2);
  assert.match(rows(container)[1].textContent ?? "", /#643.*Agents panel/);
  act(() => rows(container)[0].click());
  assert.deepEqual(calls, [["pick", "ticket", { repo: "o/r", number: 642 }]]);
});

test("the state filter lists all pull requests, closed ones too, and each list keeps its own", async () => {
  const merged = pr(9, "Old work", { state: "MERGED" });
  const { container, invoked } = await render(
    github([pr(12, "Source control panel")], [issue(642, "Source control panel")], (cmd, args) =>
      cmd === "list_github_prs" && args.state === "all" ? page([pr(12, "Source control panel"), merged]) : undefined,
    ),
  );
  act(() => radio(container, "State", "All").click());
  await settle();
  assert.equal(invoked.filter(([cmd, args]) => cmd === "list_github_prs" && args.state === "all").length, 1);
  assert.equal(rows(container).length, 2);
  assert.match(rows(container)[1].textContent ?? "", /Merged/);
  act(() => radio(container, "List", "Issues").click());
  assert.equal(radio(container, "State", "Open").getAttribute("aria-checked"), "true");
  assert.equal(invoked.filter(([cmd, args]) => cmd === "list_github_issues" && args.state === "all").length, 0);
});

/** Types `value` into the labelled field, as React sees typing. */
function type(field: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = field instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
  act(() => {
    field.dispatchEvent(new window.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }) as unknown as Event);
  });
}
const field = <T extends HTMLElement>(container: HTMLElement, label: string) => {
  const found = container.querySelector<T>(`[aria-label="${label}"]`);
  assert.ok(found, `no field ${label}`);
  return found;
};

test("the search narrows pull requests by number, title or head branch, and issues by label too", async () => {
  const bug = { name: "bug", color: "d73a4a" };
  const { container } = await render(
    github(
      [pr(12, "Source control panel"), pr(11, "Ticket view", { headRefName: "feat/issue-641" })],
      [issue(642, "Source control panel", { labels: [bug] }), issue(643, "Agents panel")],
    ),
  );
  const search = field<HTMLInputElement>(container, "Filter by title, number, branch or label");
  type(search, "issue-641");
  assert.deepEqual(rows(container).map((r) => /#(\d+)/.exec(r.textContent ?? "")?.[1]), ["11"]);
  type(search, "12");
  assert.deepEqual(rows(container).map((r) => /#(\d+)/.exec(r.textContent ?? "")?.[1]), ["12"]);
  act(() => radio(container, "List", "Issues").click());
  type(search, "bug");
  assert.deepEqual(rows(container).map((r) => /#(\d+)/.exec(r.textContent ?? "")?.[1]), ["642"]);
  type(search, "");
  const label = field<HTMLSelectElement>(container, "Label");
  assert.deepEqual([...label.options].map((o) => o.textContent), ["All labels", "bug"]);
  type(label, "bug");
  assert.deepEqual(rows(container).map((r) => /#(\d+)/.exec(r.textContent ?? "")?.[1]), ["642"]);
});

test("a long list says how much is loaded, and stops paging at 500 rows", async () => {
  const many = Array.from({ length: 500 }, (_, i) => pr(1000 - i, `Change ${i}`));
  const { container, invoked } = await render(
    github([], [issue(1, "One")], (cmd, args) => {
      if (cmd === "list_github_prs") return page(many, "next");
      if (cmd === "list_github_issues") return args.after ? page([issue(2, "Two")]) : page([issue(1, "One")], "more");
      return undefined;
    }),
  );
  const status = () => container.querySelector('[role="status"]')?.textContent?.trim();
  assert.equal(rows(container).length, 500);
  assert.match(status() ?? "", /First 500 shown; filter to narrow the list/);
  assert.equal(invoked.filter(([cmd, args]) => cmd === "list_github_prs" && args.after).length, 0);
  act(() => radio(container, "List", "Issues").click());
  assert.match(status() ?? "", /1 loaded/);
});

test("the panel opens Topos, the repo-wide Diffs and the Pre-PR Audit", async () => {
  const { container, calls } = await render(github([], []));
  for (const name of ["Topos", "Diffs", "Pre-PR Audit"]) act(() => button(container, name).click());
  assert.deepEqual(calls, [["topos"], ["diffs"], ["audit"]]);
});

test("with no terminal selected a row cannot be picked, and the panel says why", async () => {
  const { container, calls, rerender } = await render(github([pr(12, "Source control panel")], []), { pickTarget: null });
  assert.equal(rows(container)[0].disabled, true);
  assert.match(container.textContent ?? "", /Select a terminal to open a pull request or issue in the companion/);
  act(() => rows(container)[0].click());
  assert.deepEqual(calls, []);
  rerender({ pickTarget: "agent" });
  assert.equal(rows(container)[0].disabled, false);
  assert.match(container.textContent ?? "", /Opens in the companion for agent/);
});

/** A GitHub whose answers wait until `release(cmd)` is called; each answer is per repository. */
function heldGithub(byRepo: Record<string, { nwo: string; prs: GithubPullRequest[]; issues: GithubIssue[] }>) {
  const held: { cmd: string; repoPath: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const answer: Answer = (cmd, args) =>
    new Promise((resolve, reject) => held.push({ cmd, repoPath: String(args.repoPath), resolve, reject }));
  const release = async (repoPath: string, cmd?: string) => {
    for (const h of held.filter((h) => h.repoPath === repoPath && (!cmd || h.cmd === cmd))) {
      held.splice(held.indexOf(h), 1);
      const repo = byRepo[repoPath];
      if (h.cmd === "get_github_repo_info") h.resolve({ owner: "o", name: "r", nwo: repo.nwo, is_authenticated: true });
      else if (h.cmd === "list_github_prs") h.resolve(page(repo.prs));
      else if (h.cmd === "list_github_issues") h.resolve(page(repo.issues));
      else h.resolve(null);
    }
    await settle();
  };
  const fail = async (repoPath: string, cmd: string, message: string) => {
    for (const h of held.filter((h) => h.repoPath === repoPath && h.cmd === cmd)) {
      held.splice(held.indexOf(h), 1);
      h.reject(new Error(message));
    }
    await settle();
  };
  return { answer, release, fail, held };
}

const header = (container: HTMLElement) => container.querySelector("h2")?.parentElement?.textContent ?? "";
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

test("a repository switch clears the old lists, name and error at once and says what is loading (#845)", async () => {
  const gh = heldGithub({
    "E:/a": { nwo: "o/alpha", prs: [pr(1, "Alpha change")], issues: [] },
    "E:/b": { nwo: "o/beta", prs: [pr(2, "Beta change")], issues: [] },
  });
  const { container, rerender } = await render(gh.answer, { repoPath: "E:/a", repoName: "alpha-folder" });
  await gh.release("E:/a");
  assert.match(header(container), /o\/alpha/);
  assert.equal(rows(container).length, 1);

  rerender({ repoPath: "E:/b", repoName: "beta-folder" });
  assert.equal(rows(container).length, 0, "the old repository's rows are gone at once");
  assert.doesNotMatch(container.textContent ?? "", /o\/alpha|Alpha change/);
  assert.match(header(container), /beta-folder/, "the header names the project until GitHub answers");
  assert.match(container.textContent ?? "", /Loading pull requests for beta-folder/);

  // A late answer for the old repository is dropped.
  await gh.release("E:/a");
  assert.equal(rows(container).length, 0);
  await gh.release("E:/b");
  assert.match(header(container), /o\/beta/);
  assert.match(rows(container)[0].textContent ?? "", /Beta change/);
  assert.doesNotMatch(container.textContent ?? "", /Loading pull requests/);
});

test("an old repository's error does not show under the new one, and a new failure names the project (#845)", async () => {
  const gh = heldGithub({
    "E:/a": { nwo: "o/alpha", prs: [], issues: [] },
    "E:/b": { nwo: "o/beta", prs: [], issues: [] },
  });
  const { container, rerender } = await render(gh.answer, { repoPath: "E:/a", repoName: "alpha-folder" });
  await gh.fail("E:/a", "list_github_prs", "gh exploded");
  assert.match(container.textContent ?? "", /Couldn.t read GitHub for alpha-folder/);
  rerender({ repoPath: "E:/b", repoName: "beta-folder" });
  assert.doesNotMatch(container.textContent ?? "", /gh exploded|Couldn.t read GitHub/);
  await gh.fail("E:/b", "list_github_prs", "not signed in");
  assert.match(container.textContent ?? "", /Couldn.t read GitHub for beta-folder/);
});

test("a switch clears the search and label but keeps the list and state choices (#845)", async () => {
  const bug = { name: "bug", color: "d73a4a" };
  const { container, rerender } = await render(
    github([pr(1, "One")], [issue(5, "Five", { labels: [bug] })]),
    { repoPath: "E:/a", repoName: "a" },
  );
  act(() => radio(container, "List", "Issues").click());
  act(() => radio(container, "State", "All").click());
  await settle();
  type(field<HTMLInputElement>(container, "Filter by title, number, branch or label"), "five");
  type(field<HTMLSelectElement>(container, "Label"), "bug");
  rerender({ repoPath: "E:/b", repoName: "b" });
  await settle();
  assert.equal(field<HTMLInputElement>(container, "Filter by title, number, branch or label").value, "");
  assert.equal(field<HTMLSelectElement>(container, "Label").value, "");
  assert.equal(radio(container, "List", "Issues").getAttribute("aria-checked"), "true");
  assert.equal(radio(container, "State", "All").getAttribute("aria-checked"), "true");
});

test("while closed, the panel loads a new repository once it has stayed for the settle time (#845)", async () => {
  const { container, invoked, rerender } = await render(github([pr(1, "One")], []), {
    isOpen: false,
    repoPath: "E:/a",
    repoName: "a",
  });
  await wait(REPO_SETTLE_MS + 50);
  const loadsOf = (repoPath: string) => invoked.filter(([, args]) => args.repoPath === repoPath).map(([cmd]) => cmd).sort();
  assert.deepEqual(loadsOf("E:/a"), ["get_github_repo_info", "list_github_issues", "list_github_prs"]);

  // Passing through b on the way to c never loads b.
  rerender({ repoPath: "E:/b", repoName: "b" });
  await wait(REPO_SETTLE_MS / 3);
  rerender({ repoPath: "E:/c", repoName: "c" });
  await wait(REPO_SETTLE_MS + 50);
  assert.deepEqual(loadsOf("E:/b"), []);
  assert.equal(loadsOf("E:/c").length, 3);
  assert.match(rows(container)[0].textContent ?? "", /One/);

  // Closing the panel again does not reload what is loaded.
  rerender({ isOpen: true });
  await settle();
  const afterOpen = loadsOf("E:/c").length;
  rerender({ isOpen: false });
  await wait(REPO_SETTLE_MS + 50);
  assert.equal(loadsOf("E:/c").length, afterOpen);
});

test("opening the panel during the settle time loads at once (#845)", async () => {
  const { invoked, rerender } = await render(github([], []), { isOpen: false, repoPath: "E:/a", repoName: "a" });
  rerender({ isOpen: true });
  await settle();
  assert.equal(invoked.filter(([, args]) => args.repoPath === "E:/a").length, 3);
  await wait(REPO_SETTLE_MS + 50);
  assert.equal(invoked.filter(([, args]) => args.repoPath === "E:/a").length, 3, "the pending settle load was cancelled");
});

test("a repository visited before shows its GitHub name at once (#845)", async () => {
  const gh = heldGithub({
    "E:/remembered-a": { nwo: "o/alpha", prs: [], issues: [] },
    "E:/remembered-b": { nwo: "o/beta", prs: [], issues: [] },
  });
  const { container, rerender } = await render(gh.answer, { repoPath: "E:/remembered-a", repoName: "alpha-folder" });
  await gh.release("E:/remembered-a");
  rerender({ repoPath: "E:/remembered-b", repoName: "beta-folder" });
  await gh.release("E:/remembered-b");
  rerender({ repoPath: "E:/remembered-a", repoName: "alpha-folder" });
  assert.match(header(container), /o\/alpha/);
  assert.doesNotMatch(header(container), /o\/beta/);
});
