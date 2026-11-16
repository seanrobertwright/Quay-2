// Unit tests for the Projects panel's ticket pipeline (#651): the lane a terminal row shows for its
// ticket, and the Ready to start and Blocked lists under the terminals.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PullRequestReadiness } from "../github/types.ts";
import type { LinkSlot, TerminalLink } from "../terminal/types.ts";
import { ticketLane, type LaneInput } from "./ticketLane.ts";

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);

const slot = (number: number, at: number, over: Partial<LinkSlot> = {}): LinkSlot => ({
  repo: null,
  number,
  source: "launch",
  pinned: false,
  at,
  ...over,
});

const link = (over: Partial<TerminalLink> = {}): TerminalLink => ({
  ticket: slot(651, NOW - 90 * MIN),
  pull_request: null,
  candidates: [],
  ...over,
});

const pr = (over: Partial<PullRequestReadiness> = {}): PullRequestReadiness => ({
  repo: "o/r",
  number: 574,
  title: "Lanes",
  body: "",
  url: "https://github.com/o/r/pull/574",
  state: "OPEN",
  isDraft: false,
  baseRefName: "master",
  headRefName: "ticket-651",
  headRefOid: "0123456789abcdef0123456789abcdef01234567",
  headBranchExists: true,
  isCrossRepository: false,
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  checks: { failing: 0, pending: 0, skipped: 0, passing: 4 },
  comments: { total: 0, unresolved: 0 },
  commits: 1,
  ...over,
});

const input = (over: Partial<LaneInput> = {}): LaneInput => ({
  link: link(),
  ticket: { title: "Projects panel: ticket pipeline lanes", assignee: "you", blocker: null },
  pullRequest: null,
  waiting: false,
  now: NOW,
  ...over,
});

const tones = (lane: NonNullable<ReturnType<typeof ticketLane>>) => lane.steps.map((s) => `${s.label}:${s.tone}`);

test("a terminal whose pull request is ready to merge shows the Pull request step, its state line and the Merge chip", () => {
  const lane = ticketLane(input({ link: link({ pull_request: slot(574, NOW - 5 * MIN, { state: "OPEN" }) }), pullRequest: pr() }));
  assert.ok(lane);
  assert.equal(lane.number, 651);
  assert.equal(lane.title, "Projects panel: ticket pipeline lanes");
  assert.deepEqual(tones(lane), ["Ticket:done", "Terminal:done", "Pull request:current", "Merged:todo"]);
  assert.equal(lane.stateLine, "PR #574 · checks passing · ready to merge");
  assert.equal(lane.needsYou, "Merge");
  assert.equal(lane.canMerge, true);
  assert.equal(lane.assignee, "you");
  assert.equal(lane.age, "5m");
});

test("a plain shell, with no ticket slot, has no lane", () => {
  assert.equal(ticketLane(input({ link: null })), null);
  assert.equal(ticketLane(input({ link: link({ ticket: null, pull_request: slot(574, NOW) }) })), null);
});

test("a merged pull request puts the lane in Merged even after the ticket leaves the open list", () => {
  // The slot last saw the pull request open; the read says it merged, and the ticket closed with it.
  const lane = ticketLane(
    input({
      link: link({ pull_request: slot(574, NOW - 3 * 60 * MIN, { state: "OPEN" }) }),
      ticket: null,
      pullRequest: pr({ state: "MERGED" }),
    }),
  );
  assert.ok(lane);
  assert.deepEqual(tones(lane), ["Ticket:done", "Terminal:done", "Pull request:done", "Merged:done"]);
  assert.equal(lane.stateLine, "PR #574 · merged");
  assert.equal(lane.title, "Ticket #651");
  assert.equal(lane.needsYou, null);
  assert.equal(lane.canMerge, false);
  assert.equal(lane.age, "3h");
});

test("a slot that last saw its pull request merged keeps Merged before any read", () => {
  const lane = ticketLane(input({ link: link({ pull_request: slot(574, NOW, { state: "MERGED" }) }) }));
  assert.equal(lane?.current, "merged");
});

test("a blocked ticket with no pull request names its blocker on a blocked Terminal step", () => {
  const lane = ticketLane(input({ ticket: { title: "Lanes", assignee: null, blocker: 650 } }));
  assert.ok(lane);
  assert.deepEqual(tones(lane), ["Ticket:done", "Terminal:blocked", "Pull request:todo", "Merged:todo"]);
  assert.equal(lane.blocker, 650);
  assert.equal(lane.stateLine, "Blocked by #650");
  assert.equal(lane.age, "1h");
});

test("failing checks colour the Pull request step and raise Failing; a waiting terminal raises Waiting first", () => {
  const failing = input({
    link: link({ pull_request: slot(574, NOW) }),
    pullRequest: pr({ mergeStateStatus: "BLOCKED", checks: { failing: 2, pending: 0, skipped: 0, passing: 2 } }),
  });
  const lane = ticketLane(failing);
  assert.equal(lane?.steps[2].tone, "failing");
  assert.equal(lane?.stateLine, "PR #574 · checks failing");
  assert.equal(lane?.needsYou, "Failing");
  assert.equal(lane?.canMerge, false);
  assert.equal(ticketLane({ ...failing, waiting: true })?.needsYou, "Waiting");
});

test("a pull request held by a review reads its readiness headline, with no Merge", () => {
  const lane = ticketLane(
    input({ link: link({ pull_request: slot(574, NOW) }), pullRequest: pr({ mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" }) }),
  );
  assert.equal(lane?.stateLine, "PR #574 · checks passing · review required");
  assert.equal(lane?.needsYou, null);
  assert.equal(lane?.canMerge, false);
});

test("a read of another pull request than the slot's is not used", () => {
  const lane = ticketLane(input({ link: link({ pull_request: slot(575, NOW) }), pullRequest: pr() }));
  assert.equal(lane?.stateLine, "PR #575");
  assert.equal(lane?.canMerge, false);
});
