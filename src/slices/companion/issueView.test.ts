/// <reference types="node" />
// Component tests for the companion's issue view (#641): the header, the status card and its one
// button, the cells and their details, and the switch between the pull request and the ticket.
// GitHub is reached through Tauri's `invoke`, the out-of-process boundary these tests fake.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LinkRef, LinkSlotName, TerminalInfo, TerminalLink } from "../terminal/types.ts";
import type { IssueChoices, IssueStatus, PullRequestReadiness } from "../github/types.ts";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo } from "./fixtures/companionFixtures.ts";

const { Companion, COMPANION_VIEWS } = await import("./Companion.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  fakeInvoke((cmd) => Promise.reject(new Error(`no fake for ${cmd}`)));
  unmount();
});

function unmount() {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
}

const issue = (over: Partial<IssueStatus> = {}): IssueStatus => ({
  repo: "o/r",
  number: 5,
  title: "Run canvas: node phases",
  body: "What to build",
  url: "https://github.com/o/r/issues/5",
  state: "OPEN",
  stateReason: null,
  issueType: "Feature",
  author: "you",
  createdAt: "2026-11-13T10:00:00Z",
  viewer: "you",
  assignees: [],
  labels: [{ name: "enhancement", color: "a2eeef" }],
  milestone: null,
  parent: null,
  blockedBy: [],
  openBlockerCount: 0,
  pullRequests: [],
  comments: [],
  commentCount: 0,
  ...over,
});

const ticketOnly: TerminalLink = {
  ticket: { repo: "o/r", number: 5, source: "launch", pinned: false, at: 1 },
  pull_request: null,
  candidates: [],
};

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

/** A GitHub that answers every read the issue view makes, with `over` taking precedence. */
const github =
  (status: Partial<IssueStatus> = {}, over: (cmd: string, args: Record<string, unknown>) => unknown = () => undefined) =>
  (cmd: string, args: Record<string, unknown>) => {
    const answer = over(cmd, args);
    if (answer !== undefined) return answer;
    if (cmd === "get_github_issue_status") return issue(status);
    if (cmd === "get_github_repo_info") return { owner: "o", name: "r", nwo: "o/r", is_authenticated: true };
    return null;
  };

