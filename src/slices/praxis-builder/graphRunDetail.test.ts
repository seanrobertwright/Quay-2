/// <reference types="node" />
// Component tests for a graph run's detail (#444, #465, #568, #569): its run-level facts and its
// node table, followed by polled `praxis status <wo> --format aiws-graph-operator-view/1`, with the
// template run detail's backoff, waiting banner and Trust certificate, and a hold panel per
// `aiws-graph-hold-card/1`.
// They render the real graph workflow form into happy-dom and fake only Tauri's `invoke`, the
// out-of-process boundary, and the terminal the window opens. Views are hand-made in the recorded
// view's shape, and the recorded views themselves (graph_outputs.fixture.json) are drawn too.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import type { CallOutcome } from "./praxisHost.ts";
import { BROWSER_ORIGIN, graphNodeView as node, graphOperatorView, graphRunEntry as entry, graphRunsRecord, statusRecord } from "./fixtures/runs.ts";
import { recordedStdout } from "./fixtures/graphOutputs.ts";
import { formatDateTime } from "../../lib/dates.ts";

const { GraphWorkflowForm } = await import("./GraphWorkflowForm.tsx");

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const PROJECT = "C:/project";
const NAME = "nightly-build";

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW }));
/** Unmounts the mounted form, if any, and removes its container. */
const unmount = () => {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
};

afterEach(() => {
  unmount();
  mock.timers.reset();
  setWindowVisible(true);
});

function setWindowVisible(visible: boolean): void {
  Object.defineProperty(document, "visibilityState", { value: visible ? "visible" : "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

interface Sent {
  command: string;
  args: Record<string, unknown>;
  answer: (value: unknown) => void;
}

/** The backend: the form's own reads answer at once; the runs list and graph status wait for the test. */
function fakeBackend() {
  const sent: Sent[] = [];
  fakeInvoke(
    (command, args) =>
      new Promise((resolve, reject) => {
        sent.push({ command, args, answer: resolve });
        switch (command) {
          case "praxis_validate":
            return resolve({ verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } });
          case "praxis_check_graph_workflow":
            return resolve({ grants: [], diagnostics: [] });
          case "praxis_graph_workflow_triggers":
            return resolve({ ids: [], unchecked: [] });
          case "praxis_host_graph_runs":
          case "praxis_host_graph_status":
            return;
          case "praxis_host_terminal_argv":
            return resolve(["node", "C:/sdk/engine/src/praxis.mjs", String(args.command)]);
          case "praxis_host_cancel":
          case "plugin:opener|open_url":
            return resolve(undefined);
          default:
            return reject(new Error(`unexpected invoke ${command}`));
        }
      }),
  );
  const of = (command: string) => sent.filter((s) => s.command === command);
  return {
    sent,
    lists: () => of("praxis_host_graph_runs"),
    statuses: () => of("praxis_host_graph_status"),
    cancels: () => of("praxis_host_cancel").map((s) => s.args.callId),
    opened: () => of("plugin:opener|open_url").map((s) => s.args.url),
    commands: () => sent.map((s) => s.command),
  };
}
type Backend = ReturnType<typeof fakeBackend>;

const terminals: { cwd: string; argv: string[] }[] = [];

function form(props: { shown?: boolean } = {}) {
  const ref = { kind: "graph-workflows" as const, id: NAME };
  const content = { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" };
  const draft = createDraft(ref, { id: NAME, kind: "graph-workflows", missing: false, content, contentHash: "h" });
  assert.ok(draft.ok);
  return createElement(GraphWorkflowForm, {
    projectPath: PROJECT,
    draft: draft.value,
    contracts: ["c"],
    graphs: ["g"],
    graphBindings: [{ id: "g-1", graphId: "g" }],
    refresh: 0,
    onEdit: () => {},
    onOpen: () => {},
    onValidated: () => {},
    runsShown: props.shown ?? true,
    runInTerminal: async (cwd: string, argv: string[]) => {
      terminals.push({ cwd, argv });
      return true;
    },
  });
}

async function render(element: ReturnType<typeof form>): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(element));
  return container;
}

const rerender = (element: ReturnType<typeof form>) => act(async () => mounted?.root.render(element));
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const buttons = (root: Element) => [...root.querySelectorAll("button")];
const button = (root: Element, name: RegExp) =>
  buttons(root).find((b) => name.test(b.getAttribute("aria-label") ?? text(b))) as HTMLButtonElement | undefined;
const click = (el: HTMLElement | undefined) => act(async () => el?.click());
const flush = () => act(async () => {});
const tick = (ms: number) => act(async () => mock.timers.tick(ms));
const answer = (s: Sent, outcome: CallOutcome) => act(async () => s.answer(outcome));

/** Opens Runs, lists `rows`, and shows run `n`'s detail. */
async function showRun(backend: Backend, n = 1, rows: unknown[] = [entry(n)]): Promise<HTMLElement> {
  const root = await render(form());
  await click(button(root, /^Runs$/));
  await answer(backend.lists()[0], graphRunsRecord(NAME, rows));
  await click(button(root, new RegExp(`^Show run-${n}$`)));
  return root;
}

const detail = (root: HTMLElement) => root.querySelector('[aria-label^="Run run-"]') as HTMLElement | null;
const header = (root: HTMLElement) => detail(root)?.querySelector("header") as HTMLElement;
/** The value of the detail's fact named `term`. */
const fact = (root: HTMLElement, term: string) => {
  const dt = [...(detail(root)?.querySelectorAll("dt") ?? [])].find((d) => text(d) === term);
  return text(dt?.nextElementSibling);
};
const banner = (root: HTMLElement) => detail(root)?.querySelector('[aria-label="Waiting for a decision"]') as HTMLElement | null;
const panels = (root: HTMLElement) => [...(detail(root)?.querySelectorAll('[role="region"]') ?? [])].filter((r) => /^Held:/.test(text(r))) as HTMLElement[];
/** The ways out of the hold `panel` lists, in its words. */
const exitsOf = (panel: HTMLElement) => [...panel.querySelectorAll('[aria-label="Ways out of the hold"] li')].map((li) => text(li));

/**
 * A hold card as `aiws-graph-hold-card/1` gives it, shaped like the recorded held run's: node
 * `nodeId` held for `reason` after an attempt that took effect, with `extra` replacing its fields.
 */
const holdCard = (holdId: string, nodeId: string, reason: string, extra: Record<string, unknown> = {}) => ({
  format: "aiws-graph-hold-card/1",
  holdId,
  scopeId: `node:wo-1/${nodeId}`,
  runId: "run-1",
  nodeId,
  reason,
  cause: null,
  operationId: `op:att-${holdId}`,
  attemptId: `att-${holdId}`,
  effect: "CONFIRMED_APPLIED",
  attempts: 1,
  maxAttempts: 3,
  exits: ["RELEASE_AND_REATTEMPT"],
  subjectDigest: "d".repeat(64),
  ...extra,
});
const holdDecision = (holdId: string, nodeId: string) => ({ key: `HOLD_DECISION:${holdId}`, kind: "HOLD_DECISION", holdId, nodeId });
/** The pending reconciliation of hold `holdId`'s UNKNOWN attempt. */
const reconciliation = (holdId: string) => ({ key: `RECONCILIATION:${holdId}`, kind: "RECONCILIATION", attemptId: `att-${holdId}`, holdId });

const RELEASE = "Release and re-attempt: Runs the node again as a new operation, once the host proves its workspace is safe.";

test("the recorded run awaiting approval is READY, with its control and Awaiting approval, and the banner names the run's approval", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  const view = recordedStdout("status: awaiting approval");
  await answer(backend.statuses()[0], statusRecord(view));
  assert.equal(text(header(root).querySelector("h3")), view.runId, "the run as praxis named it");
  assert.match(text(header(root)), /READY/);
  assert.equal(text(header(root).querySelector('[data-chip="control"]')), "RUNNING");
  assert.match(text(header(root)), /Awaiting approval/);
  assert.doesNotMatch(text(header(root)), /Held|SUCCEEDED/, "neither held nor ended");
  assert.match(text(header(root)), /Simulated/, "the recorded host is simulated");
  assert.match(text(banner(root)), /This run waits for the run's approval, decided in the browser\./);
  assert.equal(panels(root).length, 0);
});

test("the recorded completed run shows its status with its outcome and is no longer read", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(recordedStdout("status: completed, not succeeded")));
  assert.match(text(header(root)), /COMPLETED\s*NOT_SUCCEEDED/);
  assert.equal(text(header(root).querySelector('[data-chip="control"]')), "RUNNING");
  assert.doesNotMatch(text(header(root)), /Held|Awaiting approval/);
  assert.equal(banner(root), null, "it waits for no decision");
  await tick(10 * 60_000);
  assert.equal(backend.statuses().length, 1);
  assert.match(text(detail(root)), /The run has ended, so it is no longer read/);
});

