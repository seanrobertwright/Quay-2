/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  graphNeeded,
  planRefresh,
  RefreshQueue,
  RequestIds,
  tipOids,
  type Dirty,
  type RefreshPlan,
} from "./refreshTable.ts";
import type { GitRefs } from "./graphRefs.ts";

const clean: Dirty = { refs: false, head: false, index: false, worktree: false, operation: false };
const dirty = (bits: Partial<Dirty>): Dirty => ({ ...clean, ...bits });

const nothing: RefreshPlan = {
  status: false,
  diff: false,
  refs: false,
  banner: false,
  graph: "no",
  holdGraph: false,
};

test("worktree and index edits refetch the status and the open diff, never the graph", () => {
  assert.deepEqual(planRefresh(dirty({ worktree: true }), { inOperation: false, graphHeld: false }), {
    ...nothing,
    status: true,
    diff: true,
  });
  assert.deepEqual(planRefresh(dirty({ index: true }), { inOperation: false, graphHeld: false }), {
    ...nothing,
    status: true,
    diff: true,
  });
});

test("a HEAD move refetches refs and status, and the graph only if the new HEAD isn't loaded", () => {
  assert.deepEqual(planRefresh(dirty({ head: true }), { inOperation: false, graphHeld: false }), {
    ...nothing,
    refs: true,
    status: true,
    graph: "ifHeadNotLoaded",
  });
});

test("a ref change refetches refs, and the graph only if the tips changed", () => {
  assert.deepEqual(planRefresh(dirty({ refs: true }), { inOperation: false, graphHeld: false }), {
    ...nothing,
    refs: true,
    graph: "ifTipsChanged",
  });
  assert.equal(
    planRefresh(dirty({ refs: true, head: true }), { inOperation: false, graphHeld: false }).graph,
    "ifHeadNotLoadedOrTipsChanged"
  );
});

test("an operation refetches status and the banner; while it runs the graph waits, then runs once it ends", () => {
  assert.deepEqual(planRefresh(dirty({ operation: true }), { inOperation: true, graphHeld: false }), {
    ...nothing,
    status: true,
    banner: true,
  });
  // A rebase step moves HEAD and refs: HEAD and status refresh, the graph is held.
  assert.deepEqual(planRefresh(dirty({ refs: true, head: true }), { inOperation: true, graphHeld: false }), {
    ...nothing,
    refs: true,
    status: true,
    holdGraph: true,
  });
  // The operation ended: the held graph refresh runs whatever the tips say.
  assert.deepEqual(planRefresh(dirty({ operation: true }), { inOperation: false, graphHeld: true }), {
    ...nothing,
    status: true,
    banner: true,
    refs: true,
    graph: "yes",
  });
  // Nothing was held: ending an operation alone doesn't touch the graph.
  assert.equal(planRefresh(dirty({ operation: true }), { inOperation: false, graphHeld: false }).graph, "no");
});

test("a rescan dirties every bit and refreshes everything, the graph included", () => {
  const all = dirty({ refs: true, head: true, index: true, worktree: true, operation: true });
  assert.deepEqual(planRefresh(all, { inOperation: false, graphHeld: false }), {
    status: true,
    diff: true,
    refs: true,
    banner: true,
    graph: "yes",
    holdGraph: false,
  });
});

const refs = (tips: [string, "local" | "remote" | "tag"][], heads: string[] = []): GitRefs => ({
  refs: tips.map(([oid, kind], i) => ({ kind, name: `r${i}`, oid })),
  worktrees: heads.map((oid, i) => ({ path: `C:/wt${i}`, oid, branch: null })),
  tagOnlyCount: 0,
});

test("the tip set is every branch and remote tip and worktree HEAD, without tags", () => {
  assert.deepEqual(
    [...tipOids(refs([["a", "local"], ["b", "remote"], ["t", "tag"], ["a", "remote"]], ["h"]))].sort(),
    ["a", "b", "h"]
  );
});

test("whether the graph re-runs follows the plan's rule", () => {
  const before = tipOids(refs([["a", "local"]]));
  const moved = tipOids(refs([["b", "local"]]));
  const tagged = tipOids(refs([["a", "local"], ["v1", "tag"]]));
  const loaded = (oid: string) => oid === "a";
  const ask = (graph: RefreshPlan["graph"], after: Set<string>, headOid: string | null) =>
    graphNeeded(graph, { tipsBefore: before, tipsAfter: after, headOid, isLoaded: loaded });
  assert.equal(ask("no", moved, "b"), false);
  assert.equal(ask("yes", before, "a"), true);
  assert.equal(ask("ifTipsChanged", moved, "a"), true);
  assert.equal(ask("ifTipsChanged", tagged, "a"), false, "a tag on a loaded commit only adds a badge");
  assert.equal(ask("ifHeadNotLoaded", before, "a"), false, "HEAD moved onto a loaded row");
  assert.equal(ask("ifHeadNotLoaded", before, "c"), true, "HEAD moved to a commit the graph lacks");
  assert.equal(ask("ifHeadNotLoaded", before, null), false, "no HEAD to place");
  assert.equal(ask("ifHeadNotLoadedOrTipsChanged", moved, "a"), true);
  assert.equal(ask("ifHeadNotLoadedOrTipsChanged", before, "a"), false);
  assert.equal(
    graphNeeded("ifTipsChanged", { tipsBefore: null, tipsAfter: before, headOid: "a", isLoaded: loaded }),
    true,
    "with no tips to compare against, the graph re-runs"
  );
});

/** A refresh runner whose runs finish when the test says. */
function controlledRuns() {
  const runs: { dirty: Dirty; finish: () => void }[] = [];
  const queue = new RefreshQueue(
    (d) =>
      new Promise<void>((resolve) => {
        runs.push({ dirty: d, finish: resolve });
      })
  );
  return { runs, queue };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("one refresh runs at a time and changes during it queue exactly one follow-up", async () => {
  const { runs, queue } = controlledRuns();
  queue.request(dirty({ worktree: true }));
  assert.equal(runs.length, 1);
  queue.request(dirty({ refs: true }));
  queue.request(dirty({ head: true }));
  queue.request(dirty({ refs: true }));
  assert.equal(runs.length, 1, "nothing starts while a refresh runs");
  runs[0].finish();
  await tick();
  assert.equal(runs.length, 2, "one follow-up");
  assert.deepEqual(runs[1].dirty, dirty({ refs: true, head: true }), "carrying every bit dirtied meanwhile");
  runs[1].finish();
  await tick();
  assert.equal(runs.length, 2, "nothing more was asked for");
  queue.request(dirty({ index: true }));
  assert.equal(runs.length, 3, "an idle queue starts at once");
});

test("a failed refresh doesn't stop the next one", async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const queue = new RefreshQueue(
    async () => {
      calls++;
      throw new Error("git failed");
    },
    (e) => errors.push(e)
  );
  queue.request(dirty({ refs: true }));
  await tick();
  queue.request(dirty({ refs: true }));
  await tick();
  assert.equal(calls, 2);
  assert.equal(errors.length, 2, "each failure is reported");
});

test("only the newest request's answer counts", () => {
  const ids = new RequestIds();
  const first = ids.next();
  const second = ids.next();
  assert.equal(ids.isLatest(first), false, "an older response is dropped");
  assert.equal(ids.isLatest(second), true);
});
