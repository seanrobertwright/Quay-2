import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createRunsList, type RunsList } from "./runsList.ts";
import type { CallOutcome } from "./praxisHost.ts";
import { runEntry as entry, runsRecord } from "./fixtures/runs.ts";

const PROJECT = "E:/work/app";
const NAME = "review-code";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 10, 1, 12, 0, 0) }));
afterEach(() => mock.timers.reset());

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

const runs = (entries: unknown[], extra: Record<string, unknown> = {}) => runsRecord(NAME, entries, extra);

/** A fake backend: each `praxis_host_runs` call waits until the test answers it. */
function fakeBackend() {
  const calls: { command: string; args: Record<string, unknown>; answer: (o: CallOutcome) => void }[] = [];
  const call = (command: string, args: Record<string, unknown>) =>
    new Promise<unknown>((resolve) => {
      calls.push({ command, args, answer: resolve });
      if (command === "praxis_host_cancel") resolve(undefined);
    });
  const reads = () => calls.filter((c) => c.command === "praxis_host_runs");
  const cancels = () => calls.filter((c) => c.command === "praxis_host_cancel").map((c) => c.args.callId);
  return { call, calls, reads, cancels };
}

let list: RunsList | null = null;
afterEach(() => {
  list?.dispose();
  list = null;
});

function start(backend: ReturnType<typeof fakeBackend>): RunsList {
  list = createRunsList({ projectPath: PROJECT, name: NAME, call: backend.call });
  list.set(true);
  return list;
}

test("on screen, the list reads the template's newest 20 runs and shows them in the host's order", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  assert.equal(backend.reads().length, 1);
  assert.deepEqual({ ...backend.reads()[0].args, callId: undefined }, { projectPath: PROJECT, name: NAME, limit: 20, callId: undefined });
  backend.reads()[0].answer(runs([entry(2), entry(1, { status: "SUCCEEDED", control: "CANCELED", held: true, revision: 2 })]));
  await settle();
  const view = runsList.view();
  assert.deepEqual(
    view.runs?.map((r) => [r.runId, r.workOrderId, r.status, r.stage, r.control, r.held, r.revision, r.createdAt]),
    [
      ["run-2", "wo-2", "RUNNING", "IMPLEMENTATION", "RUNNING", false, 3, Date.UTC(2026, 9, 25, 14, 0, 0)],
      ["run-1", "wo-1", "SUCCEEDED", "IMPLEMENTATION", "CANCELED", true, 2, Date.UTC(2026, 9, 25, 14, 0, 0)],
    ],
  );
  assert.equal(view.readAt, Date.UTC(2026, 10, 1, 12, 0, 0));
  assert.equal(view.dimmed, false);
});

test("the list is read again every 15 s while the host answers", async () => {
  const backend = fakeBackend();
  start(backend);
  await settle();
  backend.reads()[0].answer(runs([entry(1)]));
  await settle();
  mock.timers.tick(14_999);
  await settle();
  assert.equal(backend.reads().length, 1);
  mock.timers.tick(1);
  await settle();
  assert.equal(backend.reads().length, 2);
});

for (const down of [
  { kind: "hostDown", message: "Nothing answered at https://127.0.0.1:7443; is it running?" },
  { kind: "notSignedIn", message: "There is no CLI session for this host." },
  { kind: "expired", message: "The host did not accept the CLI session." },
] as CallOutcome[]) {
  test(`while the host can't be used (${down.kind}), the list is read every 60 s and the last list stays, dimmed, with its read time`, async () => {
    const backend = fakeBackend();
    const runsList = start(backend);
    await settle();
    backend.reads()[0].answer(runs([entry(1)]));
    await settle();
    const readAt = runsList.view().readAt;
    mock.timers.tick(15_000);
    await settle();
    backend.reads()[1].answer(down);
    await settle();
    const view = runsList.view();
    assert.deepEqual(view.runs?.map((r) => r.runId), ["run-1"]);
    assert.equal(view.dimmed, true);
    assert.equal(view.readAt, readAt);
    assert.equal(view.problem, "message" in down ? down.message : null);
    mock.timers.tick(59_999);
    await settle();
    assert.equal(backend.reads().length, 2);
    mock.timers.tick(1);
    await settle();
    assert.equal(backend.reads().length, 3);
    backend.reads()[2].answer(runs([entry(2), entry(1)]));
    await settle();
    assert.equal(runsList.view().dimmed, false);
    assert.equal(runsList.view().problem, null);
    assert.deepEqual(runsList.view().runs?.map((r) => r.runId), ["run-2", "run-1"]);
    mock.timers.tick(15_000);
    await settle();
    assert.equal(backend.reads().length, 4, "back to 15 s once the host answers");
  });
}