test("the recorded held run is RUNNING and Held, with a hold panel drawn from its aiws-graph-hold-card/1 in place of the banner", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true })]);
  const view = recordedStdout("status: held");
  assert.deepEqual((view.holds as Record<string, unknown>[]).map((card) => card.format), ["aiws-graph-hold-card/1"]);
  await answer(backend.statuses()[0], statusRecord(view));
  assert.match(text(header(root)), /RUNNING/);
  assert.equal(text(header(root).querySelector('[data-chip="control"]')), "RUNNING");
  assert.match(text(header(root)), /Held/);
  assert.doesNotMatch(text(header(root)), /Awaiting approval|SUCCEEDED/);
  const [panel] = panels(root);
  assert.equal(panels(root).length, 1);
  assert.match(text(panel), /^Held: EXECUTION_FAILED on node build/);
  assert.doesNotMatch(text(panel), /Cause:/, "the card has no cause");
  assert.match(text(panel), /Effect: CONFIRMED_APPLIED/);
  assert.match(text(panel), /Attempts: 1 of 2/);
  assert.deepEqual(exitsOf(panel), [RELEASE]);
  assert.equal(banner(root), null, "the hold panel stands in for the waiting banner");
  assert.deepEqual(buttons(panel).map((b) => text(b)), ["Resolve in browser"], "the exits are words, never controls");
});

test("showing a run reads the graph run status verb for its work order and shows its run-level facts", async () => {
  const backend = fakeBackend();
  const row = entry(1, { workflowRevision: 4, createdAt: "2026-11-08T09:30:00.000Z", updatedAt: "2026-11-08T09:45:00.000Z" });
  const root = await showRun(backend, 1, [row]);
  assert.equal(backend.statuses().length, 1);
  assert.equal(backend.statuses()[0].args.workOrderId, "wo-1");
  assert.equal(backend.statuses()[0].args.projectPath, PROJECT);
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { status: "RUNNING", control: { status: "PAUSED", reason: null } })));
  assert.match(text(header(root)), /RUNNING/);
  assert.equal(text(header(root).querySelector('[data-chip="control"]')), "PAUSED");
  assert.match(text(header(root)), /revision 4/);
  assert.doesNotMatch(text(header(root)), /Held|Awaiting approval/);
  assert.equal(fact(root, "Created"), formatDateTime(Date.UTC(2026, 10, 8, 9, 30)));
  assert.equal(fact(root, "Updated"), formatDateTime(Date.UTC(2026, 10, 8, 9, 45)));
  assert.equal(root.querySelector("canvas, .react-flow, [data-graph-canvas]"), null, "the detail draws no graph");
});

