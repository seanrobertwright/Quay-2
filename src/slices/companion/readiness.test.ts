// The readiness card's headline, reason and control, from a pull request's state (#638).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PullRequestReadiness } from "../github/types.ts";
import { arrivalCell, commitMessageDefaults, DEFAULT_MERGE_METHOD, MERGE_METHODS, readiness, readinessCells } from "./readiness.ts";

const open = (over: Partial<PullRequestReadiness> = {}): PullRequestReadiness => ({
  repo: "o/r",
  number: 12,
  title: "Add the thing",
  body: "",
  url: "https://github.com/o/r/pull/12",
  state: "OPEN",
  isDraft: false,
  baseRefName: "master",
  headRefName: "ticket-12",
  headRefOid: "0123456789abcdef0123456789abcdef01234567",
  headBranchExists: true,
  isCrossRepository: false,
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  checks: { failing: 0, pending: 0, skipped: 0, passing: 4 },
  comments: { total: 2, unresolved: 0 },
  commits: 3,
  ...over,
});

test("a clean pull request with passing checks is Ready to merge, with merge enabled", () => {
  const r = readiness(open());
  assert.equal(r.tone, "ready");
  assert.equal(r.headline, "Ready to merge");
  assert.equal(r.reason, "All 4 checks passed.");
  assert.deepEqual(r.control, { kind: "merge", enabled: true });
});

test("a clean pull request with no checks says so", () => {
  assert.equal(readiness(open({ checks: { failing: 0, pending: 0, skipped: 0, passing: 0 } })).reason, "No checks ran on this branch.");
});

test("failing checks name their count, and block merging when GitHub blocks it", () => {
  const one = readiness(open({ mergeStateStatus: "BLOCKED", checks: { failing: 1, pending: 0, skipped: 0, passing: 3 } }));
  assert.equal(one.tone, "failing");
  assert.equal(one.headline, "1 check failing");
  assert.equal(one.reason, "Fix the failing check before merging.");
  assert.deepEqual(one.control, { kind: "merge", enabled: false });
  const two = readiness(open({ mergeStateStatus: "UNSTABLE", checks: { failing: 2, pending: 0, skipped: 0, passing: 3 } }));
  assert.equal(two.headline, "2 checks failing");
  assert.equal(two.reason, "No failing check is required, so it can still merge.");
  assert.deepEqual(two.control, { kind: "merge", enabled: true });
});