for (const failing of [
  { kind: "needsUpdate", detail: "unknown format aiws-workflow-runs/2" },
  { kind: "refused", message: "praxis refused the call." },
  { kind: "timedOut" },
  { kind: "record", record: { format: "aiws-workflow-runs/1", template: NAME } },
] as CallOutcome[]) {
  test(`a read that fails (${failing.kind === "record" ? "no runs array" : failing.kind}) keeps the list undimmed, says why, and reads again at 60 s`, async () => {
    const backend = fakeBackend();
    const runsList = start(backend);
    await settle();
    backend.reads()[0].answer(runs([entry(1)]));
    await settle();
    mock.timers.tick(15_000);
    await settle();
    backend.reads()[1].answer(failing);
    await settle();
    const view = runsList.view();
    assert.deepEqual(view.runs?.map((r) => r.runId), ["run-1"]);
    assert.equal(view.dimmed, false);
    assert.notEqual(view.problem, null);
    mock.timers.tick(59_999);
    await settle();
    assert.equal(backend.reads().length, 2);
    mock.timers.tick(1);
    await settle();
    assert.equal(backend.reads().length, 3);
  });
}

test("leaving the screen kills the read in flight and reads no more", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  const callId = backend.reads()[0].args.callId;
  runsList.set(false);
  assert.deepEqual(backend.cancels(), [callId]);
  backend.reads()[0].answer({ kind: "cancelled" });
  await settle();
  mock.timers.tick(600_000);
  await settle();
  assert.equal(backend.reads().length, 1);
  assert.equal(runsList.view().runs, null);
});

test("leaving the screen between reads clears the timer, and coming back reads at once", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  backend.reads()[0].answer(runs([entry(1)]));
  await settle();
  runsList.set(false);
  mock.timers.tick(600_000);
  await settle();
  assert.equal(backend.reads().length, 1);
  runsList.set(true);
  await settle();
  assert.equal(backend.reads().length, 2);
});

test("an answer that comes after a newer read was asked is dropped", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  runsList.showMore();
  await settle();
  assert.equal(backend.reads().length, 2);
  // The newer read answers first; the older one's late answer must not replace it.
  backend.reads()[1].answer(runs([entry(3), entry(2), entry(1)]));
  await settle();
  backend.reads()[0].answer(runs([entry(1)]));
  await settle();
  assert.deepEqual(runsList.view().runs?.map((r) => r.runId), ["run-3", "run-2", "run-1"]);
});

test("an answer that comes after the view left the screen is dropped", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  runsList.set(false);
  backend.reads()[0].answer(runs([entry(1)]));
  await settle();
  assert.equal(runsList.view().runs, null);
});

test("20 rows are shown; Show more raises the limit to 100, the most praxis lists, and says so", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  const twenty = Array.from({ length: 20 }, (_, i) => entry(100 - i));
  backend.reads()[0].answer(runs(twenty));
  await settle();
  assert.equal(runsList.view().runs?.length, 20);
  assert.equal(runsList.view().canShowMore, true);
  assert.equal(runsList.view().atCap, false);

  runsList.showMore();
  await settle();
  assert.equal(backend.reads()[1].args.limit, 100);
  backend.reads()[1].answer(runs(Array.from({ length: 100 }, (_, i) => entry(100 - i))));
  await settle();
  const view = runsList.view();
  assert.equal(view.runs?.length, 100);
  assert.equal(view.canShowMore, false);
  assert.equal(view.atCap, true);
  assert.equal(view.limit, 100);

  // The raised limit holds for the polls that follow.
  mock.timers.tick(15_000);
  await settle();
  assert.equal(backend.reads()[2].args.limit, 100);
});

