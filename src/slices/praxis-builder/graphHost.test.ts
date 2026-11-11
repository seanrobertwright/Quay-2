/// <reference types="node" />
// The graph workflow host state model (#461): each of the seven states, their order, the
// candidate poll's start and stop, muting, and the missing-digest fallback. The host is the
// Tauri `invoke` boundary, faked; its records are the ones the real `praxis` printed
// (graph_outputs.fixture.json, recorded against the SDK's simulated host).
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createGraphHost, CANDIDATE_POLL_MS, GRAPH_STATE_ORDER, type GraphHost, type LocalGraphWorkflow } from "./graphHost.ts";
import { MUTED_AFTER_MS } from "./hostReadSession.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";
import { notPending, RECORDED_DIGEST, recordedStdout as stdout, withdrawnRecord } from "./fixtures/graphOutputs.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_790_000_000_000 }));
afterEach(() => mock.timers.reset());

const OTHER_DIGEST = `sha256:${"e".repeat(64)}`;
const SIGNED_IN: HostCondition = { state: "signedIn" };

type Revision = Record<string, unknown>;

/** When the recorded host took revisions 2 and 1, as the recorded `graphs show` lists them, newest first. */
const [SUBMITTED_2, SUBMITTED_1] = (stdout("graphs show").revisions as Revision[]).map((r) => r.submittedAt);

/** The recorded `graphs list`, holding `names`. */
function listRecord(names: string[], nextAfter: string | null = null): CallOutcome {
  const record = stdout("graphs list");
  const base = (record.workflows as Record<string, unknown>[])[0];
  record.workflows = names.map((name) => ({ ...base, name }));
  record.nextAfter = nextAfter;
  return { kind: "record", record };
}

/**
 * The recorded `graphs show` of `name` (two pending candidates, nothing admitted), changed as a
 * test needs: `revisions` replace its revisions, the rest its top-level fields.
 */
function showRecord(name: string, change: { revisions?: (rs: Revision[]) => Revision[]; [field: string]: unknown } = {}): CallOutcome {
  const record = stdout("graphs show");
  const { revisions, ...fields } = change;
  record.name = name;
  if (revisions) record.revisions = revisions(record.revisions as Revision[]);
  Object.assign(record, fields);
  return { kind: "record", record };
}

/** Revisions 1 and 2 of the recorded show with revision 1 `CURRENT` and 2 `status2`. */
const admittedOne = (status2: string) => (rs: Revision[]): Revision[] => [
  { ...rs[0], status: status2 },
  { ...rs[1], status: "CURRENT" },
];

/** An admitted, runnable revision 1 and nothing pending. */
const admitted = (name: string, extra: Record<string, unknown> = {}) =>
  showRecord(name, { revisions: admittedOne("WITHDRAWN"), currentRevision: 1, runnable: true, pendingCount: 0, admissionPageAddress: null, ...extra });

const notFound = (): CallOutcome => {
  const record = stdout("graphs show: not submitted");
  return { kind: "hostRefused", message: String(record.message), hostCode: String(record.hostCode), record };
};

interface Call {
  command: string;
  args: Record<string, unknown>;
  answer(outcome: CallOutcome): void;
  answered?: boolean;
}

/** An invoker whose `praxis` calls wait until the test answers them. */
function fakeHost() {
  const calls: Call[] = [];
  const cancelled: unknown[] = [];
  const invoker = (command: string, args: Record<string, unknown>) => {
    if (command === "praxis_host_cancel") {
      cancelled.push(args.callId);
      return Promise.resolve(undefined);
    }
    return new Promise<unknown>((resolve) => calls.push({ command, args, answer: resolve }));
  };
  const pending = () => calls.filter((c) => !c.answered);
  return {
    invoker,
    calls,
    cancelled,
    /** The calls not answered yet, as `list` or `show <name>`. */
    open: () => pending().map(label),
    /** Answers the oldest open call labelled `what`. */
    answer(what: string, outcome: CallOutcome) {
      const call = pending().find((c) => label(c) === what);
      assert.ok(call, `no open ${what} call; open: ${pending().map(label).join(", ")}`);
      call.answered = true;
      call.answer(outcome);
    },
  };
}
const label = (c: Call) =>
  c.command === "praxis_host_graphs_list"
    ? `list${c.args.after ? ` after ${String(c.args.after)}` : ""}`
    : c.command === "praxis_host_graph_show"
      ? `show ${String(c.args.name)}`
      : c.command === "praxis_host_graph_withdraw"
        ? `withdraw ${String(c.args.name)} ${String(c.args.revision)}`
        : c.command;

