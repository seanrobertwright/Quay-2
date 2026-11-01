/// <reference types="node" />
// Component tests for a workflow template's Runs view (#452): the Template | Runs switch, the
// list, its markers and Show more, and every way the view leaves the screen, which must stop the
// poller and kill its praxis call. They render the real template form into happy-dom and fake
// only Tauri's `invoke`, the out-of-process boundary.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createNewDraft } from "./drafts.ts";
import type { CallOutcome } from "./praxisHost.ts";
import { runEntry as entry, runsRecord } from "./fixtures/runs.ts";
import { formatClock, formatDateTime } from "../../lib/dates.ts";

const { TemplateForm } = await import("./TemplateForm.tsx");

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const PROJECT = "C:/project";
const NAME = "review-code";

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

const runs = (entries: unknown[], extra: Record<string, unknown> = {}) => runsRecord(NAME, entries, extra);

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
          case "praxis_host_runs":
            return;
          case "praxis_host_cancel":
          case "plugin:opener|open_url":
            return resolve(undefined);
          case "praxis_host_status":
            return resolve(status(String(args.workOrderId)));
          default:
            return reject(new Error(`unexpected invoke ${command}`));
        }
      }),
  );
  const reads = () => sent.filter((s) => s.command === "praxis_host_runs");
  const cancels = () => sent.filter((s) => s.command === "praxis_host_cancel").map((s) => s.args.callId);
  const opened = () => sent.filter((s) => s.command === "plugin:opener|open_url").map((s) => s.args.url);
  return { sent, reads, cancels, opened };
}

function form(props: { projectPath?: string; name?: string; shown?: boolean } = {}) {
  const draft = createNewDraft({ kind: "templates", id: props.name ?? NAME }, {});
  assert.ok(draft.ok);
  return createElement(TemplateForm, {
    draft: draft.value,
    onEdit: () => {},
    onValidated: () => {},
    onInstall: () => {},
    host: null,
    runs: { projectPath: props.projectPath ?? PROJECT, shown: props.shown ?? true },
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
const text = (el: Element) => el.textContent ?? "";
const button = (root: HTMLElement, name: RegExp) =>
  [...root.querySelectorAll("button")].find((b) => name.test(b.getAttribute("aria-label") ?? text(b))) as HTMLButtonElement | undefined;
const click = (el: HTMLElement | undefined) => act(async () => el?.click());
const flush = () => act(async () => {});
const tick = (ms: number) => act(async () => mock.timers.tick(ms));

async function openRuns(root: HTMLElement): Promise<void> {
  await click(button(root, /^Runs$/));
}

test("the switch is two pressed-state buttons, Template first, and never tabs", async () => {
  fakeBackend();
  const root = await render(form());
  const template = button(root, /^Template$/);
  const runsButton = button(root, /^Runs$/);
  assert.equal(template?.getAttribute("aria-pressed"), "true");
  assert.equal(runsButton?.getAttribute("aria-pressed"), "false");
  assert.equal(root.querySelector('[role="tab"], [role="tablist"]'), null);
  await click(runsButton);
  assert.equal(template?.getAttribute("aria-pressed"), "false");
  assert.equal(runsButton?.getAttribute("aria-pressed"), "true");
});

test("Runs lists the template's runs newest first with status, stage, control as a chip, held, revision and creation time", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  assert.equal(backend.reads().length, 0, "the Template view reads no runs");
  await openRuns(root);
  assert.equal(backend.reads().length, 1);
  assert.equal(backend.reads()[0].args.name, NAME);
  assert.equal(backend.reads()[0].args.limit, 20);
  await act(async () => backend.reads()[0].answer(runs([entry(2, { status: "SUCCEEDED", stage: "ACCEPTANCE", control: "CANCELED", held: true, revision: 2 }), entry(1)])));
  const rows = [...root.querySelectorAll('[aria-label="Runs"] li')];
  assert.equal(rows.length, 2);
  assert.match(text(rows[0]), /run-2/);
  assert.match(text(rows[0]), /SUCCEEDED/);
  assert.match(text(rows[0]), /ACCEPTANCE/);
  assert.match(text(rows[0]), /Held/);
  assert.match(text(rows[0]), /revision 2/);
  assert.ok(text(rows[0]).includes(formatDateTime(Date.UTC(2026, 9, 25, 14, 0, 0))));
  const chip = rows[0].querySelector("[data-chip='control']");
  assert.equal(text(chip as Element), "CANCELED");
  assert.match(text(rows[1]), /run-1/);
  assert.doesNotMatch(text(rows[1]), /Held/);
});

/** Opens Runs, answers its first read, and asserts the poller's next read is in flight. */
async function polling(backend: ReturnType<typeof fakeBackend>, root: HTMLElement): Promise<unknown> {
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(1)])));
  await tick(15_000);
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

