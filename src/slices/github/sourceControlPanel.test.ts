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

const { SourceControlPanel } = await import("./SourceControlPanel.tsx");

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