/** Lets settled calls' follow-ups run; setImmediate isn't mocked. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const local = (name: string, bundleDigest: string | null = RECORDED_DIGEST, nameProblem: string | null = null): LocalGraphWorkflow => ({
  name,
  bundleDigest,
  nameProblem,
});

function setup(workflows: LocalGraphWorkflow[], condition: HostCondition = SIGNED_IN) {
  const host = fakeHost();
  const graphs: GraphHost = createGraphHost({ projectPath: "C:/p", call: host.invoker });
  graphs.setLocal(workflows);
  graphs.setCondition(condition);
  return { host, graphs };
}

/** Shows the group, answers its `list` with `listed`, then each show with `shows`. */
async function readAll(host: ReturnType<typeof fakeHost>, graphs: GraphHost, listed: string[], shows: Record<string, CallOutcome> = {}) {
  void graphs.groupShown();
  await settle();
  host.answer("list", listRecord(listed));
  await settle();
  for (const [name, outcome] of Object.entries(shows)) {
    host.answer(`show ${name}`, outcome);
    await settle();
  }
}

test("a name the host refuses shows with its rule even offline, and is never sent to praxis", async () => {
  const { host, graphs } = setup([local("Ship_It", RECORDED_DIGEST, "the rule")], { state: "hostUnreachable" });
  assert.deepEqual(graphs.workflow("Ship_It").state, { kind: "nameRefused", rule: "the rule" });
  graphs.setCondition(SIGNED_IN);
  await readAll(host, graphs, ["Ship_It"]);
  void graphs.checkAgain("Ship_It");
  await settle();
  assert.deepEqual(host.open(), []);
  assert.deepEqual(graphs.workflow("Ship_It").state, { kind: "nameRefused", rule: "the rule" });
});

test("a graph workflow missing from the host's list is not submitted, and gets no show", async () => {
  const { host, graphs } = setup([local("ship")]);
  const listedAt = Date.now();
  await readAll(host, graphs, ["release-review"]);
  assert.deepEqual(host.open(), []);
  assert.deepEqual(graphs.workflow("ship").state, { kind: "notSubmitted" });
  assert.equal(graphs.workflow("ship").checkedAt, listedAt);
});

test("a show the host answers NOT_FOUND is not submitted", async () => {
  const { host, graphs } = setup([local("ship")]);
  void graphs.checkAgain("ship");
  await settle();
  host.answer("show ship", notFound());
  await settle();
  assert.deepEqual(graphs.workflow("ship").state, { kind: "notSubmitted" });
});

/** Reads `name` once with Check again, answered with `outcome`. */
async function checked(host: ReturnType<typeof fakeHost>, graphs: GraphHost, name: string, outcome: CallOutcome) {
  void graphs.checkAgain(name);
  await settle();
  host.answer(`show ${name}`, outcome);
  await settle();
  return graphs.workflow(name);
}

test("a retired graph workflow is retired, even with a candidate waiting", async () => {
  const { host, graphs } = setup([local("ship")]);
  const retired = admitted("ship", { state: "RETIRED", revisions: (rs: Revision[]) => [{ ...rs[0], status: "CANDIDATE" }, { ...rs[1], status: "RETIRED" }] });
  assert.deepEqual((await checked(host, graphs, "ship", retired)).state, { kind: "retired", revision: 1 });
});