/** Asserts no status read follows within `ms - 1`, and one does at `ms`; answers it with `outcome`. */
async function nextReadAfter(backend: Backend, ms: number, outcome: CallOutcome): Promise<void> {
  const before = backend.statuses().length;
  await tick(ms - 1);
  assert.equal(backend.statuses().length, before, `no read before ${ms} ms`);
  await tick(1);
  assert.equal(backend.statuses().length, before + 1, `a read at ${ms} ms`);
  await answer(backend.statuses()[before], outcome);
}

/** A running run whose change token is `n`, waiting for nothing. */
const working = (n: number, extra: Record<string, unknown> = {}) => statusRecord(graphOperatorView(1, { changeToken: String(n).repeat(64), ...extra }));
const HOST_DOWN: CallOutcome = { kind: "hostDown", message: "Nothing answered at https://127.0.0.1:7443; is it running?" };

test("a run is read every 3 s while its change token moves, doubling to 15 s while it doesn't, and every 60 s while the host is down", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], working(0));
  await nextReadAfter(backend, 3_000, working(1));
  await nextReadAfter(backend, 3_000, working(1));
  await nextReadAfter(backend, 6_000, working(1));
  await nextReadAfter(backend, 12_000, working(1));
  await nextReadAfter(backend, 15_000, working(1));
  await nextReadAfter(backend, 15_000, HOST_DOWN);
  assert.match(text(detail(root)), /The host can't be used, so this run may be out of date/);
  await nextReadAfter(backend, 60_000, HOST_DOWN);
  await nextReadAfter(backend, 60_000, working(2));
  await nextReadAfter(backend, 3_000, working(2));
  await nextReadAfter(backend, 6_000, working(2));
  // Every read went to the graph run status verb: never the template's, never follow.
  assert.ok(backend.commands().every((c) => c !== "praxis_host_status" && c !== "praxis_host_follow"));
  assert.ok(backend.statuses().every((s) => s.args.workOrderId === "wo-1"));
});

test("a held or awaiting run is read every 15 s straight away", async () => {
  for (const extra of [
    { status: "READY", pending: [{ key: "RUN_APPROVAL", kind: "RUN_APPROVAL" }] },
    { pending: [holdDecision("hold-1", "build")], holds: [holdCard("hold-1", "build", "EXECUTION_FAILED")] },
    { pending: [reconciliation("hold-2")] },
    { pending: [{ key: "HUMAN_TASK:task-1", kind: "HUMAN_TASK", taskId: "task-1", nodeId: "review" }] },
    { control: { status: "PAUSED", reason: null }, pending: [{ key: "RESUME_CONTROL", kind: "RESUME_CONTROL" }] },
  ]) {
    const backend = fakeBackend();
    await showRun(backend);
    await answer(backend.statuses()[0], working(0));
    await nextReadAfter(backend, 3_000, working(1, extra));
    await nextReadAfter(backend, 15_000, working(1, extra));
    await nextReadAfter(backend, 15_000, working(1, extra));
    unmount();
  }
});

test("an ended run is no longer read", async () => {
  for (const extra of [
    { status: "COMPLETED", outcome: "SUCCEEDED" },
    { status: "COMPLETED", outcome: "NOT_SUCCEEDED" },
    { status: "FAILED", outcome: "NOT_SUCCEEDED" },
    { status: "CANCELED", outcome: "NOT_SUCCEEDED", control: { status: "CANCELED", reason: null } },
  ]) {
    const backend = fakeBackend();
    const root = await showRun(backend);
    await answer(backend.statuses()[0], working(0, extra));
    await tick(10 * 60_000);
    assert.equal(backend.statuses().length, 1, JSON.stringify(extra));
    assert.match(text(detail(root)), /The run has ended, so it is no longer read/);
    assert.match(text(header(root)), new RegExp(`${extra.status}.*${extra.outcome}`), "the status shows with its outcome");
    unmount();
  }
});

test("a run that is cancelling is still read", async () => {
  const backend = fakeBackend();
  await showRun(backend);
  await answer(backend.statuses()[0], working(0, { status: "CANCELING", control: { status: "CANCEL_PENDING", reason: null } }));
  await nextReadAfter(backend, 3_000, working(0, { status: "CANCELING", control: { status: "CANCEL_PENDING", reason: null } }));
});

/** Shows run 1, answers its first read, and returns the call id of the next read, left in flight. */
async function following(backend: Backend): Promise<{ root: HTMLElement; callId: unknown }> {
  const root = await showRun(backend);
  await answer(backend.statuses()[0], working(0));
  await tick(3_000);
  assert.equal(backend.statuses().length, 2);
  return { root, callId: backend.statuses()[1].args.callId };
}

/** Asserts status call `callId` was cancelled and no status read follows. */
async function stopped(backend: Backend, callId: unknown): Promise<void> {
  assert.ok(backend.cancels().includes(callId), "its praxis call is killed");
  const before = backend.statuses().length;
  await tick(10 * 60_000);
  assert.equal(backend.statuses().length, before, "no status read follows");
}