test("switching to Template stops the poller and kills its call", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await click(button(root, /^Template$/));
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

test("turning to another record stops the poller and kills its call", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await rerender(form({ name: "other-template" }));
  assert.deepEqual(backend.cancels(), [callId]);
  // The other record reads its own runs, and the first template's are never read again.
  assert.ok(backend.reads().slice(2).every((r) => r.args.name === "other-template"));
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

test("while the host is down, the last list stays, dimmed, with its read time, and is read every 60 s", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(1)])));
  const readAt = formatClock(NOW);
  await tick(15_000);
  await act(async () => backend.reads()[1].answer({ kind: "hostDown", message: "Nothing answered at https://127.0.0.1:7443; is it running?" }));
  const list = root.querySelector('[aria-label="Runs"]') as HTMLElement;
  assert.ok(list, "the last list is still shown");
  assert.match(list.className, /opacity-50/);
  assert.match(text(root), /may be out of date/);
  assert.ok(text(root).includes(`read at ${readAt}`));
  await tick(59_999);
  assert.equal(backend.reads().length, 2);
  await tick(1);
  assert.equal(backend.reads().length, 3);
});

test("Show more raises the limit to 100 and says so at the cap", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs(Array.from({ length: 20 }, (_, i) => entry(200 - i)))));
  assert.equal(root.querySelectorAll('[aria-label="Runs"] li').length, 20);
  assert.doesNotMatch(text(root), /newest 100/);
  await click(button(root, /^Show more$/));
  assert.equal(backend.reads()[1].args.limit, 100);
  await act(async () => backend.reads()[1].answer(runs(Array.from({ length: 100 }, (_, i) => entry(200 - i)))));
  assert.equal(root.querySelectorAll('[aria-label="Runs"] li').length, 100);
  assert.equal(button(root, /^Show more$/), undefined);
  assert.match(text(root), /Showing the newest 100 runs, the most praxis lists/);
});

test("a run waiting for a decision has a Needs you marker whose Open in browser opens its page", async () => {
  const backend = fakeBackend((wo) => ({ kind: "record", record: { format: "coding-operator-view/1", runPageAddress: `https://127.0.0.1:7443/#/runs/${wo}` } }));
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(2, { status: "AWAITING_APPROVAL" }), entry(1)])));
  const rows = [...root.querySelectorAll('[aria-label="Runs"] li')] as HTMLElement[];
  assert.match(text(rows[0]), /Needs you/);
  assert.doesNotMatch(text(rows[1]), /Needs you/);
  assert.equal(button(rows[1], /Open .* in browser/), undefined);
  await click(button(rows[0], /^Open run-2 in browser$/));
  await flush();
  assert.deepEqual(backend.opened(), ["https://127.0.0.1:7443/#/runs/wo-2"]);
});

test("Open in browser refuses a page that isn't on this machine's host, and says so", async () => {
  const backend = fakeBackend(() => ({ kind: "record", record: { format: "coding-operator-view/1", runPageAddress: "https://example.com/runs/wo-1" } }));
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(1, { held: true })])));
  await click(button(root, /^Open run-1 in browser$/));
  await flush();
  assert.deepEqual(backend.opened(), []);
  assert.match(text(root), /Quay opens only pages on this machine's Praxis host/);
});

test("a simulated host's runs carry an amber marker named in words", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openRuns(root);
  await act(async () => backend.reads()[0].answer(runs([entry(1)], { simulatedIdentity: true })));
  const row = root.querySelector('[aria-label="Runs"] li') as HTMLElement;
  assert.match(text(row), /Simulated/);
  assert.match(text(root), /simulated host: their approvals aren't made by a person/);
});