test("a pending candidate is waiting for admission, as the newest candidate's revision, with its admission page", async () => {
  const { host, graphs } = setup([local("release-review")]);
  // The recorded show: revisions 1 and 2 are both candidates, and nothing is admitted.
  const view = await checked(host, graphs, "release-review", showRecord("release-review"));
  assert.deepEqual(view.state, { kind: "candidate", revision: 2 });
  assert.equal(view.admissionPageAddress, stdout("graphs show").admissionPageAddress);
  assert.match(String(view.admissionPageAddress), /#graph-workflow=release-review&revision=2$/);
});

test("a candidate outranks an admitted revision that differs from the saved files", async () => {
  const { host, graphs } = setup([local("ship", OTHER_DIGEST)]);
  const view = await checked(host, graphs, "ship", admitted("ship", { revisions: admittedOne("CANDIDATE"), pendingCount: 1 }));
  assert.deepEqual(view.state, { kind: "candidate", revision: 2 });
});

test("an admitted revision whose bundle digest isn't the saved files' differs from host", async () => {
  const { host, graphs } = setup([local("ship", OTHER_DIGEST)]);
  // Not runnable too, which ranks below differs.
  const view = await checked(host, graphs, "ship", admitted("ship", { runnable: false }));
  assert.deepEqual(view.state, { kind: "differs", revision: 1 });
});

test("an admitted revision the host can't run is admitted, not ready, with the host's reason", async () => {
  const { host, graphs } = setup([local("ship")]);
  const review = {
    reviewDigest: OTHER_DIGEST,
    computedAt: "2026-11-08T23:31:00.000Z",
    runnable: false,
    agents: [
      { nodeId: "build", agentId: "engine:local-coding", ready: false, readinessBinding: OTHER_DIGEST, reasons: ["The agent's command isn't installed."] },
      { nodeId: "check", agentId: "engine:local-coding", ready: true, readinessBinding: OTHER_DIGEST, reasons: [] },
    ],
  };
  const view = await checked(host, graphs, "ship", admitted("ship", { runnable: false, review }));
  assert.deepEqual(view.state, { kind: "notReady", revision: 1, reason: "build: The agent's command isn't installed." });
  // Without a review the host gives no reason, and says so.
  const bare = await checked(host, graphs, "ship", admitted("ship", { runnable: false, review: null }));
  assert.deepEqual(bare.state, { kind: "notReady", revision: 1, reason: "The host says this graph workflow can't run, and gave no reason." });
});

test("a runnable admitted revision with the saved files' digest is admitted, and a rejected or withdrawn candidate falls back to it", async () => {
  const { host, graphs } = setup([local("ship")]);
  for (const status of ["REJECTED", "WITHDRAWN", "ADMITTED"]) {
    const view = await checked(host, graphs, "ship", admitted("ship", { revisions: admittedOne(status) }));
    assert.deepEqual(view.state, { kind: "admitted", revision: 1 }, status);
  }
});

test("a graph workflow whose every candidate was rejected or withdrawn, with none admitted, is not submitted", async () => {
  const { host, graphs } = setup([local("release-review")]);
  const gone = showRecord("release-review", {
    revisions: (rs: Revision[]) => [{ ...rs[0], status: "WITHDRAWN" }, { ...rs[1], status: "REJECTED" }],
    pendingCount: 0,
    admissionPageAddress: null,
  });
  assert.deepEqual((await checked(host, graphs, "release-review", gone)).state, { kind: "notSubmitted" });
});

test("the seven states are ranked worst first, and each shows only when every worse one is ruled out", async () => {
  assert.deepEqual(GRAPH_STATE_ORDER, ["nameRefused", "notSubmitted", "retired", "candidate", "differs", "notReady", "admitted"]);
  const { host, graphs } = setup([local("ship", OTHER_DIGEST)]);
  // Every condition holds at first: retired, a candidate waiting, the files differ, not runnable.
  const conditions = { retired: true, candidate: true, differs: true, notReady: true };
  const shown: string[] = [];
  for (const peel of ["retired", "candidate", "differs", "notReady", null] as const) {
    graphs.setLocal([local("ship", conditions.differs ? OTHER_DIGEST : RECORDED_DIGEST)]);
    const view = await checked(
      host,
      graphs,
      "ship",
      admitted("ship", {
        state: conditions.retired ? "RETIRED" : "ACTIVE",
        revisions: admittedOne(conditions.candidate ? "CANDIDATE" : "REJECTED"),
        runnable: !conditions.notReady,
      }),
    );
    shown.push(view.state.kind);
    if (peel) conditions[peel] = false;
  }
  assert.deepEqual(shown, GRAPH_STATE_ORDER.slice(2));
  // The two worse ones: a name the host refuses beats everything, and not submitted the rest.
  graphs.setLocal([local("ship", OTHER_DIGEST, "the rule")]);
  assert.equal(graphs.workflow("ship").state.kind, "nameRefused");
  graphs.setLocal([local("ship", OTHER_DIGEST)]);
  assert.equal((await checked(host, graphs, "ship", notFound())).state.kind, "notSubmitted");
});

test("without either bundle digest there is no Differs, and the view gives the current revision and its submit time", async () => {
  // The host's revision carries no digest, as a CLI without one would print it.
  const { host, graphs } = setup([local("ship", OTHER_DIGEST)]);
  const noDigest = (rs: Revision[]) => admittedOne("WITHDRAWN")(rs).map(({ bundleDigest: _, ...r }) => r);
  const hostless = await checked(host, graphs, "ship", admitted("ship", { revisions: noDigest }));
  assert.deepEqual(hostless.state, { kind: "admitted", revision: 1 });
  assert.equal(hostless.compared, false);
  assert.deepEqual(hostless.current, { revision: 1, submittedAt: SUBMITTED_1 });
  // Quay can't compute the saved files' digest.
  graphs.setLocal([local("ship", null)]);
  const localless = await checked(host, graphs, "ship", admitted("ship", { runnable: false }));
  assert.equal(localless.state.kind, "notReady");
  assert.equal(localless.compared, false);
  // With both, the comparison is made.
  graphs.setLocal([local("ship")]);
  assert.equal(graphs.workflow("ship").compared, true);
});

test("the view lists the host's revisions newest first, each with its status and times, and marks the current one", async () => {
  const { host, graphs } = setup([local("ship")]);
  const view = await checked(host, graphs, "ship", admitted("ship", { revisions: admittedOne("REJECTED"), nextBefore: 1 }));
  assert.deepEqual(view.revisions, [
    { revision: 2, status: "REJECTED", bundleDigest: RECORDED_DIGEST, submittedAt: SUBMITTED_2, decidedAt: null, current: false },
    { revision: 1, status: "CURRENT", bundleDigest: RECORDED_DIGEST, submittedAt: SUBMITTED_1, decidedAt: null, current: true },
  ]);
  assert.equal(view.olderRevisions, true);
  // Before any show, and for a name the host refuses, there are none.
  graphs.setLocal([local("ship"), local("Other", RECORDED_DIGEST, "the rule")]);
  assert.deepEqual(graphs.workflow("Other").revisions, []);
  assert.deepEqual(graphs.workflow("never-read").revisions, []);
});

test("the first show of the group reads every list page, then shows each listed local graph workflow two at a time; Check host reads it all again", async () => {
  const { host, graphs } = setup([local("a"), local("b"), local("c"), local("not-there")]);
  void graphs.groupShown();
  await settle();
  assert.deepEqual(host.calls[0].args.limit, 100);
  host.answer("list", listRecord(["a", "b"], "b"));
  await settle();
  host.answer("list after b", listRecord(["c", "remote-only"]));
  await settle();
  assert.deepEqual(host.open(), ["show a", "show b"]);
  assert.equal(graphs.workflow("not-there").state.kind, "notSubmitted");
  host.answer("show a", admitted("a"));
  await settle();
  assert.deepEqual(host.open(), ["show b", "show c"]);
  host.answer("show b", admitted("b"));
  host.answer("show c", admitted("c"));
  await settle();
  assert.deepEqual(["a", "b", "c"].map((n) => graphs.workflow(n).state.kind), ["admitted", "admitted", "admitted"]);
  // Showing the group again reads nothing; Check host reads everything.
  void graphs.groupShown();
  await settle();
  assert.deepEqual(host.open(), []);
  void graphs.checkHost();
  await settle();
  assert.deepEqual(host.open(), ["list"]);
});

test("a reading turns muted after ten minutes, waking listeners, and a failing host condition drops every reading", async () => {
  const { host, graphs } = setup([local("ship")]);
  let wakes = 0;
  graphs.subscribe(() => (wakes += 1));
  assert.equal((await checked(host, graphs, "ship", admitted("ship"))).muted, false);
  const before = wakes;
  mock.timers.tick(MUTED_AFTER_MS - 1);
  assert.equal(graphs.workflow("ship").muted, false);
  mock.timers.tick(1);
  assert.equal(wakes, before + 1, "listeners are told when the reading turns muted");
  assert.deepEqual(graphs.workflow("ship"), { ...graphs.workflow("ship"), state: { kind: "admitted", revision: 1 }, muted: true });
  // Offline: the reading is dropped, not kept for later.
  graphs.setCondition({ state: "hostUnreachable" });
  assert.deepEqual(graphs.workflow("ship").state, { kind: "unknown", why: "host" });
  graphs.setCondition(SIGNED_IN);
  assert.deepEqual(graphs.workflow("ship").state, { kind: "unknown", why: "notChecked" });
  assert.deepEqual(graphs.workflow("ship").revisions, []);
});

test("an answer to a read asked before the host went offline is ignored", async () => {
  const { host, graphs } = setup([local("ship")]);
  void graphs.checkAgain("ship");
  await settle();
  graphs.setCondition({ state: "hostUnreachable" });
  graphs.setCondition(SIGNED_IN);
  host.answer("show ship", admitted("ship"));
  await settle();
  assert.deepEqual(graphs.workflow("ship").state, { kind: "unknown", why: "notChecked" });
});

const shows = (host: ReturnType<typeof fakeHost>) => host.calls.filter((c) => c.command === "praxis_host_graph_show").length;

test("while a form shows a pending candidate, it is read every 15 s, and the poll stops when the form leaves the screen", async () => {
  const { host, graphs } = setup([local("release-review")]);
  await checked(host, graphs, "release-review", showRecord("release-review"));
  graphs.watch("release-review");
  mock.timers.tick(CANDIDATE_POLL_MS - 1);
  await settle();
  assert.deepEqual(host.open(), []);
  mock.timers.tick(1);
  await settle();
  assert.deepEqual(host.open(), ["show release-review"]);
  host.answer("show release-review", showRecord("release-review"));
  await settle();
  // The next wait starts when the read ends.
  mock.timers.tick(CANDIDATE_POLL_MS);
  await settle();
  assert.deepEqual(host.open(), ["show release-review"]);
  host.answer("show release-review", showRecord("release-review"));
  await settle();
  const read = shows(host);
  graphs.watch(null);
  mock.timers.tick(10 * CANDIDATE_POLL_MS);
  await settle();
  assert.equal(shows(host), read, "no read after the form left the screen");
});

test("the candidate poll starts once a read finds a candidate, and stops once none is pending", async () => {
  const { host, graphs } = setup([local("ship")]);
  graphs.watch("ship");
  await checked(host, graphs, "ship", admitted("ship"));
  mock.timers.tick(CANDIDATE_POLL_MS);
  await settle();
  assert.deepEqual(host.open(), [], "an admitted graph workflow isn't polled");
  // A submit leaves a candidate, which the read after it finds.
  await checked(host, graphs, "ship", admitted("ship", { revisions: admittedOne("CANDIDATE") }));
  mock.timers.tick(CANDIDATE_POLL_MS);
  await settle();
  // The owner admits it in the browser.
  host.answer("show ship", admitted("ship", { revisions: (rs: Revision[]) => [{ ...rs[0], status: "CURRENT" }, { ...rs[1], status: "ADMITTED" }], currentRevision: 2 }));
  await settle();
  assert.deepEqual(graphs.workflow("ship").state, { kind: "admitted", revision: 2 });
  const read = shows(host);
  mock.timers.tick(10 * CANDIDATE_POLL_MS);
  await settle();
  assert.equal(shows(host), read);
});

test("only the graph workflow on screen is polled, and going offline or disposing stops it", async () => {
  const { host, graphs } = setup([local("release-review"), local("other")]);
  await checked(host, graphs, "release-review", showRecord("release-review"));
  await checked(host, graphs, "other", showRecord("other"));
  graphs.watch("other");
  mock.timers.tick(CANDIDATE_POLL_MS);
  await settle();
  assert.deepEqual(host.open(), ["show other"]);
  host.answer("show other", showRecord("other"));
  await settle();
  graphs.setCondition({ state: "hostUnreachable" });
  mock.timers.tick(10 * CANDIDATE_POLL_MS);
  await settle();
  assert.deepEqual(host.open(), []);
  graphs.setCondition(SIGNED_IN);
  await checked(host, graphs, "other", showRecord("other"));
  graphs.dispose();
  mock.timers.tick(10 * CANDIDATE_POLL_MS);
  await settle();
  assert.deepEqual(host.open(), []);
});

test("disposing cancels every praxis call in flight and keeps nothing", async () => {
  const { host, graphs } = setup([local("a"), local("b")]);
  void graphs.checkAgain("a");
  void graphs.checkAgain("b");
  await settle();
  graphs.dispose();
  assert.deepEqual(host.cancelled, host.calls.map((c) => c.args.callId));
  host.answer("show a", admitted("a"));
  await settle();
  assert.deepEqual(graphs.workflow("a").state, { kind: "unknown", why: "notChecked" });
});

test("withdrawing a pending candidate sends its revision, then rereads: the record falls back to its admitted revision and the candidate shows withdrawn", async () => {
  const { host, graphs } = setup([local("ship")]);
  await checked(host, graphs, "ship", admitted("ship", { revisions: admittedOne("CANDIDATE"), pendingCount: 1 }));
  assert.deepEqual(graphs.workflow("ship").state, { kind: "candidate", revision: 2 });
  const done = graphs.withdraw("ship", 2);
  await settle();
  assert.deepEqual(host.open(), ["withdraw ship 2"]);
  assert.equal(host.calls[host.calls.length - 1].args.requestId, null, "a first withdrawal resends nothing");
  host.answer("withdraw ship 2", withdrawnRecord("ship", 2));
  await settle();
  // The withdrawal is done once the reread after it is in.
  assert.deepEqual(host.open(), ["show ship"]);
  host.answer("show ship", admitted("ship", { revisions: admittedOne("WITHDRAWN") }));
  assert.deepEqual(await done, { kind: "done" });
  const view = graphs.workflow("ship");
  assert.deepEqual(view.state, { kind: "admitted", revision: 1 });
  assert.deepEqual(view.revisions.map((r) => [r.revision, r.status, r.current]), [[2, "WITHDRAWN", false], [1, "CURRENT", true]]);
});

test("a withdrawal the host refuses because the candidate is already decided says so, and rereads what the owner decided", async () => {
  const { host, graphs } = setup([local("ship")]);
  await checked(host, graphs, "ship", admitted("ship", { revisions: admittedOne("CANDIDATE"), pendingCount: 1 }));
  const done = graphs.withdraw("ship", 2);
  await settle();
  host.answer("withdraw ship 2", notPending());
  await settle();
  // The owner admitted revision 2 in the browser before the withdrawal reached the host.
  host.answer("show ship", admitted("ship", { revisions: (rs: Revision[]) => [{ ...rs[0], status: "CURRENT" }, { ...rs[1], status: "ADMITTED" }], currentRevision: 2 }));
  assert.deepEqual(await done, {
    kind: "refused",
    message: "The host refused to withdraw revision 2 of ship: it is no longer pending. The owner has admitted or rejected it, or it was withdrawn already. The host refused the request (REVISION_NOT_PENDING).",
  });
  assert.deepEqual(graphs.workflow("ship").state, { kind: "admitted", revision: 2 });
});

test("a withdrawal praxis couldn't confirm is unknown, and the next one resends its request id", async () => {
  const { host, graphs } = setup([local("ship")]);
  await checked(host, graphs, "ship", admitted("ship", { revisions: admittedOne("CANDIDATE"), pendingCount: 1 }));
  const requestId = "3f2c8a1e-5b7d-4e9a-8c6f-0d1e2a3b4c5d";
  const first = graphs.withdraw("ship", 2);
  // A second press while the first is in flight joins it.
  assert.equal(graphs.withdraw("ship", 2), first);
  await settle();
  host.answer("withdraw ship 2", { kind: "unknown", detail: "The host didn't confirm the request.", requestId });
  await settle();
  host.answer("show ship", admitted("ship", { revisions: admittedOne("CANDIDATE"), pendingCount: 1 }));
  assert.deepEqual(await first, {
    kind: "unknown",
    message: "Quay can't tell whether the host withdrew revision 2 of ship: The host didn't confirm the request. Pressing it again resends the same request.",
  });
  assert.equal(host.calls.filter((c) => c.command === "praxis_host_graph_withdraw").length, 1);
  const again = graphs.withdraw("ship", 2);
  await settle();
  assert.equal(host.calls[host.calls.length - 1].args.requestId, requestId);
  host.answer("withdraw ship 2", withdrawnRecord("ship", 2));
  await settle();
  host.answer("show ship", admitted("ship"));
  assert.deepEqual(await again, { kind: "done" });
});