test("leaving the view stops the followed run and kills its call", async () => {
  const leave: [string, (root: HTMLElement) => Promise<void>][] = [
    ["Workflow switch", (root) => click(button(root, /^Workflow$/))],
    ["builder hidden", async () => void (await rerender(form({ shown: false })))],
    ["window hidden", () => act(async () => setWindowVisible(false))],
    ["detail closed", (root) => click(button(root, /^Close run-1$/))],
    ["Show pressed again", (root) => click(button(root, /^Show run-1$/))],
  ];
  for (const [why, go] of leave) {
    const backend = fakeBackend();
    const { root, callId } = await following(backend);
    await go(root);
    await stopped(backend, callId).catch((e) => assert.fail(`${why}: ${e}`));
    unmount();
    setWindowVisible(true);
  }
});

test("unmounting the form stops the followed run, kills its call and leaves no timer", async () => {
  const backend = fakeBackend();
  const { callId } = await following(backend);
  await act(async () => mounted?.root.unmount());
  mounted?.container.remove();
  mounted = null;
  await stopped(backend, callId);
});

/** A run awaiting its approval, as the recorded `status: awaiting approval` case reads. */
const awaiting = (extra: Record<string, unknown> = {}) =>
  graphOperatorView(1, { status: "READY", pending: [{ key: "RUN_APPROVAL", kind: "RUN_APPROVAL" }], ...extra });

test("a run awaiting approval gets the Awaiting approval chip and the waiting banner, whose Open in browser opens the run page", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { status: "AWAITING_APPROVAL", awaitingApproval: true, runPageAddress: undefined })]);
  await answer(backend.statuses()[0], statusRecord(awaiting()));
  assert.match(text(header(root)), /READY/);
  assert.match(text(header(root)), /Awaiting approval/);
  assert.match(text(banner(root)), /This run waits for the run's approval, decided in the browser\./);
  await click(button(header(root), /^Open in browser for run-1$/));
  await flush();
  await click(button(banner(root) as HTMLElement, /^Open in browser for run-1$/));
  await flush();
  assert.deepEqual(backend.opened(), [`${BROWSER_ORIGIN}/#work-order=wo-1`, `${BROWSER_ORIGIN}/#work-order=wo-1`]);
  assert.equal(backend.statuses().length, 1, "the address came from the followed read");
});

test("the banner names each decision the run waits for, oldest first", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(
    backend.statuses()[0],
    statusRecord(
      graphOperatorView(1, {
        control: { status: "PAUSED", reason: null },
        pending: [
          { key: "NODE_APPROVAL:deploy", kind: "NODE_APPROVAL", nodeId: "deploy" },
          { key: "NODE_ACCEPTANCE:review", kind: "NODE_ACCEPTANCE", nodeId: "review" },
          { key: "HUMAN_TASK:task-1", kind: "HUMAN_TASK", taskId: "task-1", nodeId: "check" },
          { key: "RESUME_CONTROL", kind: "RESUME_CONTROL" },
          { key: "SOMETHING_NEW", kind: "SOMETHING_NEW" },
        ],
      }),
    ),
  );
  assert.match(
    text(banner(root)),
    /waits for approval of node deploy, acceptance of node review, a human task of node check, resuming: the run is paused, decided in the browser/,
  );
  assert.doesNotMatch(text(header(root)), /Awaiting approval/, "only the run's own approval is Awaiting approval");
});

test("Open in browser opens a page on 127.0.0.1 too, and refuses any other address, saying so", async () => {
  for (const [address, opens] of [
    ["https://127.0.0.1:7443/#work-order=wo-1", true],
    ["https://praxis-a2b3c4d5e7.localhost:51234/#work-order=wo-1", true],
    ["https://example.com/#work-order=wo-1", false],
    ["http://praxis-abcdefghij.localhost:7443/#work-order=wo-1", false],
    ["https://localhost:7443/#work-order=wo-1", false],
  ] as const) {
    const backend = fakeBackend();
    const root = await showRun(backend);
    await answer(backend.statuses()[0], statusRecord(awaiting({ runPageAddress: address })));
    await click(button(banner(root) as HTMLElement, /^Open in browser for run-1$/));
    await flush();
    assert.deepEqual(backend.opened(), opens ? [address] : [], address);
    if (!opens) assert.match(text(detail(root)), /Quay opens only pages on this machine's Praxis host/, address);
    unmount();
  }
});

test("before status gives an address, Open in browser opens the one the run's row gave", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { runPageAddress: "https://127.0.0.1:7443/#work-order=wo-1" })]);
  await click(button(header(root), /^Open in browser for run-1$/));
  await flush();
  assert.deepEqual(backend.opened(), ["https://127.0.0.1:7443/#work-order=wo-1"]);
});

test("a run that waits for nothing has no waiting banner", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], working(0));
  assert.equal(banner(root), null);
  assert.ok(button(header(root), /^Open in browser for run-1$/), "the header still opens the run's page");
});

test("a simulated host's run says its decisions aren't a person's", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(awaiting({ simulatedIdentity: true })));
  assert.match(text(header(root)), /Simulated/);
  assert.match(text(banner(root)), /This host is simulated: its decisions aren't made by a person\./);
});

