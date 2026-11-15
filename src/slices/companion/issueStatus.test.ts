// The issue view's status card, cells and arrival cell, from an issue's state (#641).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CheckRollupState, IssueState, IssueStatus, PullRequestState } from "../github/types.ts";
import { closeButtonLabel, issueArrivalCell, issueCells, newComments, statusCard } from "./issueStatus.ts";

const issue = (over: Partial<IssueStatus> = {}): IssueStatus => ({
  repo: "o/r",
  number: 571,
  title: "Run canvas: node phases",
  body: "",
  url: "https://github.com/o/r/issues/571",
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

test("an open ticket with no open blocker and no open pull request is Ready to start, with Implement", () => {
  const card = statusCard(issue());
  assert.equal(card.tone, "ready");
  assert.equal(card.headline, "Ready to start");
  assert.equal(card.reason, "No open blockers · unassigned");
  assert.deepEqual(card.action, { kind: "implement" });
  assert.equal(statusCard(issue({ assignees: ["claude"] })).reason, "No open blockers · assigned to claude");
});

const blocker = (number: number, state: IssueState = "OPEN") => ({
  repo: "o/r",
  number,
  title: `Blocker ${number}`,
  state,
  url: `https://github.com/o/r/issues/${number}`,
});

test("an open ticket with an open blocker is Blocked, and its button shows the first open blocker", () => {
  const card = statusCard(issue({ blockedBy: [blocker(560, "CLOSED"), blocker(569), blocker(570)], openBlockerCount: 2 }));
  assert.equal(card.tone, "blocked");
  assert.equal(card.headline, "Blocked by 2 open tickets");
  assert.equal(card.reason, "Blocker 569 (#569)");
  assert.deepEqual(card.action, { kind: "show-blocker", blocker: blocker(569) });
  assert.equal(statusCard(issue({ blockedBy: [blocker(569)], openBlockerCount: 1 })).headline, "Blocked by 1 open ticket");
});

test("closed blockers do not block", () => {
  assert.equal(statusCard(issue({ blockedBy: [blocker(560, "CLOSED")], openBlockerCount: 0 })).headline, "Ready to start");
});

const pullRequest = (number: number, state: PullRequestState = "OPEN", checkState: CheckRollupState | null = "FAILURE") => ({
  repo: "o/r",
  number,
  title: `Change ${number}`,
  state,
  url: `https://github.com/o/r/pull/${number}`,
  checkState,
});

test("an open ticket with an open pull request shows Open pull request #N with its check state", () => {
  const card = statusCard(issue({ pullRequests: [pullRequest(560, "MERGED", "SUCCESS"), pullRequest(574)] }));
  assert.equal(card.tone, "progress");
  assert.equal(card.headline, "Pull request open · checks failing");
  assert.equal(card.reason, "Change 574 (#574)");
  assert.deepEqual(card.action, { kind: "open-pull-request", pullRequest: pullRequest(574) });
  const said = (checkState: CheckRollupState | null) => statusCard(issue({ pullRequests: [pullRequest(574, "OPEN", checkState)] })).headline;
  assert.equal(said("SUCCESS"), "Pull request open · checks passing");
  assert.equal(said("ERROR"), "Pull request open · checks failing");
  assert.equal(said("PENDING"), "Pull request open · checks running");
  assert.equal(said("EXPECTED"), "Pull request open · checks running");
  assert.equal(said(null), "Pull request open · no checks");
});

test("an open blocker wins over an open pull request, and a merged pull request alone leaves it Ready to start", () => {
  assert.equal(statusCard(issue({ blockedBy: [blocker(569)], openBlockerCount: 1, pullRequests: [pullRequest(574)] })).tone, "blocked");
  assert.equal(statusCard(issue({ pullRequests: [pullRequest(560, "MERGED")] })).headline, "Ready to start");
});

test("a closed ticket says why it closed and shows Reopen, whatever else it has", () => {
  const closed = (stateReason: IssueStatus["stateReason"]) =>
    statusCard(issue({ state: "CLOSED", stateReason, blockedBy: [blocker(569)], openBlockerCount: 1, pullRequests: [pullRequest(574)] }));
  assert.deepEqual(closed("COMPLETED"), { tone: "closed", headline: "Closed as completed", reason: "", action: { kind: "reopen" } });
  assert.equal(closed("NOT_PLANNED").headline, "Closed as not planned");
  assert.equal(closed("DUPLICATE").headline, "Closed as duplicate");
  assert.equal(closed(null).headline, "Closed");
  assert.equal(
    statusCard(issue({ state: "CLOSED", stateReason: "COMPLETED", pullRequests: [pullRequest(574, "MERGED")] })).reason,
    "By Change 574 (#574)",
  );
});

const comment = (id: string, author: string, createdAt: string) => ({ id, author, createdAt, body: id, url: `https://github.com/o/r/issues/571#${id}` });

test("new comments are the others' comments since the viewer last commented or opened the ticket", () => {
  const comments = [
    comment("c1", "claude", "2026-11-13T11:00:00Z"),
    comment("c2", "you", "2026-11-14T09:00:00Z"),
    comment("c3", "claude", "2026-11-14T10:00:00Z"),
    comment("c4", "you", "2026-11-14T10:30:00Z"),
    comment("c5", "review-bot", "2026-11-15T08:00:00Z"),
  ];
  assert.deepEqual(newComments(issue({ comments, commentCount: 5 })).map((c) => c.id), ["c5"]);
  // The viewer opened it and has not commented: every comment since is new.
  assert.deepEqual(newComments(issue({ comments: comments.filter((c) => c.author !== "you") })).map((c) => c.id), ["c1", "c3", "c5"]);
  // The viewer has never taken part: nothing counts as new.
  assert.deepEqual(newComments(issue({ author: "someone", comments: [comments[0]] })), []);
});

test("on arrival the view opens an open blocker, else a new comment, else nothing", () => {
  const fresh = [comment("c1", "claude", "2026-11-14T10:00:00Z")];
  assert.equal(issueArrivalCell(issue({ blockedBy: [blocker(569)], openBlockerCount: 1, comments: fresh })), "blocked-by");
  assert.equal(issueArrivalCell(issue({ blockedBy: [blocker(560, "CLOSED")], comments: fresh })), "comments");
  assert.equal(issueArrivalCell(issue()), null);
});

test("the cells are Blocked by, Comments, Pull request and Details, each with what it holds", () => {
  const cells = issueCells(
    issue({
      blockedBy: [blocker(569)],
      openBlockerCount: 1,
      comments: [comment("c1", "claude", "2026-11-14T10:00:00Z")],
      commentCount: 4,
      pullRequests: [pullRequest(574)],
      assignees: ["you", "claude"],
      labels: [{ name: "a" }, { name: "b" }],
    }),
  );
  assert.deepEqual(
    cells.map((c) => [c.id, c.label, c.value, c.tone]),
    [
      ["blocked-by", "Blocked by", "1 open", "alert"],
      ["comments", "Comments", "4 · 1 new", "attention"],
      ["pull-request", "Pull request", "#574 · checks failing", "attention"],
      ["details", "Details", "you, claude · 2 labels", "neutral"],
    ],
  );
  const quiet = issueCells(issue({ pullRequests: [pullRequest(560, "MERGED")] }));
  assert.deepEqual(
    quiet.map((c) => [c.value, c.tone]),
    [
      ["None open", "neutral"],
      ["0", "neutral"],
      ["#560 · merged", "neutral"],
      ["Unassigned · 1 label", "neutral"],
    ],
  );
  assert.equal(issueCells(issue())[2].value, "None");
});

test("the close button reads Close as its reason, or Close with comment once text is typed", () => {
  assert.equal(closeButtonLabel("COMPLETED", false), "Close as completed");
  assert.equal(closeButtonLabel("NOT_PLANNED", false), "Close as not planned");
  assert.equal(closeButtonLabel("DUPLICATE", false), "Close as duplicate");
  assert.equal(closeButtonLabel("NOT_PLANNED", true), "Close with comment");
});
