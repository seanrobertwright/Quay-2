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