test("blocked states each give their own headline and reason, with merge disabled", () => {
  const cases: [Partial<PullRequestReadiness>, string, string][] = [
    [{ isDraft: true, mergeStateStatus: "DRAFT" }, "Draft", "Mark it ready for review on GitHub before it can merge."],
    [{ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }, "Merge conflicts", "ticket-12 has conflicts with master that must be resolved."],
    [{ mergeStateStatus: "BEHIND" }, "Branch out of date", "Update ticket-12 with master before merging."],
    [{ mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" }, "Changes requested", "A reviewer asked for changes."],
    [{ mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" }, "Review required", "An approving review is required before merging."],
    [{ mergeStateStatus: "BLOCKED" }, "Merging is blocked", "A branch protection rule blocks this merge."],
    [{ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }, "Checking mergeability", "GitHub is still working out whether this can merge."],
  ];
  for (const [over, headline, reason] of cases) {
    const r = readiness(open(over));
    assert.equal(r.tone, over.mergeable === "UNKNOWN" ? "pending" : "blocked", headline);
    assert.equal(r.headline, headline);
    assert.equal(r.reason, reason);
    assert.deepEqual(r.control, { kind: "merge", enabled: false }, headline);
  }
});

test("running checks are pending, and merging waits unless GitHub allows it", () => {
  const r = readiness(open({ mergeStateStatus: "BLOCKED", checks: { failing: 0, pending: 2, skipped: 0, passing: 1 } }));
  assert.equal(r.tone, "pending");
  assert.equal(r.headline, "Checks running");
  assert.equal(r.reason, "2 of 3 checks are still running.");
  assert.deepEqual(r.control, { kind: "merge", enabled: false });
});

test("a merged pull request offers Delete branch, or Restore branch once it is gone", () => {
  const merged = readiness(open({ state: "MERGED" }));
  assert.equal(merged.tone, "merged");
  assert.equal(merged.headline, "Merged");
  assert.equal(merged.reason, "ticket-12 was merged into master.");
  assert.deepEqual(merged.control, { kind: "branch", branch: "delete", reopen: false });
  assert.deepEqual(readiness(open({ state: "MERGED", headBranchExists: false })).control, { kind: "branch", branch: "restore", reopen: false });
});

test("a closed pull request is Closed without merging, with Reopen beside the branch button", () => {
  const closed = readiness(open({ state: "CLOSED" }));
  assert.equal(closed.tone, "closed");
  assert.equal(closed.headline, "Closed without merging");
  assert.equal(closed.reason, "ticket-12 was not merged into master.");
  assert.deepEqual(closed.control, { kind: "branch", branch: "delete", reopen: true });
  assert.deepEqual(readiness(open({ state: "CLOSED", headBranchExists: false })).control, { kind: "branch", branch: "restore", reopen: true });
});

test("a branch in a fork offers no branch button, since Quay cannot delete or restore it", () => {
  assert.deepEqual(readiness(open({ state: "MERGED", isCrossRepository: true })).control, { kind: "branch", branch: null, reopen: false });
});

test("the card's four cells are Checks, Comments, Files and Commits, each with a count and its bar's segments", () => {
  const cells = readinessCells(
    open({
      checks: { failing: 1, pending: 2, skipped: 0, passing: 5 },
      comments: { total: 6, unresolved: 2 },
      changedFiles: 3,
      additions: 120,
      deletions: 30,
      commits: 4,
    }),
  );
  assert.deepEqual(cells, [
    {
      id: "checks",
      label: "Checks",
      count: 8,
      segments: [
        { tone: "failing", label: "1 failing", value: 1 },
        { tone: "pending", label: "2 running", value: 2 },
        { tone: "passing", label: "5 passed", value: 5 },
      ],
    },
    {
      id: "comments",
      label: "Comments",
      count: 6,
      segments: [
        { tone: "pending", label: "2 unresolved", value: 2 },
        { tone: "neutral", label: "4 others", value: 4 },
      ],
    },
    {
      id: "files",
      label: "Files",
      count: 3,
      segments: [
        { tone: "passing", label: "+120", value: 120 },
        { tone: "failing", label: "−30", value: 30 },
      ],
    },
    { id: "commits", label: "Commits", count: 4, segments: [{ tone: "neutral", label: "4 commits", value: 4 }] },
  ]);
});

test("a cell with nothing to count has an empty bar", () => {
  const cells = readinessCells(open({ checks: { failing: 0, pending: 0, skipped: 0, passing: 0 }, comments: { total: 0, unresolved: 0 } }));
  assert.deepEqual(cells[0].segments, []);
  assert.deepEqual(cells[1].segments, []);
});

test("the confirm step's commit message follows the merge method, and rebase keeps each commit's own", () => {
  const pr = open({ title: "Add the thing", body: "Closes #5", number: 12, headRefName: "ticket-5" });
  assert.deepEqual(commitMessageDefaults(pr, "squash"), { title: "Add the thing (#12)", message: "Closes #5" });
  assert.deepEqual(commitMessageDefaults(pr, "merge"), { title: "Merge pull request #12 from ticket-5", message: "Add the thing" });
  assert.equal(commitMessageDefaults(pr, "rebase"), null);
});

test("the merge methods are listed merge commit, squash, rebase, with squash the default", () => {
  assert.deepEqual(MERGE_METHODS.map((m) => [m.method, m.label]), [
    ["merge", "Create a merge commit"],
    ["squash", "Squash and merge"],
    ["rebase", "Rebase and merge"],
  ]);
  assert.equal(DEFAULT_MERGE_METHOD, "squash");
});

test("on arrival a failing check opens, else an unresolved comment, else nothing", () => {
  const failingAndUnresolved = open({
    checks: { failing: 1, pending: 0, skipped: 0, passing: 3 },
    comments: { total: 2, unresolved: 1 },
  });
  assert.equal(arrivalCell(failingAndUnresolved), "checks");
  assert.equal(arrivalCell(open({ comments: { total: 2, unresolved: 1 } })), "comments");
  assert.equal(arrivalCell(open({ checks: { failing: 0, pending: 2, skipped: 1, passing: 1 } })), null);
  assert.equal(arrivalCell(open()), null);
});

test("a merged or closed pull request opens nothing on arrival, whatever its checks and comments", () => {
  const leftovers = { checks: { failing: 1, pending: 0, skipped: 0, passing: 0 }, comments: { total: 1, unresolved: 1 } };
  assert.equal(arrivalCell(open({ ...leftovers, state: "MERGED" })), null);
  assert.equal(arrivalCell(open({ ...leftovers, state: "CLOSED" })), null);
});
