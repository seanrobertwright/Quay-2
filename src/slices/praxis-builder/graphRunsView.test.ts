/// <reference types="node" />
// Component tests for a graph workflow's Runs view (#464): the Workflow | Runs switch, the list,
// its markers and Show more, and every way the view leaves the screen, which must stop the poller
// and kill its praxis call, as for a template's Runs view (#452). They render the real graph
// workflow form into happy-dom and fake only Tauri's `invoke`, the out-of-process boundary.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import type { CallOutcome } from "./praxisHost.ts";
import { BROWSER_ORIGIN, graphRunEntry as entry, graphRunsRecord } from "./fixtures/runs.ts";
import { formatClock, formatDateTime } from "../../lib/dates.ts";

const { GraphWorkflowForm } = await import("./GraphWorkflowForm.tsx");

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const PROJECT = "C:/project";
const NAME = "nightly-build";

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW }));
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  mock.timers.reset();
  setWindowVisible(true);
});

function setWindowVisible(visible: boolean): void {
  Object.defineProperty(document, "visibilityState", { value: visible ? "visible" : "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

const runs = (entries: unknown[], extra: Record<string, unknown> = {}) => graphRunsRecord(NAME, entries, extra);

interface Sent {
  command: string;
  args: Record<string, unknown>;
  answer: (value: unknown) => void;
}

/** The backend: the form's own reads answer at once; praxis calls wait for the test. */
function fakeBackend(status: (workOrderId: string) => CallOutcome = () => ({ kind: "refused", message: "no status" })) {
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
            return;
          case "praxis_host_cancel":
          case "plugin:opener|open_url":
            return resolve(undefined);
          case "praxis_host_graph_status":
            return resolve(status(String(args.workOrderId)));
          default:
            return reject(new Error(`unexpected invoke ${command}`));
        }
      }),
  );
  const reads = () => sent.filter((s) => s.command === "praxis_host_graph_runs");
  const cancels = () => sent.filter((s) => s.command === "praxis_host_cancel").map((s) => s.args.callId);
  const opened = () => sent.filter((s) => s.command === "plugin:opener|open_url").map((s) => s.args.url);
  const lookups = () => sent.filter((s) => s.command === "praxis_host_graph_status").map((s) => s.args.workOrderId);
  return { sent, reads, cancels, opened, lookups };
}

function form(props: { projectPath?: string; name?: string; shown?: boolean } = {}) {
  const id = props.name ?? NAME;
  const ref = { kind: "graph-workflows" as const, id };
  const content = { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" };
  const draft = createDraft(ref, { id, kind: "graph-workflows", missing: false, content, contentHash: "h" });
  assert.ok(draft.ok);
  return createElement(GraphWorkflowForm, {
    projectPath: props.projectPath ?? PROJECT,
    draft: draft.value,
    contracts: ["c"],
    graphs: ["g"],
    graphBindings: [{ id: "g-1", graphId: "g" }],
    refresh: 0,
    onEdit: () => {},
    onOpen: () => {},
    onValidated: () => {},
    runs: { shown: props.shown ?? true },
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
const button = (root: HTMLElement, name: RegExp) =>
  [...root.querySelectorAll("button")].find((b) => name.test(b.getAttribute("aria-label") ?? text(b))) as HTMLButtonElement | undefined;
const click = (el: HTMLElement | undefined) => act(async () => el?.click());
const flush = () => act(async () => {});
const tick = (ms: number) => act(async () => mock.timers.tick(ms));
const rows = (root: HTMLElement) => [...root.querySelectorAll('[aria-label="Runs"] li')] as HTMLElement[];

async function openRuns(root: HTMLElement): Promise<void> {
  await click(button(root, /^Runs$/));
}

test("the switch is two pressed-state buttons, Workflow first, and never tabs", async () => {
  fakeBackend();
  const root = await render(form());
  const workflow = button(root, /^Workflow$/);
  const runsButton = button(root, /^Runs$/);
  assert.equal(workflow?.getAttribute("aria-pressed"), "true");
  assert.equal(runsButton?.getAttribute("aria-pressed"), "false");
  assert.equal(root.querySelector('[role="tab"], [role="tablist"]'), null);
  await click(runsButton);
  assert.equal(workflow?.getAttribute("aria-pressed"), "false");
  assert.equal(runsButton?.getAttribute("aria-pressed"), "true");
  assert.equal(root.querySelector("form"), null, "the form gives way to the runs");
  await click(workflow);
  assert.ok(root.querySelector("form"), "and comes back");
});

test("Runs lists the graph workflow's runs newest first with status, control as a chip, held, awaiting approval, revision and creation time", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  assert.equal(backend.reads().length, 0, "the Workflow view reads no runs");
  await openRuns(root);
  assert.equal(backend.reads().length, 1);
  assert.equal(backend.reads()[0].args.projectPath, PROJECT);
  assert.equal(backend.reads()[0].args.name, NAME);
  assert.equal(backend.reads()[0].args.limit, 20);
  await act(async () =>
    backend.reads()[0].answer(
      runs([
        entry(2, { status: "AWAITING_APPROVAL", awaitingApproval: true, control: "PAUSED", held: true, workflowRevision: 2, createdAt: "2026-11-08T10:15:00.000Z" }),
        entry(1, { status: "SUCCEEDED" }),
      ]),
    ),
  );
  const [newest, older] = rows(root);
  assert.equal(rows(root).length, 2);
  assert.match(text(newest), /run-2/);
  assert.match(text(newest), /AWAITING_APPROVAL/);
  assert.equal(text(newest.querySelector("[data-chip='control']")), "PAUSED");
  assert.match(text(newest), /Held/);
  assert.match(text(newest), /Awaiting approval/);
  assert.match(text(newest), /revision 2/);
  assert.ok(text(newest).includes(formatDateTime(Date.UTC(2026, 10, 8, 10, 15, 0))));
  assert.match(text(older), /run-1/);
  assert.match(text(older), /SUCCEEDED/);
  assert.equal(text(older.querySelector("[data-chip='control']")), "RUNNING");
  assert.doesNotMatch(text(older), /Held|Awaiting approval/);
  assert.match(text(older), /revision 1/);
});

/** Opens Runs, answers its first read, and asserts the poller's next read is in flight. */
async function polling(backend: ReturnType<typeof fakeBackend>, root: HTMLElement): Promise<unknown> {
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(1)])));
  await tick(14_999);
  assert.equal(backend.reads().length, 1, "no read before 15 s");
  await tick(1);
  assert.equal(backend.reads().length, 2, "the list is read again after 15 s");
  return backend.reads()[1].args.callId;
}

