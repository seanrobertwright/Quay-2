// Unit tests for terminal link resolution (#637): given a terminal's link and a new signal, the
// slots that result. The rules come from the shell redesign spec's Terminal link subsection.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TerminalLink } from "../terminal/types.ts";
import { applyLinkSignal, applyPullRequestFacts, EMPTY_LINK, pinLink, unpinLink, type LinkContext } from "./terminalLink.ts";

const ctx: LinkContext = { ownRepo: "seanrobertwright/Quay-2", repos: ["seanrobertwright/Quay-2", "seanrobertwright/AI-WS-SDK"] };
const pr = (source: "launch" | "activity" | "branch", number: number, at: number, repo: string | null = null) =>
  ({ slot: "pull_request", source, options: [{ repo, number }], at }) as const;
const ticket = (source: "launch" | "activity" | "branch", number: number, at: number) =>
  ({ slot: "ticket", source, options: [{ repo: null, number }], at }) as const;

test("a signal fills an empty slot with the source that set it, unpinned", () => {
  const link = applyLinkSignal(EMPTY_LINK, pr("branch", 12, 100), ctx);
  assert.deepEqual(link.pull_request, { repo: null, number: 12, source: "branch", pinned: false, at: 100 });
  assert.equal(link.ticket, null);
});

test("a stronger source replaces a weaker one, and a weaker one never replaces a stronger one", () => {
  let link = applyLinkSignal(EMPTY_LINK, pr("branch", 12, 100), ctx);
  link = applyLinkSignal(link, pr("activity", 20, 200), ctx);
  assert.equal(link.pull_request?.number, 20);
  link = applyLinkSignal(link, pr("launch", 30, 300), ctx);
  assert.equal(link.pull_request?.number, 30);
  assert.equal(link.pull_request?.source, "launch");
  link = applyLinkSignal(link, pr("activity", 40, 400), ctx);
  link = applyLinkSignal(link, pr("branch", 50, 500), ctx);
  assert.equal(link.pull_request?.number, 30, "launch facts outrank agent activity and the branch");
});

test("a newer automatic signal at the same strength replaces an older one", () => {
  let link = applyLinkSignal(EMPTY_LINK, pr("activity", 20, 200), ctx);
  link = applyLinkSignal(link, pr("activity", 21, 300), ctx);
  assert.equal(link.pull_request?.number, 21);
});

test("the two slots fill independently", () => {
  let link = applyLinkSignal(EMPTY_LINK, ticket("launch", 637, 100), ctx);
  link = applyLinkSignal(link, pr("branch", 658, 200), ctx);
  assert.equal(link.ticket?.number, 637);
  assert.equal(link.ticket?.source, "launch");
  assert.equal(link.pull_request?.number, 658);
});

test("an automatic signal never replaces a pin", () => {
  const pinned: TerminalLink = {
    ...EMPTY_LINK,
    pull_request: { repo: null, number: 9, source: "pin", pinned: true, at: 50 },
  };
  const link = applyLinkSignal(pinned, pr("launch", 30, 300), ctx);
  assert.equal(link.pull_request?.number, 9);
  assert.equal(link.pull_request?.pinned, true);
});

test("two pull requests tied at one strength become candidates, and the slot stays as it was", () => {
  let link = applyLinkSignal(EMPTY_LINK, pr("branch", 12, 100), ctx);
  link = applyLinkSignal(
    link,
    { slot: "pull_request", source: "branch", options: [{ repo: null, number: 14 }, { repo: null, number: 15 }], at: 200 },
    ctx,
  );
  assert.equal(link.pull_request?.number, 12);
  assert.deepEqual(link.candidates, [
    { slot: "pull_request", source: "branch", options: [{ repo: null, number: 14 }, { repo: null, number: 15 }], at: 200 },
  ]);
  link = applyLinkSignal(link, pr("activity", 16, 300), ctx);
  assert.equal(link.pull_request?.number, 16);
  assert.deepEqual(link.candidates, [], "a signal that sets the slot settles the tie");
});

test("a tie at a weaker strength than the slot's source is not offered", () => {
  let link = applyLinkSignal(EMPTY_LINK, pr("activity", 20, 100), ctx);
  link = applyLinkSignal(
    link,
    { slot: "pull_request", source: "branch", options: [{ repo: null, number: 14 }, { repo: null, number: 15 }], at: 200 },
    ctx,
  );
  assert.deepEqual(link.candidates, []);
});

test("a signal for a repository that is neither the terminal's nor a Quay project's is ignored", () => {
  const link = applyLinkSignal(EMPTY_LINK, pr("activity", 5, 100, "someone/elsewhere"), ctx);
  assert.deepEqual(link, EMPTY_LINK);
  const project = applyLinkSignal(EMPTY_LINK, pr("activity", 5, 100, "SeanRobertWright/ai-ws-sdk"), ctx);
  assert.equal(project.pull_request?.repo, "SeanRobertWright/ai-ws-sdk", "a Quay project's repository counts, in any case");
});

test("a branch with no open pull request leaves a merged pull request in place", () => {
  const merged: TerminalLink = {
    ...EMPTY_LINK,
    pull_request: { repo: null, number: 658, source: "branch", pinned: false, at: 100, state: "MERGED" },
  };
  const link = applyLinkSignal(merged, { slot: "pull_request", source: "branch", options: [], at: 200 }, ctx);
  assert.equal(link.pull_request?.number, 658);
  assert.equal(link.pull_request?.state, "MERGED");
});