test("a held run gets a Held badge and a hold panel per graph hold card, each with Resolve in browser, in place of the banner", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true })]);
  await answer(
    backend.statuses()[0],
    statusRecord(
      graphOperatorView(1, {
        pending: [holdDecision("hold-1", "build"), reconciliation("hold-2")],
        holds: [
          holdCard("hold-1", "build", "EXECUTION_FAILED", { cause: "OUTPUT_SCHEMA_VIOLATION" }),
          holdCard("hold-2", "test", "UNCERTAIN_EFFECT", { effect: "UNKNOWN", maxAttempts: null, exits: ["RECONCILE"] }),
        ],
      }),
    ),
  );
  assert.match(text(header(root)), /Held/);
  const [first, second] = panels(root);
  assert.equal(panels(root).length, 2);
  assert.match(text(first), /^Held: EXECUTION_FAILED on node build/);
  assert.match(text(first), /Cause: OUTPUT_SCHEMA_VIOLATION/);
  assert.match(text(first), /Effect: CONFIRMED_APPLIED/);
  assert.match(text(first), /Attempts: 1 of 3/);
  assert.deepEqual(exitsOf(first), [RELEASE]);
  assert.match(text(second), /^Held: UNCERTAIN_EFFECT on node test/);
  assert.doesNotMatch(text(second), /Cause:/);
  assert.match(text(second), /Effect: UNKNOWN/);
  assert.match(text(second), /Attempts: 1, with no bound/);
  assert.deepEqual(exitsOf(second), ["Reconcile: Records whether the attempt's action took effect."]);
  assert.equal(banner(root), null, "the hold panels stand in for the waiting banner");
  await click(button(second, /^Resolve in browser for run-1$/));
  await flush();
  assert.deepEqual(backend.opened(), [`${BROWSER_ORIGIN}/#work-order=wo-1`]);
  // The exits are words, never controls: only Resolve in browser is a button in a panel.
  for (const panel of panels(root)) assert.deepEqual(buttons(panel).map((b) => text(b)), ["Resolve in browser"]);
});

test("each exit a hold card offers is named in words, one Quay doesn't know as the host gave it, and a card offering none says the run can be cancelled", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true })]);
  await answer(
    backend.statuses()[0],
    statusRecord(
      graphOperatorView(1, {
        holds: [
          holdCard("hold-1", "build", "EXECUTION_FAILED", { effect: "CONFIRMED_NOT_APPLIED", exits: ["RETRY"] }),
          holdCard("hold-2", "loop", "UNKNOWN_REQUIRES_RECONCILIATION", { effect: "UNKNOWN", exits: ["REVALIDATE", "SOMETHING_NEW"] }),
          holdCard("hold-3", "deploy", "EXPOSURE_EXCEEDED", { exits: [] }),
        ],
      }),
    ),
  );
  const [retry, revalidate, none] = panels(root);
  assert.deepEqual(exitsOf(retry), ["Retry: Runs the same operation again, since it took no effect."]);
  assert.deepEqual(exitsOf(revalidate), ["Revalidate: Runs the loop's validation again, once the host proves that is safe.", "SOMETHING_NEW"]);
  assert.deepEqual(exitsOf(none), []);
  assert.match(text(none), /No way out of the hold is offered: a person may cancel the run in the browser\./);
  for (const panel of [retry, revalidate]) assert.doesNotMatch(text(panel), /No way out/);
});

test("a card whose holdId reads like a card without one still gets its own panel", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true })]);
  const { holdId: _, ...unnamed } = holdCard("", "build", "EXECUTION_FAILED");
  await answer(
    backend.statuses()[0],
    statusRecord(graphOperatorView(1, { holds: [holdCard("unnamed:EXECUTION_FAILED on node build", "test", "UNCERTAIN_EFFECT"), unnamed, unnamed] })),
  );
  // A card without a holdId is kept once, beside the card whose holdId looks like its fallback.
  const [first, second] = panels(root);
  assert.equal(panels(root).length, 2);
  assert.match(text(first), /^Held: UNCERTAIN_EFFECT on node test/);
  assert.match(text(second), /^Held: EXECUTION_FAILED on node build/);
});

test("a run with reconciliation pending and no hold card is held too, with a panel saying why", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { pending: [reconciliation("hold-2")] })));
  assert.match(text(header(root)), /Held/);
  assert.equal(panels(root).length, 1);
  assert.match(text(panels(root)[0]), /^Held: An attempt's outcome is unknown, so it needs reconciliation\./);
  assert.ok(button(panels(root)[0], /^Resolve in browser for run-1$/));
});

test("before its first read, a run is held as its row says", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true })]);
  assert.match(text(header(root)), /Held/);
});

test("the detail has no approve, pause, cancel or hold control, not even a disabled one, and reads only", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true, awaitingApproval: true })]);
  await answer(
    backend.statuses()[0],
    statusRecord(
      awaiting({
        control: { status: "PAUSED", reason: null },
        pending: [{ key: "RUN_APPROVAL", kind: "RUN_APPROVAL" }, holdDecision("hold-1", "build"), { key: "RESUME_CONTROL", kind: "RESUME_CONTROL" }],
        holds: [holdCard("hold-1", "build", "EXECUTION_FAILED")],
      }),
    ),
  );
  const names = buttons(detail(root) as HTMLElement).map((b) => `${b.getAttribute("aria-label") ?? ""} ${text(b)}`);
  for (const name of names) assert.doesNotMatch(name, /approve|accept|pause|resume|cancel|abandon|hold|reconcile|retry/i, name);
  assert.equal(detail(root)?.querySelectorAll("[aria-disabled], button[disabled]").length, 0, "not even disabled ones");
  for (const s of backend.sent) {
    assert.ok(["praxis_validate", "praxis_check_graph_workflow", "praxis_graph_workflow_triggers", "praxis_host_graph_runs", "praxis_host_graph_status"].includes(s.command), s.command);
  }
});

