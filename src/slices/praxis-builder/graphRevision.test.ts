/// <reference types="node" />
// Tests for the revision cache (#571): a revision of a graph workflow, read once with
// `praxis graphs show <name> --revision <n>` and kept, at most `REVISION_CACHE_SIZE` of them, the
// oldest dropped first. They fake only the runner's `invoke`, the out-of-process boundary, with the
// recorded revision (graph_outputs.fixture.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRevisionCache, REVISION_CACHE_SIZE } from "./graphRevision.ts";
import type { CallOutcome } from "./praxisHost.ts";
import { recordedStdout, revisionRecord } from "./fixtures/graphOutputs.ts";

const PROJECT = "C:/project";
const NAME = "release-train";

/** A runner that answers every revision read with `answer`, and lists the revision each asked for. */
function fakeRunner(answer: () => CallOutcome = () => ({ kind: "record", record: recordedStdout("graphs show: a revision") })) {
  const asked: unknown[] = [];
  const call = async (command: string, args: Record<string, unknown>) => {
    assert.equal(command, "praxis_host_graph_revision");
    asked.push([args.projectPath, args.name, args.revision]);
    return answer();
  };
  return { asked, call };
}

test("a revision is read from the host once, with the name and revision asked for, and its bundle's main graph is what it gives", async () => {
  const runner = fakeRunner();
  const cache = createRevisionCache({ call: runner.call });
  const first = await cache.read(PROJECT, NAME, 1);
  assert.equal(first.kind, "graph");
  assert.deepEqual(
    first.kind === "graph" ? first.graph.nodes.map((n) => n.id) : [],
    ["build", "test", "cooldown", "signoff", "package", "deploy", "end"],
  );
  assert.equal(await cache.read(PROJECT, NAME, 1), first, "the same read, from the cache");
  assert.deepEqual(runner.asked, [[PROJECT, NAME, 1]]);
});

test("reads of one revision in flight together share one host read", async () => {
  const runner = fakeRunner();
  const cache = createRevisionCache({ call: runner.call });
  const [a, b] = await Promise.all([cache.read(PROJECT, NAME, 1), cache.read(PROJECT, NAME, 1)]);
  assert.equal(a, b);
  assert.deepEqual(runner.asked, [[PROJECT, NAME, 1]]);
});

test("the cache keeps at most REVISION_CACHE_SIZE revisions, and drops the oldest for a new one", async () => {
  assert.equal(REVISION_CACHE_SIZE, 8);
  const runner = fakeRunner();
  const cache = createRevisionCache({ call: runner.call });
  for (const revision of [1, 2, 3, 4, 5, 6, 7, 8, 9]) await cache.read(PROJECT, NAME, revision);
  assert.equal(runner.asked.length, 9);
  // Revisions 2 to 9 are kept; 1, the oldest, was dropped for 9.
  for (const revision of [9, 8, 7, 6, 5, 4, 3, 2]) await cache.read(PROJECT, NAME, revision);
  assert.equal(runner.asked.length, 9, "revisions 2 to 9 are still kept");
  await cache.read(PROJECT, NAME, 1);
  assert.deepEqual(runner.asked.slice(9), [[PROJECT, NAME, 1]], "revision 1 was read again");
  // Keeping 1 again dropped 2, now the oldest, and kept 3.
  await cache.read(PROJECT, NAME, 3);
  await cache.read(PROJECT, NAME, 2);
  assert.deepEqual(runner.asked.slice(9), [
    [PROJECT, NAME, 1],
    [PROJECT, NAME, 2],
  ]);
});

test("each project, graph workflow and revision is its own entry", async () => {
  const runner = fakeRunner();
  const cache = createRevisionCache({ call: runner.call });
  await cache.read(PROJECT, NAME, 1);
  await cache.read(PROJECT, "nightly-build", 1);
  await cache.read("D:/other", NAME, 1);
  await cache.read(PROJECT, NAME, 2);
  assert.deepEqual(runner.asked, [
    [PROJECT, NAME, 1],
    [PROJECT, "nightly-build", 1],
    ["D:/other", NAME, 1],
    [PROJECT, NAME, 2],
  ]);
});

test("a failed read is never kept, so the next read asks the host again, in its words", async () => {
  let outcome: CallOutcome = { kind: "hostDown", message: "Nothing answered at https://127.0.0.1:7443; is it running?" };
  const runner = fakeRunner(() => outcome);
  const cache = createRevisionCache({ call: runner.call });
  assert.deepEqual(await cache.read(PROJECT, NAME, 1), { kind: "failed", problem: "Nothing answered at https://127.0.0.1:7443; is it running?" });
  outcome = { kind: "record", record: recordedStdout("graphs show: a revision") };
  assert.equal((await cache.read(PROJECT, NAME, 1)).kind, "graph");
  assert.equal((await cache.read(PROJECT, NAME, 1)).kind, "graph");
  assert.equal(runner.asked.length, 2);
});

test("a refusal before praxis runs is a failed read in the backend's words, and is never kept", async () => {
  const asked: unknown[] = [];
  const cache = createRevisionCache({
    call: async (_command, args) => {
      asked.push(args.revision);
      throw "A revision is a whole number from 1, not 0.";
    },
  });
  assert.deepEqual(await cache.read(PROJECT, NAME, 0), { kind: "failed", problem: "A revision is a whole number from 1, not 0." });
  await cache.read(PROJECT, NAME, 0);
  assert.deepEqual(asked, [0, 0]);
});

test("a revision whose graph can't be drawn is kept with the reason, since it never changes", async () => {
  const many = Array.from({ length: 1001 }, (_, n) => ({ id: `node-${n}`, kind: "TASK", dependsOn: [], config: {} }));
  for (const [record, reason] of [
    [revisionRecord(many), "Its graph has 1001 nodes, more than the 1000 the builder draws."],
    [revisionRecord([{ id: "a", kind: "TASK" }, { id: "a", kind: "END" }]), 'Its graph can\'t be drawn: More than one node has the id "a".'],
    [revisionRecord([], { graph: "none" }), "praxis gave it without a graph."],
  ] as const) {
    const runner = fakeRunner(() => record);
    const cache = createRevisionCache({ call: runner.call });
    assert.deepEqual(await cache.read(PROJECT, NAME, 1), { kind: "undrawn", reason });
    await cache.read(PROJECT, NAME, 1);
    assert.equal(runner.asked.length, 1, reason);
  }
});