/** Asserts the in-flight read `callId` was cancelled and nothing more is read. */
async function stopped(backend: ReturnType<typeof fakeBackend>, callId: unknown): Promise<void> {
  assert.deepEqual(backend.cancels(), [callId], "its praxis call is killed");
  const before = backend.reads().length;
  await tick(10 * 60_000);
  assert.equal(backend.reads().length, before, "no read follows");
}

test("the list is read again every 15 s while the host answers", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await polling(backend, root);
  await act(async () => backend.reads()[1].answer(runs([entry(2), entry(1)])));
  assert.deepEqual(rows(root).map((r) => /run-\d+/.exec(text(r))?.[0]), ["run-2", "run-1"]);
  await tick(15_000);
  assert.equal(backend.reads().length, 3);
});

test("switching to Workflow stops the poller and kills its call", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await click(button(root, /^Workflow$/));
  await stopped(backend, callId);
});

test("hiding the builder stops the poller and kills its call; showing it again reads at once", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await rerender(form({ shown: false }));
  await stopped(backend, callId);
  await rerender(form({ shown: true }));
  assert.equal(backend.reads().length, 3);
});

test("hiding the window stops the poller and kills its call; showing it again reads at once", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await act(async () => setWindowVisible(false));
  await stopped(backend, callId);
  await act(async () => setWindowVisible(true));
  assert.equal(backend.reads().length, 3);
});

test("turning to another graph workflow stops the poller and kills its call", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await rerender(form({ name: "other-workflow" }));
  assert.deepEqual(backend.cancels(), [callId]);
  assert.ok(backend.reads().slice(2).every((r) => r.args.name === "other-workflow"));
  await tick(10 * 60_000);
  assert.equal(backend.reads().filter((r) => r.args.name === NAME).length, 2);
});

test("a project change stops the poller and kills its call", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await rerender(form({ projectPath: "C:/other" }));
  assert.deepEqual(backend.cancels(), [callId]);
  await tick(10 * 60_000);
  assert.equal(backend.reads().filter((r) => r.args.projectPath === PROJECT).length, 2);
});

test("unmounting the form stops the poller, kills its call and leaves no timer", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await act(async () => mounted?.root.unmount());
  mounted?.container.remove();
  mounted = null;
  await stopped(backend, callId);
});

for (const down of [
  { kind: "hostDown", message: "Nothing answered at https://127.0.0.1:7443; is it running?" },
  { kind: "notSignedIn", message: "There is no CLI session for this host." },
] as CallOutcome[]) {
  test(`while the host can't be used (${down.kind}), the last list stays, dimmed, with its read time, and is read every 60 s`, async () => {
    const backend = fakeBackend();
    const root = await render(form());
    await openRuns(root);
    await act(async () => backend.reads()[0].answer(runs([entry(1)])));
    const readAt = formatClock(NOW);
    await tick(15_000);
    await act(async () => backend.reads()[1].answer(down));
    const list = root.querySelector('[aria-label="Runs"]') as HTMLElement;
    assert.ok(list, "the last list is still shown");
    assert.match(text(list), /run-1/);
    assert.match(list.className, /opacity-50/);
    assert.match(text(root), /may be out of date/);
    assert.ok(text(root).includes(`read at ${readAt}`));
    await tick(59_999);
    assert.equal(backend.reads().length, 2);
    await tick(1);
    assert.equal(backend.reads().length, 3);
    await act(async () => backend.reads()[2].answer(runs([entry(1)])));
    assert.doesNotMatch((root.querySelector('[aria-label="Runs"]') as HTMLElement).className, /opacity-50/, "undimmed once the host answers");
    await tick(15_000);
    assert.equal(backend.reads().length, 4, "back to 15 s");
  });
}