const TRUST_HINT = "Your browser does not trust this host's certificate yet: run praxis trust --state C:/praxis first.";

test("when status gives the certificate hint, the banner adds Trust certificate, which opens a visible terminal running praxis trust", async () => {
  terminals.length = 0;
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(awaiting(), TRUST_HINT));
  assert.ok(text(banner(root)).includes(TRUST_HINT));
  await click(button(banner(root) as HTMLElement, /^Trust certificate$/));
  await flush();
  const argv = backend.sent.filter((s) => s.command === "praxis_host_terminal_argv");
  assert.deepEqual(argv.map((s) => s.args.command), ["trust"]);
  assert.deepEqual(terminals, [{ cwd: PROJECT, argv: ["node", "C:/sdk/engine/src/praxis.mjs", "trust"] }]);
  assert.ok(!backend.commands().some((c) => /trust/.test(c) && c !== "praxis_host_terminal_argv"), "praxis trust never runs headless");
});

test("a held run's certificate hint shows in its hold panel with Trust certificate", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { pending: [holdDecision("hold-1", "build")], holds: [holdCard("hold-1", "build", "EXECUTION_FAILED")] }), TRUST_HINT));
  assert.ok(button(panels(root)[0], /^Trust certificate$/));
});

test("without the hint, or with one praxis trust can't help, there is no Trust certificate", async () => {
  for (const hint of [undefined, "Your browser does not trust this host's certificate; its trust is the host operator's."]) {
    const backend = fakeBackend();
    const root = await showRun(backend);
    await answer(backend.statuses()[0], statusRecord(awaiting(), hint));
    assert.equal(button(detail(root) as HTMLElement, /^Trust certificate$/), undefined, String(hint));
    if (hint) assert.ok(text(banner(root)).includes(hint), "the hint itself is still shown");
    unmount();
  }
});

test("unknown fields are ignored, and a drawn field that is missing or mistyped falls back to the run's row", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { status: "RUNNING", control: "PAUSED", workflowRevision: 7 })]);
  assert.match(text(header(root)), /RUNNING/, "before the first status read, the row is drawn");
  await answer(
    backend.statuses()[0],
    statusRecord({ format: "aiws-graph-operator-view/1", workOrderId: "wo-1", status: 3, control: "x", pending: {}, holds: "none", somethingNew: [1], nodes: [{ phase: "NEW" }] }),
  );
  assert.equal(text(detail(root)).includes("praxis gave"), false, "the record was read");
  assert.match(text(header(root)), /RUNNING/);
  assert.equal(text(header(root).querySelector('[data-chip="control"]')), "PAUSED");
  assert.match(text(header(root)), /revision 7/);
  assert.doesNotMatch(text(header(root)), /Held|Awaiting approval/);
});

test("a status record in another format isn't read: the last run stays, with the problem, and is read again after 60 s", async () => {
  for (const format of ["aiws-graph-operator-view/2", "coding-operator-view/1", undefined]) {
    const backend = fakeBackend();
    const root = await showRun(backend);
    await answer(backend.statuses()[0], statusRecord(awaiting()));
    const other = { ...awaiting({ status: "COMPLETED", outcome: "SUCCEEDED", pending: [] }), format };
    await nextReadAfter(backend, 15_000, statusRecord(other));
    assert.match(text(detail(root)), /praxis gave a run status Quay can't read\./, String(format));
    assert.match(text(header(root)), /Awaiting approval/, "the last run read stays");
    assert.doesNotMatch(text(header(root)), /COMPLETED/);
    await nextReadAfter(backend, 60_000, statusRecord(awaiting()));
    assert.doesNotMatch(text(detail(root)), /can't read/);
    unmount();
  }
});

// The node table (#569): one row per entry of the view's `nodes[]`, from the detail's own read.

/** The detail's Nodes toggle. */
const nodesToggle = (root: HTMLElement) => button(detail(root) as HTMLElement, /^Nodes/) as HTMLButtonElement;
/** The node table, when it is open. */
const nodeTable = (root: HTMLElement) => detail(root)?.querySelector("table") ?? null;
/** The node table's rows, each as the text of its cells. */
const nodeRows = (root: HTMLElement) => [...(nodeTable(root)?.querySelectorAll("tbody tr") ?? [])].map((tr) => [...tr.children].map((cell) => text(cell)));

test("the detail lists each of the run's nodes behind a Nodes toggle that states their count: its id, kind and node phase", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(
    backend.statuses()[0],
    statusRecord(graphOperatorView(1, { nodes: [node("build", "TASK", "COMPLETED"), node("review", "APPROVAL", "AWAITING_HUMAN"), node("end", "END", "NOT_READY")] })),
  );
  const toggle = nodesToggle(root);
  assert.equal(text(toggle), "Nodes (3)");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(nodeTable(root), null, "the table is collapsed at first");
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(nodeRows(root), [
    ["build", "TASK", "COMPLETED", ""],
    ["review", "APPROVAL", "AWAITING_HUMAN", ""],
    ["end", "END", "NOT_READY", ""],
  ]);
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(nodeTable(root), null, "the toggle collapses it again");
});

/** A node's `scope` with `attempts` used of `maxAttempts`, which it leaves out when the scope has no bound. */
const scope = (attempts: number, maxAttempts?: number) => ({ spent: "0", reserved: "0", costUnit: "micro-USD", attempts, ...(maxAttempts === undefined ? {} : { maxAttempts }) });
/** A LOOP node's `loop`, with `iteration` of its `maxIterations` completed. */
const loop = (iteration: number, maxIterations: number) => ({ iteration, maxIterations, intervalMs: null, nextDueMs: null, truncated: false, iterations: [] });

test("a node's counter line gives its loop's iterations of their most, else the attempts it used of those its scope allows, and is empty with neither", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(
    backend.statuses()[0],
    statusRecord(
      graphOperatorView(1, {
        nodes: [
          node("build", "TASK", "HELD", { scope: scope(1, 2) }),
          node("decide", "DECISION", "READY", { scope: scope(0) }),
          node("improve", "LOOP", "RUNNING", { scope: scope(3, 10), loop: loop(1, 5) }),
          node("poll", "LOOP", "NOT_READY", { loop: loop(0, 3) }),
          node("end", "END", "NOT_READY"),
        ],
      }),
    ),
  );
  await click(nodesToggle(root));
  assert.deepEqual(
    nodeRows(root).map(([id, , , counter]) => [id, counter]),
    [
      ["build", "Attempts: 1 of 2"],
      ["decide", "Attempts: 0, with no bound"],
      ["improve", "Iterations: 1 of 5"],
      ["poll", "Iterations: 0 of 3"],
      ["end", ""],
    ],
  );
});

