// Unit tests for the Link to... picker's choices (#637): guesses first, from the branch's number
// and recent pull requests, then search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkGuesses, searchLinkChoices } from "./linkChoices.ts";

const prs = [
  { number: 662, title: "Pie menu recognizer", headRefName: "ticket-640", closingIssues: [640] },
  { number: 661, title: "Terminal link", headRefName: "feat/link", closingIssues: [637] },
  { number: 660, title: "Readiness card", headRefName: "ticket-638", closingIssues: [] },
  { number: 659, title: "Status card", headRefName: "x", closingIssues: [] },
  { number: 658, title: "Chord table", headRefName: "y", closingIssues: [] },
  { number: 657, title: "Lane", headRefName: "z", closingIssues: [] },
];
const issues = [
  { number: 637, title: "Companion: terminal link with ticket and pull request slots" },
  { number: 641, title: "Pull request view" },
];

test("guesses list the branch's ticket and its pull requests first, then recent pull requests", () => {
  assert.deepEqual(
    linkGuesses("ticket-637", prs).map((c) => [c.slot, c.ref.number]),
    [
      ["ticket", 637],
      ["pull_request", 661],
      ["pull_request", 662],
      ["pull_request", 660],
      ["pull_request", 659],
      ["pull_request", 658],
    ],
  );
});

test("the branch's own pull request leads the recent ones, and with no branch only recent ones show", () => {
  assert.deepEqual(
    linkGuesses("ticket-638", prs).map((c) => [c.slot, c.ref.number]),
    [["ticket", 638], ["pull_request", 660], ["pull_request", 662], ["pull_request", 661], ["pull_request", 659], ["pull_request", 658]],
  );
  assert.deepEqual(linkGuesses(null, prs.slice(0, 2)).map((c) => c.ref.number), [662, 661]);
});

test("search by number offers that ticket and pull request, in any repository gh can read", () => {
  assert.deepEqual(
    searchLinkChoices("#12", prs, issues).map((c) => [c.slot, c.ref]),
    [["pull_request", { repo: null, number: 12 }], ["ticket", { repo: null, number: 12 }]],
  );
  assert.deepEqual(
    searchLinkChoices("someone/else#3", prs, issues).map((c) => [c.slot, c.ref]),
    [["pull_request", { repo: "someone/else", number: 3 }], ["ticket", { repo: "someone/else", number: 3 }]],
  );
});

test("search by words matches pull request and ticket titles, pull requests first", () => {
  assert.deepEqual(
    searchLinkChoices("terminal LINK", prs, issues).map((c) => [c.slot, c.ref.number, c.label]),
    [
      ["pull_request", 661, "Terminal link"],
      ["ticket", 637, "Companion: terminal link with ticket and pull request slots"],
    ],
  );
  assert.deepEqual(searchLinkChoices("   ", prs, issues), []);
});