test("only the newest read's answer is kept: an older read's late answer is dropped", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs(Array.from({ length: 20 }, (_, i) => entry(40 - i)))));
  await tick(15_000);
  // A poll is in flight when Show more asks again; the newer read answers first.
  assert.equal(backend.reads().length, 2);
  await click(button(root, /^Show more$/));
  assert.equal(backend.reads().length, 3);
  await act(async () => backend.reads()[2].answer(runs(Array.from({ length: 30 }, (_, i) => entry(40 - i)))));
  await act(async () => backend.reads()[1].answer(runs([entry(1)])));
  assert.equal(rows(root).length, 30);
});

test("20 rows are shown; Show more raises the limit to the host's cap of 100 and says so at the cap", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs(Array.from({ length: 20 }, (_, i) => entry(200 - i)))));
  assert.equal(rows(root).length, 20);
  assert.doesNotMatch(text(root), /newest 100/);
  await click(button(root, /^Show more$/));
  assert.equal(backend.reads()[1].args.limit, 100);
  await act(async () => backend.reads()[1].answer(runs(Array.from({ length: 100 }, (_, i) => entry(200 - i)))));
  assert.equal(rows(root).length, 100);
  assert.equal(button(root, /^Show more$/), undefined);
  assert.match(text(root), /Showing the newest 100 runs, the most praxis lists/);
  await tick(15_000);
  assert.equal(backend.reads()[2].args.limit, 100, "the raised limit holds for the polls that follow");
});

test("a graph workflow with fewer runs than 20 offers no Show more and no cap note", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(1)])));
  assert.equal(button(root, /^Show more$/), undefined);
  assert.doesNotMatch(text(root), /newest 100/);
});

test("a graph workflow with no runs says so", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([])));
  assert.match(text(root), new RegExp(`The host has no runs of ${NAME}`));
});

test("a run awaiting approval or held needs you, and its Open in browser opens the page the list gave", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () =>
    backend.reads()[0].answer(runs([entry(3, { status: "AWAITING_APPROVAL", awaitingApproval: true }), entry(2, { held: true }), entry(1)])),
  );
  const [awaiting, held, plain] = rows(root);
  assert.match(text(awaiting), /Needs you/);
  assert.match(text(held), /Needs you/);
  assert.doesNotMatch(text(plain), /Needs you/);
  assert.equal(button(plain, /Open .* in browser/), undefined);
  await click(button(awaiting, /^Open run-3 in browser$/));
  await flush();
  assert.deepEqual(backend.opened(), [`${BROWSER_ORIGIN}/#work-order=wo-3`]);
  assert.deepEqual(backend.lookups(), [], "no status lookup when the list gives the page");
});

test("a run the list gives no page for is looked up with the graph run's status", async () => {
  const backend = fakeBackend((wo) => ({ kind: "record", record: { format: "aiws-graph-operator-view/1", runPageAddress: `${BROWSER_ORIGIN}/#work-order=${wo}` } }));
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(1, { awaitingApproval: true, runPageAddress: null })])));
  await click(button(root, /^Open run-1 in browser$/));
  await flush();
  assert.deepEqual(backend.lookups(), ["wo-1"]);
  assert.deepEqual(backend.opened(), [`${BROWSER_ORIGIN}/#work-order=wo-1`]);
});

test("Open in browser refuses a page that isn't on this machine's host, and says so", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(1, { held: true, runPageAddress: "https://example.com/runs/wo-1" })])));
  await click(button(root, /^Open run-1 in browser$/));
  await flush();
  assert.deepEqual(backend.opened(), []);
  assert.match(text(root), /Quay opens only pages on this machine's Praxis host/);
});

test("a simulated host's runs carry amber markers named in words", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(1)])));
  assert.doesNotMatch(text(root), /Simulated|simulated host/);
  await tick(15_000);
  await act(async () => backend.reads()[1].answer(runs([entry(1)], { simulatedIdentity: true })));
  const [row] = rows(root);
  const marker = [...row.querySelectorAll("span")].find((s) => text(s) === "Simulated");
  assert.ok(marker, "the row is marked Simulated");
  assert.match(marker.className, /d29922/, "in amber");
  assert.match(text(root), /simulated host: their approvals aren't made by a person/);
});
