/// <reference types="node" />
// The ticket pipeline's reads of GitHub (#651): open tickets paged up to a cap, closed tickets since
// local midnight, and the signed-in login. GitHub is reached through Tauri's `invoke`, the
// out-of-process boundary this test fakes.
import { fakeInvoke } from "../../test-support/dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GithubIssue } from "../github/types.ts";
import { formatUtcTimestamp, startOfLocalDay } from "../../lib/dates.ts";

const { readRepoTickets, OPEN_TICKETS_READ_CAP, TICKETS_PAGE_SIZE } = await import("./pipelineReads.ts");

const issue = (number: number): GithubIssue => ({
  number,
  title: `Ticket ${number}`,
  state: "OPEN",
  labels: [],
  assignees: [],
  updatedAt: "2026-11-15T10:00:00Z",
  url: "",
  blockedBy: [],
  openBlockerCount: 0,
});

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);

test("open tickets are read a page at a time until GitHub has no more or the cap is reached", async () => {
  const calls: Record<string, unknown>[] = [];
  let n = 0;
  fakeInvoke(async (cmd, args) => {
    if (cmd === "get_github_viewer") return "you";
    if (cmd !== "list_github_issues") throw new Error(cmd);
    calls.push(args);
    if (args.state === "closed") return { items: [], endCursor: null, hasNextPage: false };
    // An endless list: every page full, always another after it.
    const items = Array.from({ length: Number(args.pageSize) }, () => issue(++n));
    return { items, endCursor: `c${n}`, hasNextPage: true };
  });
  const read = await readRepoTickets("E:/alpha", NOW);
  const open = calls.filter((c) => c.state === "open");
  assert.equal(open.length, OPEN_TICKETS_READ_CAP / TICKETS_PAGE_SIZE);
  assert.deepEqual(open.map((c) => c.after ?? null), [null, ...open.slice(1).map((_, i) => `c${(i + 1) * TICKETS_PAGE_SIZE}`)]);
  assert.equal(read.open.length, OPEN_TICKETS_READ_CAP);
  assert.equal(read.openComplete, false);
  assert.equal(read.viewer, "you");
  const closed = calls.filter((c) => c.state === "closed");
  assert.equal(closed.length, 1);
  assert.equal(closed[0].since, formatUtcTimestamp(startOfLocalDay(NOW)));
});

test("a list GitHub ends early is complete", async () => {
  fakeInvoke(async (cmd, args) => {
    if (cmd === "get_github_viewer") return null;
    if (args.state === "closed") return { items: [], endCursor: null, hasNextPage: false };
    return args.after ? { items: [issue(2)], endCursor: null, hasNextPage: false } : { items: [issue(1)], endCursor: "c1", hasNextPage: true };
  });
  const read = await readRepoTickets("E:/alpha", NOW);
  assert.deepEqual(read.open.map((i) => i.number), [1, 2]);
  assert.equal(read.openComplete, true);
  assert.equal(read.viewer, null);
});
