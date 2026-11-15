// Unit tests for reading terminal link signals (#637) from an agent's tool calls, a terminal's
// launch facts and its branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { branchSignals, branchTicket, launchSignals, toolCallActivity } from "./linkSignals.ts";

const call = (command: string, result = "", ok = true) => ({ command, result, ok });

test("gh pr create links the pull request whose URL its result prints", () => {
  const activity = toolCallActivity(
    call('git push -u origin ticket-637 && gh pr create --fill --base master', "Creating pull request\nhttps://github.com/seanrobertwright/Quay-2/pull/659\n"),
    500,
  );
  assert.deepEqual(activity.signals, [
    { slot: "pull_request", source: "activity", options: [{ repo: "seanrobertwright/Quay-2", number: 659 }], at: 500 },
  ]);
  assert.equal(activity.folder, null);
});

test("a pull request URL in any other command's result is never read", () => {
  const url = "https://github.com/seanrobertwright/Quay-2/pull/659";
  assert.deepEqual(toolCallActivity(call(`echo ${url}`, url), 1).signals, []);
  assert.deepEqual(toolCallActivity(call("gh pr list", `#659 ${url}`), 1).signals, []);
  assert.deepEqual(toolCallActivity(call("", url), 1).signals, []);
});

test("gh pr checkout N links that pull request, in the repository -R names", () => {
  assert.deepEqual(toolCallActivity(call("gh pr checkout 641"), 7).signals, [
    { slot: "pull_request", source: "activity", options: [{ repo: null, number: 641 }], at: 7 },
  ]);
  assert.deepEqual(toolCallActivity(call("gh pr checkout -R seanrobertwright/AI-WS-SDK 12"), 7).signals, [
    { slot: "pull_request", source: "activity", options: [{ repo: "seanrobertwright/AI-WS-SDK", number: 12 }], at: 7 },
  ]);
  assert.deepEqual(toolCallActivity(call("gh pr checkout https://github.com/seanrobertwright/Quay-2/pull/641"), 7).signals, [
    { slot: "pull_request", source: "activity", options: [{ repo: "seanrobertwright/Quay-2", number: 641 }], at: 7 },
  ]);
});

test("gh issue edit N --add-assignee links that ticket; other issue edits do not", () => {
  assert.deepEqual(toolCallActivity(call('gh issue edit 637 --add-assignee "@me"'), 7).signals, [
    { slot: "ticket", source: "activity", options: [{ repo: null, number: 637 }], at: 7 },
  ]);
  assert.deepEqual(toolCallActivity(call("gh issue edit 637 --add-label bug"), 7).signals, []);
  assert.deepEqual(toolCallActivity(call("gh issue edit --repo seanrobertwright/AI-WS-SDK 5 --add-assignee me"), 7).signals, [
    { slot: "ticket", source: "activity", options: [{ repo: "seanrobertwright/AI-WS-SDK", number: 5 }], at: 7 },
  ]);
});

test("a call that failed or was denied gives no signal", () => {
  assert.deepEqual(toolCallActivity(call("gh pr checkout 641", "no such pull request", false), 7).signals, []);
});

test("a number that is not a positive whole number is not read as a ticket", () => {
  assert.deepEqual(toolCallActivity(call("gh pr checkout 0"), 7).signals, []);
  assert.deepEqual(toolCallActivity(call("gh pr checkout feature-branch"), 7).signals, []);
  assert.deepEqual(toolCallActivity(call("gh issue edit 1e3 --add-assignee me"), 7).signals, []);
});

test("git worktree add moves the terminal's folder to the new worktree, with the branch -b names", () => {
  const added = toolCallActivity(call("git worktree add -b ticket-637 .wt/ticket-637 master"), 7);
  assert.equal(added.folder, ".wt/ticket-637");
  assert.equal(added.branch, "ticket-637");
  const existing = toolCallActivity(call('git -C "E:/Projects/Quay2" worktree add E:/Projects/Quay2/.wt/x feat/issue-12'), 7);
  assert.equal(existing.folder, "E:/Projects/Quay2/.wt/x");
  assert.equal(existing.branch, null, "a branch checked out, not created, is read from the worktree list");
});

test("cd moves the terminal's folder; the last move in a command line wins", () => {
  assert.equal(toolCallActivity(call('cd "E:/Projects/Quay2/.wt/ticket-637" && git status'), 7).folder, "E:/Projects/Quay2/.wt/ticket-637");
  assert.equal(toolCallActivity(call("cd a; cd b"), 7).folder, "b");
  assert.equal(toolCallActivity(call("cd"), 7).folder, null);
});

test("an Archon run gives its ticket input and the working path its result reports", () => {
  const run = toolCallActivity(
    call(
      'archon workflow run "seanrobertwright/lril-sdlc:implement" --cwd E:/Projects/Quay2 --input ticket="637" --input pr=true',
      'Run started\n{"run_id":"84a5","working_path":"C:/Users/me/.archon/worktrees/ticket-637"}',
    ),
    7,
  );
  assert.deepEqual(run.signals, [{ slot: "ticket", source: "activity", options: [{ repo: null, number: 637 }], at: 7 }]);
  assert.equal(run.folder, "C:/Users/me/.archon/worktrees/ticket-637");
  assert.deepEqual(toolCallActivity(call("archon workflow run x --input ticket=abc"), 7).signals, []);
});

test("a ticket-N or feat/issue-N branch names its ticket, and other branches name none", () => {
  assert.equal(branchTicket("ticket-637"), 637);
  assert.equal(branchTicket("feat/issue-12"), 12);
  assert.equal(branchTicket("master"), null);
  assert.equal(branchTicket("ticket-637-wip"), null);
  assert.equal(branchTicket("feat/issue-0"), null);
});

test("a branch gives its ticket and every open pull request whose head branch it is", () => {
  const prs = [
    { number: 658, headRefName: "ticket-636" },
    { number: 660, headRefName: "ticket-637" },
    { number: 661, headRefName: "ticket-637" },
  ];
  assert.deepEqual(branchSignals("ticket-637", prs, "branch", 9), [
    { slot: "ticket", source: "branch", options: [{ repo: null, number: 637 }], at: 9 },
    { slot: "pull_request", source: "branch", options: [{ repo: null, number: 660 }, { repo: null, number: 661 }], at: 9 },
  ]);
  assert.deepEqual(branchSignals("spike", prs, "activity", 9), [
    { slot: "pull_request", source: "activity", options: [], at: 9 },
  ]);
});

test("an Archon terminal's ticket input is a launch fact", () => {
  assert.deepEqual(
    launchSignals({ command_text: 'archon workflow run "x" --cwd "E:/p" --input ticket="637" --input pr="true"' }, 3),
    [{ slot: "ticket", source: "launch", options: [{ repo: null, number: 637 }], at: 3 }],
  );
  assert.deepEqual(launchSignals({ command_text: "npm run dev" }, 3), []);
  assert.deepEqual(launchSignals({ command_text: null, ticket: 12 }, 3), [
    { slot: "ticket", source: "launch", options: [{ repo: null, number: 12 }], at: 3 },
  ]);
});