/** Each node phase in the order of GRAPH-WORKFLOWS.md's "Node phase" table, and the tone its chip draws in. */
const PHASE_TONES = [
  ["COMPLETED", "ok"],
  ["SKIPPED", "neutral"],
  ["FAILED", "error"],
  ["HELD", "amber"],
  ["BLOCKED_BY_HOLD", "amber"],
  ["RUNNING", "active"],
  ["PARKED", "active"],
  ["WAITING", "active"],
  ["AWAITING_HUMAN", "amber"],
  ["READY", "neutral"],
  ["NOT_READY", "neutral"],
] as const;

test("each of the eleven node phases draws its text in its tone, SKIPPED dimmed, and a phase Quay doesn't know draws its text in neutral", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  const phases = [...PHASE_TONES.map(([phase]) => phase), "SOMETHING_NEW"];
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { nodes: phases.map((phase, n) => node(`node-${n}`, "TASK", phase)) })));
  await click(nodesToggle(root));
  const chips = [...(nodeTable(root)?.querySelectorAll('[data-chip="phase"]') ?? [])];
  assert.deepEqual(
    chips.map((chip) => [text(chip), chip.getAttribute("data-tone")]),
    [...PHASE_TONES, ["SOMETHING_NEW", "neutral"]],
  );
  assert.deepEqual(
    chips.filter((chip) => /\bopacity-/.test(chip.className)).map((chip) => text(chip)),
    ["SKIPPED"],
    "only SKIPPED is dimmed",
  );
});

/** The detail's node problem lines. */
const nodeProblems = (root: HTMLElement) => [...(detail(root)?.querySelectorAll('[aria-label="Node problems"] li') ?? [])].map((li) => text(li));

test("a node entry without its nodeId or phase is a problem line in place of a row, shown whether or not the table is open", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  const { nodeId: _id, ...unnamed } = node("lost", "TASK", "RUNNING");
  const { phase: _phase, ...phaseless } = node("build", "TASK", "RUNNING");
  await answer(
    backend.statuses()[0],
    statusRecord(graphOperatorView(1, { nodes: [node("start", "TASK", "COMPLETED"), unnamed, phaseless, { kind: "END" }, "end", node("", "TASK", "READY"), node("test", "TASK", "", { phase: 7 })] })),
  );
  const problems = [
    "Node entry 2 has no nodeId, so it isn't in the table.",
    "Node build has no phase, so it isn't in the table.",
    "Node entry 4 has no nodeId or phase, so it isn't in the table.",
    "Node entry 5 has no nodeId or phase, so it isn't in the table.",
    "Node entry 6 has no nodeId, so it isn't in the table.",
    "Node test has no phase, so it isn't in the table.",
  ];
  assert.deepEqual(nodeProblems(root), problems, "shown while the table is collapsed");
  assert.equal(text(nodesToggle(root)), "Nodes (1)", "the toggle counts the table's rows");
  await click(nodesToggle(root));
  assert.deepEqual(nodeRows(root), [["start", "TASK", "COMPLETED", ""]]);
  assert.deepEqual(nodeProblems(root), problems, "and while it is open");
});

test("a view without nodes[] gets one line saying the host doesn't report node phases, and no table, which a run not read yet doesn't", async () => {
  for (const nodes of [undefined, { build: "COMPLETED" }, "none"]) {
    const backend = fakeBackend();
    const root = await showRun(backend);
    assert.doesNotMatch(text(detail(root)), /node phases/, "not before the first read");
    assert.equal(nodesToggle(root), undefined);
    const { nodes: _, ...view } = graphOperatorView(1);
    await answer(backend.statuses()[0], statusRecord(nodes === undefined ? view : { ...view, nodes }));
    assert.equal(text(detail(root)).match(/This host doesn't report node phases\./g)?.length, 1, JSON.stringify(nodes));
    assert.equal(nodesToggle(root), undefined, "no Nodes toggle");
    assert.equal(nodeTable(root), null, "no table");
    unmount();
  }
});

test("the node table has a header for each column and a row header for each node, and its toggle controls it while it is open", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { nodes: [node("build", "TASK", "RUNNING", { scope: scope(1, 2) })] })));
  const toggle = nodesToggle(root);
  assert.equal(toggle.getAttribute("aria-controls"), null, "it controls nothing while the table is collapsed");
  await click(toggle);
  const table = nodeTable(root) as HTMLTableElement;
  assert.ok(table.id);
  assert.equal(toggle.getAttribute("aria-controls"), table.id);
  assert.deepEqual(
    [...table.querySelectorAll("thead th")].map((th) => [text(th), th.getAttribute("scope")]),
    [
      ["Node", "col"],
      ["Kind", "col"],
      ["Phase", "col"],
      ["Counter", "col"],
    ],
  );
  assert.deepEqual([...table.querySelectorAll("tbody th")].map((th) => [text(th), th.getAttribute("scope")]), [["build", "row"]]);
});