test("the same pull request named again keeps the state and closing tickets last seen", () => {
  const seen: TerminalLink = {
    ...EMPTY_LINK,
    pull_request: { repo: null, number: 658, source: "branch", pinned: false, at: 100, state: "OPEN", closes: [636] },
  };
  const link = applyLinkSignal(seen, pr("activity", 658, 200), ctx);
  assert.deepEqual(link.pull_request, {
    repo: null,
    number: 658,
    source: "activity",
    pinned: false,
    at: 200,
    state: "OPEN",
    closes: [636],
  });
});

test("a linked pull request's Closes #N fills the ticket slot at the pull request's strength", () => {
  const linked = applyLinkSignal(EMPTY_LINK, pr("activity", 658, 100), ctx);
  const link = applyPullRequestFacts(linked, { repo: null, number: 658, state: "OPEN", closes: [636, 640] }, 150);
  assert.equal(link.pull_request?.state, "OPEN");
  assert.deepEqual(link.pull_request?.closes, [636, 640], "a pull request that closes several tickets lists them all");
  assert.deepEqual(link.ticket, { repo: null, number: 636, source: "activity", pinned: false, at: 150 });
});

test("Closes #N never replaces a pinned ticket or one set by a stronger source", () => {
  const base = applyLinkSignal(EMPTY_LINK, pr("branch", 658, 100), ctx);
  const launched = applyLinkSignal(base, ticket("launch", 637, 110), ctx);
  const link = applyPullRequestFacts(launched, { repo: null, number: 658, state: "OPEN", closes: [636] }, 150);
  assert.equal(link.ticket?.number, 637);
  const pinned: TerminalLink = { ...base, ticket: { repo: null, number: 1, source: "pin", pinned: true, at: 1 } };
  assert.equal(applyPullRequestFacts(pinned, { repo: null, number: 658, state: "OPEN", closes: [636] }, 150).ticket?.number, 1);
});

test("a pinned pull request's Closes #N fills the ticket at the strongest automatic strength, never as a pin", () => {
  const pinned = pinLink(EMPTY_LINK, "pull_request", { repo: null, number: 658 }, 100);
  const link = applyPullRequestFacts(pinned, { repo: null, number: 658, state: "OPEN", closes: [636] }, 150);
  assert.deepEqual(link.ticket, { repo: null, number: 636, source: "launch", pinned: false, at: 150 });
  const relaunched = applyLinkSignal(link, ticket("launch", 637, 200), ctx);
  assert.equal(relaunched.ticket?.number, 637, "a newer launch fact replaces the derived ticket");
  const launched = applyLinkSignal(pinned, ticket("launch", 637, 110), ctx);
  const kept = applyPullRequestFacts(launched, { repo: null, number: 658, state: "OPEN", closes: [636] }, 150);
  assert.equal(kept.ticket?.number, 637, "a launch-set ticket is not overridden");
});

test("facts about another pull request than the linked one change nothing", () => {
  const linked = applyLinkSignal(EMPTY_LINK, pr("activity", 658, 100), ctx);
  assert.deepEqual(applyPullRequestFacts(linked, { repo: null, number: 7, state: "MERGED", closes: [6] }, 150), linked);
});

test("a pull request seen merged keeps its slot, with its state recorded", () => {
  const linked = applyLinkSignal(EMPTY_LINK, pr("activity", 658, 100), ctx);
  const link = applyPullRequestFacts(linked, { repo: null, number: 658, state: "MERGED", closes: [] }, 150);
  assert.equal(link.pull_request?.number, 658);
  assert.equal(link.pull_request?.state, "MERGED");
});

test("a ref in the terminal's own repository is recorded without a repository", () => {
  const link = applyLinkSignal(EMPTY_LINK, pr("activity", 658, 100, "SeanRobertWright/quay-2"), ctx);
  assert.equal(link.pull_request?.repo, null);
});

test("pinning sets the slot as a pin, clears its tie, and survives any automatic signal", () => {
  let link = applyLinkSignal(
    EMPTY_LINK,
    { slot: "pull_request", source: "branch", options: [{ repo: null, number: 14 }, { repo: null, number: 15 }], at: 100 },
    ctx,
  );
  link = pinLink(link, "pull_request", { repo: null, number: 15 }, 200);
  assert.deepEqual(link.pull_request, { repo: null, number: 15, source: "pin", pinned: true, at: 200 });
  assert.deepEqual(link.candidates, []);
  link = applyLinkSignal(link, pr("launch", 99, 300), ctx);
  assert.equal(link.pull_request?.number, 15);
});

test("a pin may point at a repository that is not a Quay project", () => {
  const link = pinLink(EMPTY_LINK, "ticket", { repo: "someone/elsewhere", number: 3 }, 100);
  assert.equal(link.ticket?.repo, "someone/elsewhere");
});

test("unpinning clears the slot, so the next automatic signal can fill it", () => {
  let link = pinLink(EMPTY_LINK, "ticket", { repo: null, number: 3 }, 100);
  link = unpinLink(link, "ticket");
  assert.equal(link.ticket, null);
  link = applyLinkSignal(link, ticket("branch", 637, 200), ctx);
  assert.equal(link.ticket?.number, 637);
});