test("a template with fewer runs than the limit offers no Show more", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  backend.reads()[0].answer(runs([entry(1)]));
  await settle();
  assert.equal(runsList.view().canShowMore, false);
  assert.equal(runsList.view().atCap, false);
});

test("fewer than 100 runs after Show more is not the cap", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  backend.reads()[0].answer(runs(Array.from({ length: 20 }, (_, i) => entry(i))));
  await settle();
  runsList.showMore();
  await settle();
  backend.reads()[1].answer(runs(Array.from({ length: 42 }, (_, i) => entry(i))));
  await settle();
  assert.equal(runsList.view().atCap, false);
  assert.equal(runsList.view().canShowMore, false);
});

test("a run waiting for a person (awaiting approval, or held) needs you; others don't", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  backend.reads()[0].answer(
    runs([
      entry(4, { status: "AWAITING_APPROVAL" }),
      entry(3, { held: true }),
      entry(2, { status: "SUCCEEDED" }),
      entry(1, { control: "PAUSED" }),
    ]),
  );
  await settle();
  assert.deepEqual(runsList.view().runs?.map((r) => [r.runId, r.needsYou]), [
    ["run-4", true],
    ["run-3", true],
    ["run-2", false],
    ["run-1", false],
  ]);
});

test("a simulated host's runs are marked as such", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  backend.reads()[0].answer(runs([entry(1)]));
  await settle();
  assert.equal(runsList.view().simulated, false);
  mock.timers.tick(15_000);
  await settle();
  backend.reads()[1].answer(runs([entry(1)], { simulatedIdentity: true }));
  await settle();
  assert.equal(runsList.view().simulated, true);
});

test("an entry the list can't read is left out, and a creation time it can't read is shown as written", async () => {
  const backend = fakeBackend();
  const runsList = start(backend);
  await settle();
  backend.reads()[0].answer(runs([entry(2, { createdAt: "yesterday" }), { runId: "run-x" }, entry(1)]));
  await settle();
  const rows = runsList.view().runs ?? [];
  assert.deepEqual(rows.map((r) => [r.runId, r.createdAt, r.createdAtText]), [
    ["run-2", null, "yesterday"],
    ["run-1", Date.UTC(2026, 9, 25, 14, 0, 0), "2026-10-25T14:00:00.000Z"],
  ]);
});

test("a run's page address comes from praxis status for its work order", async () => {
  const sent: [string, Record<string, unknown>][] = [];
  list = createRunsList({
    projectPath: PROJECT,
    name: NAME,
    call: async (command, args) => {
      sent.push([command, args]);
      return { kind: "record", record: { format: "coding-operator-view/1", runPageAddress: "https://127.0.0.1:7443/#/runs/wo-1" } };
    },
  });
  assert.deepEqual(await list.runPage("wo-1"), { address: "https://127.0.0.1:7443/#/runs/wo-1" });
  assert.equal(sent[0][0], "praxis_host_status");
  assert.equal(sent[0][1].workOrderId, "wo-1");
  assert.equal(sent[0][1].projectPath, PROJECT);
});

test("a run page lookup that fails says why", async () => {
  list = createRunsList({ projectPath: PROJECT, name: NAME, call: async () => ({ kind: "hostDown", message: "Nothing answered; is it running?" }) });
  assert.deepEqual(await list.runPage("wo-1"), { problem: "Nothing answered; is it running?" });
  list.dispose();
  list = createRunsList({ projectPath: PROJECT, name: NAME, call: async () => ({ kind: "record", record: { format: "coding-operator-view/1" } }) });
  assert.deepEqual(await list.runPage("wo-1"), { problem: "praxis gave no address for this run's page." });
});