async function render(
  answer: (cmd: string, args: Record<string, unknown>) => unknown,
  { link = ticketOnly, ...extra }: { link?: TerminalLink } & Record<string, unknown> = {},
) {
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

const card = (container: HTMLElement) => container.querySelector<HTMLElement>('[aria-label="Status"]');

test("a terminal with only a ticket shows the Ticket view: title, number, state pill, type and who opened it", async () => {
  const { container, calls } = await render(github());
  assert.equal(container.querySelector("[data-companion-view]")?.getAttribute("data-companion-view"), "ticket");
  assert.deepEqual(calls[0], ["get_github_issue_status", { repoPath: "E:/alpha", repo: "o/r", number: 5 }]);
  const header = container.querySelector<HTMLElement>("[data-issue-header]");
  assert.ok(header, "issue header");
  assert.match(header.querySelector("h2")?.textContent ?? "", /Run canvas: node phases\s*#5/);
  assert.equal(header.querySelector("[data-state-pill]")?.textContent, "Open");
  assert.equal(header.querySelector("[data-issue-type]")?.textContent, "Feature");
  assert.match(header.textContent ?? "", /you opened this/);
  assert.equal(card(container)?.querySelector("h3")?.textContent, "Ready to start");
});

const byName = (container: HTMLElement, role: string, name: string) =>
  [...container.querySelectorAll<HTMLElement>(`[role="${role}"], ${role === "button" ? "button" : role}`)].find(
    (el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim() === name,
  );
const click = async (el: HTMLElement | undefined) => {
  assert.ok(el, "element to click");
  act(() => el.click());
  await settle();
};

/** Ticket actions that record what they were asked to start. */
function recordingActions() {
  const started: [string, unknown][] = [];
  const record = (what: string) => (ticket: unknown) => void started.push([what, ticket]);
  return { started, ticketActions: { implement: record("implement"), triage: record("triage"), newWorktree: record("newWorktree") } };
}

test("Ready to start shows an Implement split button whose menu holds Implement, Triage and New worktree", async () => {
  const { started, ticketActions } = recordingActions();
  const { container } = await render(github(), { ticketActions });
  const ticket = { repoPath: "E:/alpha", repo: "o/r", number: 5, title: "Run canvas: node phases" };
  await click(byName(card(container)!, "button", "Implement"));
  assert.deepEqual(started, [["implement", ticket]]);
  const toggle = byName(container, "button", "More ways to start") as HTMLElement;
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await click(toggle);
  const items = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.deepEqual(items.map((i) => i.textContent), ["Implement", "Triage", "New worktree"]);
  await click(items[1]);
  assert.equal(container.querySelector('[role="menu"]'), null);
  await click(toggle);
  await click([...container.querySelectorAll<HTMLElement>('[role="menuitem"]')][2]);
  assert.deepEqual(started.slice(1), [["triage", ticket], ["newWorktree", ticket]]);
});

test("a ticket in another repository offers no Implement, and says where it lives", async () => {
  const { started, ticketActions } = recordingActions();
  const elsewhere: TerminalLink = { ...ticketOnly, ticket: { ...ticketOnly.ticket!, repo: "other/repo" } };
  const { container } = await render(github({ repo: "other/repo" }), { link: elsewhere, ticketActions });
  assert.equal(byName(card(container)!, "button", "Implement"), undefined);
  assert.match(card(container)?.textContent ?? "", /other\/repo is not this terminal's repository/);
  assert.deepEqual(started, []);
});

test("a ticket whose slot names the terminal's own repository, in any case, offers Implement", async () => {
  const { ticketActions } = recordingActions();
  const own: TerminalLink = { ...ticketOnly, ticket: { ...ticketOnly.ticket!, repo: "O/R" } };
  const { container } = await render(github(), { link: own, ticketActions });
  assert.ok(byName(card(container)!, "button", "Implement"));
});

/** Terminal links that hand back `link` and record each pin. */
function recordingLinking(link: TerminalLink) {
  const pins: [string, LinkSlotName, LinkRef][] = [];
  return {
    pins,
    linking: {
      linkOf: () => link,
      pin: (terminalId: string, slot: LinkSlotName, ref: LinkRef) => void pins.push([terminalId, slot, ref]),
      unpin: () => {},
      choices: () => [],
      loadChoices: () => {},
    },
  };
}

const blocker = { repo: "o/r", number: 4, title: "Graph run events", state: "OPEN", url: "https://github.com/o/r/issues/4" };
const openPr = { repo: "o/r", number: 12, title: "Node phases", state: "OPEN", url: "https://github.com/o/r/pull/12", checkState: "FAILURE" };

test("Blocked shows Show the blocker, which pins the blocker as the terminal's ticket", async () => {
  const { pins, linking } = recordingLinking(ticketOnly);
  const { container } = await render(github({ blockedBy: [blocker], openBlockerCount: 1 }), { linking });
  assert.equal(card(container)?.querySelector("h3")?.textContent, "Blocked by 1 open ticket");
  assert.equal(byName(card(container)!, "button", "Implement"), undefined);
  await click(byName(card(container)!, "button", "Show the blocker"));
  assert.deepEqual(pins, [["a", "ticket", { repo: "o/r", number: 4 }]]);
});

test("Pull request open shows Open pull request #N with its check state, which shows the pull request", async () => {
  const both: TerminalLink = { ...ticketOnly, pull_request: { repo: "o/r", number: 12, source: "activity", pinned: false, at: 2 } };
  const { pins, linking } = recordingLinking(both);
  const prefs = companionPrefs(memoryStorage({ quay_companion_opens_on: "ticket" }));
  const { container } = await render(github({ pullRequests: [openPr] }), { link: both, linking, prefs });
  assert.equal(card(container)?.querySelector("h3")?.textContent, "Pull request open · checks failing");
  await click(byName(card(container)!, "button", "Open pull request #12"));
  assert.deepEqual(pins, [], "the terminal's pull request slot already holds it");
  assert.equal(container.querySelector("[data-companion-view]")?.getAttribute("data-companion-view"), "pull-request");
  unmount();

  const other = recordingLinking(ticketOnly);
  const again = await render(github({ pullRequests: [openPr] }), { linking: other.linking });
  await click(byName(card(again.container)!, "button", "Open pull request #12"));
  assert.deepEqual(other.pins, [["a", "pull_request", { repo: "o/r", number: 12 }]]);
});

test("Closed shows Reopen, which reopens the ticket and reads it again", async () => {
  let state: IssueStatus["state"] = "CLOSED";
  const { container, calls } = await render(
    github({}, (cmd) => {
      if (cmd === "reopen_github_issue") state = "OPEN";
      if (cmd === "get_github_issue_status") return issue({ state, stateReason: state === "OPEN" ? "REOPENED" : "NOT_PLANNED" });
    }),
  );
  assert.equal(card(container)?.querySelector("h3")?.textContent, "Closed as not planned");
  await click(byName(card(container)!, "button", "Reopen"));
  assert.deepEqual(calls.find(([cmd]) => cmd === "reopen_github_issue")?.[1], { repoPath: "E:/alpha", repo: "o/r", number: 5 });
  assert.equal(card(container)?.querySelector("h3")?.textContent, "Ready to start");
});

const cellButton = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-issue-cell="${id}"] button`) ?? undefined;
const detail = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-cell-detail]");
const description = (container: HTMLElement) => container.querySelector('[aria-label="Description"]');
const comment = (id: string, author: string, createdAt: string, body = id) => ({
  id,
  author,
  createdAt,
  body,
  url: `https://github.com/o/r/issues/5#${id}`,
});

test("the cells are Blocked by, Comments, Pull request and Details; one opens its detail, a second click closes it", async () => {
  const { container } = await render(github({ commentCount: 2, assignees: ["claude"] }));
  assert.deepEqual(
    [...card(container)!.querySelectorAll<HTMLElement>("[data-issue-cell]")].map((c) => [c.dataset.issueCell, c.textContent]),
    [
      ["blocked-by", "Blocked byNone open"],
      ["comments", "Comments2"],
      ["pull-request", "Pull requestNone"],
      ["details", "Detailsclaude · 1 label"],
    ],
  );
  assert.equal(detail(container), null);
  assert.equal(description(container)?.textContent, "What to build");
  const details = cellButton(container, "details");
  assert.equal(details?.getAttribute("aria-expanded"), "false");
  await click(details);
  assert.equal(details?.getAttribute("aria-expanded"), "true");
  assert.equal(detail(container)?.getAttribute("aria-label"), "Details");
  assert.equal(detail(container)?.id, details?.getAttribute("aria-controls"));
  assert.equal(description(container), null);
  await click(cellButton(container, "comments"));
  assert.equal(detail(container)?.getAttribute("aria-label"), "Comments");
  assert.equal(details?.getAttribute("aria-expanded"), "false");
  await click(cellButton(container, "comments"));
  assert.equal(detail(container), null);
  assert.ok(description(container));
});

test("on arrival the view opens an open blocker, else a new comment, else nothing", async () => {
  const fresh = [comment("c1", "claude", "2026-11-14T10:00:00Z")];
  const blocked = await render(github({ blockedBy: [blocker], openBlockerCount: 1, comments: fresh, commentCount: 1 }));
  assert.equal(detail(blocked.container)?.getAttribute("aria-label"), "Blocked by");
  unmount();

  const commented = await render(github({ comments: fresh, commentCount: 1 }));
  assert.equal(detail(commented.container)?.getAttribute("aria-label"), "Comments");
  assert.equal(cellButton(commented.container, "comments")?.getAttribute("aria-expanded"), "true");
  unmount();

  const quiet = await render(github());
  assert.equal(detail(quiet.container), null);
});

const typeInto = (el: HTMLTextAreaElement | null, value: string) => {
  assert.ok(el, "text box");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("Comments shows the comment box above the timeline, oldest first, with new comments marked", async () => {
  const comments = [
    comment("c1", "you", "2026-11-14T09:00:00Z", "Started"),
    comment("c2", "claude", "2026-11-14T10:00:00Z", "One check fails"),
  ];
  const { container } = await render(github({ comments, commentCount: 2 }));
  const d = detail(container)!;
  assert.equal(d.getAttribute("aria-label"), "Comments");
  const box = d.querySelector("form");
  const timeline = d.querySelector("ol");
  assert.ok(box && timeline);
  assert.ok(box.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING, "the box is above the timeline");
  const items = [...timeline.querySelectorAll<HTMLElement>("[data-comment]")];
  assert.deepEqual(items.map((i) => i.dataset.comment), ["c1", "c2"]);
  assert.equal(items[0].querySelector("[data-new]"), null);
  assert.equal(items[1].querySelector("[data-new]")?.textContent, "New");
});

test("Comment posts what is typed and reads the ticket again", async () => {
  const { container, calls } = await render(github());
  await click(cellButton(container, "comments"));
  typeInto(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]'), "Looks good");
  await click(byName(detail(container)!, "button", "Comment"));
  assert.deepEqual(calls.find(([cmd]) => cmd === "comment_on_github_issue")?.[1], {
    repoPath: "E:/alpha",
    repo: "o/r",
    number: 5,
    body: "Looks good",
  });
  assert.equal(calls.filter(([cmd]) => cmd === "get_github_issue_status").length, 2);
  assert.equal(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.value, "");
});

test("the close split button reads Close as completed, or Close with comment once text is typed, with completed, not planned and duplicate", async () => {
  const { container, calls } = await render(github());
  await click(cellButton(container, "comments"));
  const d = () => detail(container)!;
  assert.ok(byName(d(), "button", "Close as completed"));
  await click(byName(d(), "button", "Choose a close reason"));
  const reasons = [...container.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  assert.deepEqual(reasons.map((r) => [r.textContent, r.getAttribute("aria-checked")]), [
    ["Completed", "true"],
    ["Not planned", "false"],
    ["Duplicate", "false"],
  ]);
  await click(reasons[1]);
  await click(byName(d(), "button", "Close as not planned"));
  assert.deepEqual(calls.find(([cmd]) => cmd === "close_github_issue")?.[1], {
    repoPath: "E:/alpha",
    repo: "o/r",
    number: 5,
    reason: "NOT_PLANNED",
    comment: null,
  });
  typeInto(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]'), "Done in #12");
  await click(byName(d(), "button", "Close with comment"));
  assert.deepEqual(calls.filter(([cmd]) => cmd === "close_github_issue")[1]?.[1], {
    repoPath: "E:/alpha",
    repo: "o/r",
    number: 5,
    reason: "NOT_PLANNED",
    comment: "Done in #12",
  });
});

test("a closed ticket's comment box has no close button", async () => {
  const { container } = await render(github({ state: "CLOSED", stateReason: "COMPLETED" }));
  await click(cellButton(container, "comments"));
  assert.ok(byName(detail(container)!, "button", "Comment"));
  assert.equal(byName(detail(container)!, "button", "Choose a close reason"), undefined);
});

const choices: IssueChoices = {
  assignees: ["you", "claude"],
  labels: [
    { name: "enhancement", color: "a2eeef" },
    { name: "ready-for-agent", color: "3fb950" },
  ],
  types: ["Bug", "Feature", "Task"],
};

const row = (container: HTMLElement, name: string) => detail(container)?.querySelector<HTMLElement>(`[data-detail-row="${name}"]`);

test("Details lists Assignees, Labels, Type, Milestone, Parent, Blocked by and Development", async () => {
  const { container } = await render(
    github({
      milestone: { title: "v1", url: "https://github.com/o/r/milestone/1" },
      parent: { repo: "o/r", number: 2, title: "Graph runs", state: "OPEN", url: "https://github.com/o/r/issues/2" },
      blockedBy: [{ ...blocker, state: "CLOSED" }],
      pullRequests: [openPr],
    }),
  );
  await click(cellButton(container, "details"));
  assert.deepEqual(
    [...detail(container)!.querySelectorAll<HTMLElement>("[data-detail-row]")].map((r) => r.dataset.detailRow),
    ["Assignees", "Labels", "Type", "Milestone", "Parent", "Blocked by", "Development"],
  );
  const links = (name: string) => [...row(container, name)!.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
  assert.deepEqual(links("Milestone"), [["v1", "https://github.com/o/r/milestone/1"]]);
  assert.deepEqual(links("Parent"), [["Graph runs #2", "https://github.com/o/r/issues/2"]]);
  assert.deepEqual(links("Blocked by"), [["Graph run events #4", "https://github.com/o/r/issues/4"]]);
  assert.deepEqual(links("Development"), [["Node phases #12", "https://github.com/o/r/pull/12"]]);
  for (const name of ["Milestone", "Parent", "Blocked by", "Development"]) {
    assert.equal(row(container, name)?.querySelector("button"), null, `${name} is read-only`);
  }
});

test("Assign yourself shows while the ticket is unassigned and assigns the viewer", async () => {
  let assignees: string[] = [];
  const { container, calls } = await render(
    github({}, (cmd, args) => {
      if (cmd === "edit_github_issue_assignees") assignees = args.add as string[];
      if (cmd === "get_github_issue_status") return issue({ assignees });
    }),
  );
  await click(cellButton(container, "details"));
  await click(byName(row(container, "Assignees")!, "button", "Assign yourself"));
  assert.deepEqual(calls.find(([cmd]) => cmd === "edit_github_issue_assignees")?.[1], {
    repoPath: "E:/alpha",
    repo: "o/r",
    number: 5,
    add: ["you"],
    remove: [],
  });
  assert.equal(byName(row(container, "Assignees")!, "button", "Assign yourself"), undefined);
  assert.match(row(container, "Assignees")?.textContent ?? "", /you/);
});

test("the Assignees, Labels and Type Edit pickers offer the repository's choices and change the ticket", async () => {
  const { container, calls } = await render(
    github({ assignees: ["claude"] }, (cmd) => (cmd === "get_github_issue_choices" ? choices : undefined)),
  );
  await click(cellButton(container, "details"));

  const editAssignees = byName(row(container, "Assignees")!, "button", "Edit assignees");
  assert.equal(editAssignees?.getAttribute("aria-expanded"), "false");
  await click(editAssignees);
  assert.equal(editAssignees?.getAttribute("aria-expanded"), "true");
  assert.deepEqual(calls.find(([cmd]) => cmd === "get_github_issue_choices")?.[1], { repoPath: "E:/alpha", repo: "o/r" });
  const people = [...row(container, "Assignees")!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  assert.deepEqual(people.map((p) => [p.closest("label")?.textContent, p.checked]), [["you", false], ["claude", true]]);
  await click(people[1]);
  assert.deepEqual(calls.find(([cmd]) => cmd === "edit_github_issue_assignees")?.[1], {
    repoPath: "E:/alpha",
    repo: "o/r",
    number: 5,
    add: [],
    remove: ["claude"],
  });

  await click(byName(row(container, "Labels")!, "button", "Edit labels"));
  const labels = [...row(container, "Labels")!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  assert.deepEqual(labels.map((l) => [l.closest("label")?.textContent, l.checked]), [["enhancement", true], ["ready-for-agent", false]]);
  await click(labels[1]);
  assert.deepEqual(calls.find(([cmd]) => cmd === "edit_github_issue_labels")?.[1], {
    repoPath: "E:/alpha",
    repo: "o/r",
    number: 5,
    add: ["ready-for-agent"],
    remove: [],
  });

  await click(byName(row(container, "Type")!, "button", "Edit type"));
  const types = [...row(container, "Type")!.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  assert.deepEqual(types.map((t) => [t.closest("label")?.textContent, t.checked]), [
    ["No type", false],
    ["Bug", false],
    ["Feature", true],
    ["Task", false],
  ]);
  await click(types[1]);
  assert.deepEqual(calls.find(([cmd]) => cmd === "set_github_issue_type")?.[1], {
    repoPath: "E:/alpha",
    repo: "o/r",
    number: 5,
    issueType: "Bug",
  });
});

test("Blocked by lists each blocker and the parent, and Show pins one as the terminal's ticket", async () => {
  const { pins, linking } = recordingLinking(ticketOnly);
  const parent = { repo: "o/p", number: 2, title: "Graph runs", state: "OPEN", url: "https://github.com/o/p/issues/2" };
  const { container } = await render(
    github({ blockedBy: [blocker, { ...blocker, number: 3, title: "Old", state: "CLOSED" }], openBlockerCount: 1, parent }),
    { linking },
  );
  const items = [...detail(container)!.querySelectorAll<HTMLElement>("[data-ref]")];
  assert.deepEqual(items.map((i) => i.dataset.ref), ["o/r#4", "o/r#3", "o/p#2"]);
  assert.match(items[0].textContent ?? "", /Graph run events #4.*Open/);
  assert.match(items[1].textContent ?? "", /Closed/);
  await click(byName(items[2], "button", "Show Graph runs #2"));
  await click(byName(items[0], "button", "Show Graph run events #4"));
  assert.deepEqual(pins, [
    ["a", "ticket", { repo: "o/p", number: 2 }],
    ["a", "ticket", { repo: "o/r", number: 4 }],
  ]);
});

test("Pull request lists the pull requests that will close the ticket, and Show opens one in the companion", async () => {
  const { pins, linking } = recordingLinking(ticketOnly);
  const merged = { ...openPr, number: 9, title: "Earlier try", state: "MERGED", checkState: "SUCCESS" };
  const { container } = await render(github({ pullRequests: [openPr, merged] }), { linking });
  await click(cellButton(container, "pull-request"));
  const items = [...detail(container)!.querySelectorAll<HTMLElement>("[data-ref]")];
  assert.deepEqual(items.map((i) => i.dataset.ref), ["o/r#12", "o/r#9"]);
  assert.match(items[0].textContent ?? "", /Node phases #12.*Open · checks failing/);
  assert.match(items[1].textContent ?? "", /Merged/);
  await click(byName(items[0], "button", "Show Node phases #12"));
  assert.deepEqual(pins, [["a", "pull_request", { repo: "o/r", number: 12 }]]);
  unmount();

  const none = await render(github());
  await click(cellButton(none.container, "pull-request"));
  assert.match(detail(none.container)?.textContent ?? "", /No pull request will close this ticket yet\./);
});

const readiness = (): PullRequestReadiness => ({
  repo: "o/r",
  number: 12,
  title: "Node phases",
  body: "",
  url: "https://github.com/o/r/pull/12",
  state: "OPEN",
  isDraft: false,
  baseRefName: "master",
  headRefName: "ticket-5",
  headRefOid: "0123456789abcdef0123456789abcdef01234567",
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
});

const slotSwitch = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Linked to this terminal"]');
const shownView = (container: HTMLElement) => container.querySelector("[data-companion-view]")?.getAttribute("data-companion-view");
const viewSwitchLabels = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[role="radiogroup"][aria-label="Companion view"] [role="radio"]')].map((r) => r.textContent);

test("with both slots filled the pull request shows first, and a switch naming each slot's source reaches the ticket", async () => {
  const both: TerminalLink = { ...ticketOnly, pull_request: { repo: "o/r", number: 12, source: "activity", pinned: false, at: 2 } };
  const { container } = await render(github({}, (cmd) => (cmd === "get_github_pr_readiness" ? readiness() : undefined)), { link: both });
  assert.equal(shownView(container), "pull-request");
  const radios = () => [...slotSwitch(container)!.querySelectorAll<HTMLElement>('[role="radio"]')];
  assert.deepEqual(
    radios().map((r) => [r.textContent, r.getAttribute("aria-checked")]),
    [
      ["Pull request o/r#12 from agent activity", "true"],
      ["Ticket o/r#5 from its launch", "false"],
    ],
  );
  assert.deepEqual(viewSwitchLabels(container), ["Pull request", "Repository"], "the slot switch, not the view switch, reaches the ticket");
  await click(radios()[1]);
  assert.equal(shownView(container), "ticket");
  assert.deepEqual(radios().map((r) => r.getAttribute("aria-checked")), ["false", "true"]);
  await click(radios()[0]);
  assert.equal(shownView(container), "pull-request");
});

test("the slot switch shows only when both slots are filled", async () => {
  const ticket = await render(github());
  assert.equal(slotSwitch(ticket.container), null);
  assert.deepEqual(viewSwitchLabels(ticket.container), ["Ticket", "Repository"]);
  unmount();

  const prOnly: TerminalLink = { ticket: null, pull_request: { repo: "o/r", number: 12, source: "branch", pinned: false, at: 2 }, candidates: [] };
  const pr = await render(() => readiness(), { link: prOnly });
  assert.equal(shownView(pr.container), "pull-request");
  assert.equal(slotSwitch(pr.container), null);
});
