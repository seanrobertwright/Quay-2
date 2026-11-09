/// <reference types="node" />
// Component tests for a graph run's detail (#444, #465): run-level facts only, followed by polled
// `praxis status <wo> --format aiws-graph-operator-view/1`, with the template run detail's
// backoff, waiting banner, hold panel and Trust certificate. They render the real graph workflow
// form into happy-dom and fake only Tauri's `invoke`, the out-of-process boundary, and the
// terminal the window opens.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import type { CallOutcome } from "./praxisHost.ts";
import { BROWSER_ORIGIN, graphOperatorView, graphRunEntry as entry, graphRunsRecord, statusRecord } from "./fixtures/runs.ts";
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
  assert.equal(root.querySelector("canvas, .react-flow, [data-graph-canvas]"), null, "no node states: run-level facts only");
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
  const hold = { format: "aiws-hold-card/1", holdId: "hold-1", reasonText: "The attempt failed" };
  for (const extra of [
    { status: "READY", pending: [{ key: "RUN_APPROVAL", kind: "RUN_APPROVAL" }] },
    { pending: [{ key: "HOLD_DECISION:hold-1", kind: "HOLD_DECISION", holdId: "hold-1", nodeId: "build" }], holds: [hold] },
    { pending: [{ key: "RECONCILIATION:att-1", kind: "RECONCILIATION", attemptId: "att-1", holdId: "hold-2" }] },
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
const banner = (root: HTMLElement) => detail(root)?.querySelector('[aria-label="Waiting for a decision"]') as HTMLElement | null;

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
          { key: "RESUME_CONTROL", kind: "RESUME_CONTROL" },
          { key: "SOMETHING_NEW", kind: "SOMETHING_NEW" },
        ],
      }),
    ),
  );
  assert.match(text(banner(root)), /waits for approval of node deploy, acceptance of node review, resuming: the run is paused, decided in the browser/);
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

/** A hold card as `aiws-hold-card/1` gives it at the SDK pin, with the fields the panel draws. */
const holdCard = (holdId: string, reasonText: string, extra: Record<string, unknown> = {}) => ({
  format: "aiws-hold-card/1",
  holdId,
  nodeId: "build",
  reasonText,
  cause: "The tool exited with 1.",
  evidence: "3 tests failed.",
  notes: ["The node used 2 of its 3 attempts."],
  phaseText: "Raised after the attempt committed.",
  exits: [
    { exit: "RETRY", label: "Retry the node", does: "Starts another attempt.", available: true, unavailable: null, command: null },
    { exit: "RECONCILE", label: "Reconcile", does: "Records what the attempt did.", available: false, unavailable: "Not available yet.", command: null },
  ],
  ...extra,
});
const panels = (root: HTMLElement) => [...(detail(root)?.querySelectorAll('[role="region"]') ?? [])].filter((r) => /^Held:/.test(text(r))) as HTMLElement[];
const holdDecision = (holdId: string, nodeId: string) => ({ key: `HOLD_DECISION:${holdId}`, kind: "HOLD_DECISION", holdId, nodeId });

test("a held run gets a Held badge and a hold panel per open hold, each with Resolve in browser, in place of the banner", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true })]);
  await answer(
    backend.statuses()[0],
    statusRecord(
      graphOperatorView(1, {
        pending: [holdDecision("hold-1", "build"), holdDecision("hold-2", "test")],
        holds: [holdCard("hold-1", "The attempt failed"), holdCard("hold-2", "The node scope is spent", { nodeId: "test", exits: [] })],
      }),
    ),
  );
  assert.match(text(header(root)), /Held/);
  const [first, second] = panels(root);
  assert.equal(panels(root).length, 2);
  assert.match(text(first), /^Held: The attempt failed/);
  assert.match(text(first), /The tool exited with 1\./);
  assert.match(text(first), /3 tests failed\./);
  assert.match(text(first), /The node used 2 of its 3 attempts\./);
  assert.match(text(first), /Raised after the attempt committed\./);
  assert.match(text(first), /Retry the node: Starts another attempt\./);
  assert.match(text(first), /Reconcile: Records what the attempt did\. \(not available now\)/);
  assert.match(text(second), /^Held: The node scope is spent/);
  assert.equal(banner(root), null, "the hold panels stand in for the waiting banner");
  await click(button(second, /^Resolve in browser for run-1$/));
  await flush();
  assert.deepEqual(backend.opened(), [`${BROWSER_ORIGIN}/#work-order=wo-1`]);
  // The exits are words, never controls: only Resolve in browser is a button in a panel.
  for (const panel of panels(root)) assert.deepEqual(buttons(panel).map((b) => text(b)), ["Resolve in browser"]);
});

test("a card whose holdId reads like a card without one still gets its own panel", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true })]);
  const { holdId: _, ...unnamed } = holdCard("", "The attempt failed");
  await answer(
    backend.statuses()[0],
    statusRecord(graphOperatorView(1, { holds: [holdCard("unnamed: The attempt failed", "The node scope is spent"), unnamed, unnamed] })),
  );
  // A card without a holdId is kept once, beside the card whose holdId looks like its fallback.
  const [first, second] = panels(root);
  assert.equal(panels(root).length, 2);
  assert.match(text(first), /^Held: The node scope is spent/);
  assert.match(text(second), /^Held: The attempt failed/);
});

test("a run with reconciliation pending and no hold card is held too, with a panel saying why", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { pending: [{ key: "RECONCILIATION:att-1", kind: "RECONCILIATION", attemptId: "att-1" }] })));
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
        holds: [holdCard("hold-1", "The attempt failed")],
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
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { pending: [holdDecision("hold-1", "build")], holds: [holdCard("hold-1", "The attempt failed")] }), TRUST_HINT));
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