test("a node that changes phase on the host changes its row on the next read, which is the detail's one praxis status call", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  /** The run with `build` in `phase`, having used `attempts`, under change token `n`. */
  const at = (n: number, phase: string, attempts: number) => working(n, { nodes: [node("build", "TASK", phase, { scope: scope(attempts, 2) }), node("end", "END", "NOT_READY")] });
  await answer(backend.statuses()[0], at(0, "READY", 0));
  await click(nodesToggle(root));
  assert.deepEqual(nodeRows(root)[0], ["build", "TASK", "READY", "Attempts: 0 of 2"]);
  const before = backend.sent.length;
  await nextReadAfter(backend, 3_000, at(1, "RUNNING", 1));
  assert.deepEqual(nodeRows(root)[0], ["build", "TASK", "RUNNING", "Attempts: 1 of 2"]);
  await nextReadAfter(backend, 3_000, at(2, "COMPLETED", 1));
  assert.deepEqual(nodeRows(root), [
    ["build", "TASK", "COMPLETED", "Attempts: 1 of 2"],
    ["end", "END", "NOT_READY", ""],
  ]);
  assert.equal(nodesToggle(root).getAttribute("aria-expanded"), "true", "the table stays open from one read to the next");
  assert.deepEqual(
    backend.sent.slice(before).map((s) => s.command),
    ["praxis_host_graph_status", "praxis_host_graph_status"],
    "each read is one praxis status call, and nothing else reads the host",
  );
});

test("while the host can't be used, the node table keeps the last read's rows, dimmed with the run-level facts, until a read succeeds", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], working(0, { nodes: [node("build", "TASK", "RUNNING")] }));
  await click(nodesToggle(root));
  const dimmed = () => Boolean(nodesToggle(root).closest(".opacity-50"));
  assert.equal(dimmed(), false);
  await nextReadAfter(backend, 3_000, HOST_DOWN);
  assert.equal(dimmed(), true);
  assert.match(detail(root)?.querySelector("dl")?.className ?? "", /opacity-50/, "as the run-level facts are");
  assert.deepEqual(nodeRows(root), [["build", "TASK", "RUNNING", ""]], "the last read's rows stay");
  await nextReadAfter(backend, 60_000, working(1, { nodes: [node("build", "TASK", "COMPLETED")] }));
  assert.equal(dimmed(), false);
  assert.deepEqual(nodeRows(root), [["build", "TASK", "COMPLETED", ""]]);
});

test("without a change token, a change of a node's phase, attempts or loop iteration alone is a change of the run", async () => {
  const backend = fakeBackend();
  await showRun(backend);
  const { changeToken: _, ...tokenless } = graphOperatorView(1);
  /** The run with `build` in `phase` having used `attempts`, and its loop `improve` at `iteration`, with no change token. */
  const at = (phase: string, attempts: number, iteration: number) =>
    statusRecord({ ...tokenless, nodes: [node("build", "TASK", phase, { scope: scope(attempts, 2) }), node("improve", "LOOP", "NOT_READY", { loop: loop(iteration, 3) })] });
  await answer(backend.statuses()[0], at("READY", 0, 0));
  await nextReadAfter(backend, 3_000, at("READY", 0, 0));
  await nextReadAfter(backend, 6_000, at("RUNNING", 0, 0));
  await nextReadAfter(backend, 3_000, at("RUNNING", 1, 0));
  await nextReadAfter(backend, 3_000, at("RUNNING", 1, 1));
  await nextReadAfter(backend, 3_000, at("RUNNING", 1, 1));
  await nextReadAfter(backend, 6_000, at("RUNNING", 1, 1));
});

test("the recorded run with nodes in several phases draws a row for each, with its node phase in its tone and never its SDK status", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true })]);
  await answer(backend.statuses()[0], statusRecord(recordedStdout("status: nodes in several phases")));
  assert.equal(text(nodesToggle(root)), "Nodes (7)");
  await click(nodesToggle(root));
  assert.deepEqual(nodeRows(root), [
    ["build", "TASK", "COMPLETED", "Attempts: 1 of 2"],
    ["test", "TASK", "HELD", "Attempts: 1 of 2"],
    ["cooldown", "WAIT", "WAITING", "Attempts: 0 of 2"],
    ["signoff", "APPROVAL", "AWAITING_HUMAN", ""],
    ["package", "TASK", "BLOCKED_BY_HOLD", "Attempts: 0 of 2"],
    ["deploy", "TASK", "NOT_READY", "Attempts: 0 of 2"],
    ["end", "END", "BLOCKED_BY_HOLD", ""],
  ]);
  const table = nodeTable(root) as HTMLElement;
  assert.deepEqual(
    [...table.querySelectorAll('[data-chip="phase"]')].map((chip) => chip.getAttribute("data-tone")),
    ["ok", "amber", "active", "amber", "amber", "neutral", "amber"],
  );
  assert.doesNotMatch(text(table), /PENDING/, "the nodes' SDK status isn't shown");
  assert.deepEqual(nodeProblems(root), []);
});
