/// <reference types="node" />
// Component tests for a graph trigger's Fires panel (#469, #478): the list with its rows, Show more
// and the note at the host's cap, the link from a fire to the graph run it created, the reads on
// demand and every 15 s while the panel is shown, and every way the panel leaves the screen, which
// must stop the poller and kill its praxis call, as for a Runs view (#452, #464). They render the
// real trigger form into happy-dom and fake only Tauri's `invoke`, the out-of-process boundary,
// answering it with what the real `praxis` printed (trigger_outputs.fixture.json).
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { formatClock, formatDateTime } from "../../lib/dates.ts";
import { createDraft } from "./drafts.ts";
import { recordedTrigger } from "./fixtures/triggerOutputs.ts";
import type { CallOutcome } from "./praxisHost.ts";
import type { GraphTriggerHost } from "./TriggerHostPanel.tsx";
import type { GraphTriggerHostView, TriggerHostState } from "./triggerHost.ts";
import type { TriggerTargetCheck, Validation } from "./types.ts";

const { TriggerForm } = await import("./TriggerForm.tsx");

const NOW = Date.UTC(2026, 10, 9, 16, 0, 0);
const PROJECT = "C:/project";
const NAME = "on-push";
const WORKFLOW = "release-review";
/** The run the recorded host's first fire of `on-push` created. */
const RECORDED_RUN = "wo-trigger-05f653bd88d7fc66065c75ab16ff6eb20ff522d00c5032439f9974ab4318a551";

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

const accepted: Validation = { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
const NO_CHECK: TriggerTargetCheck = { refused: [], diagnostics: [] };

interface Sent {
  command: string;
  args: Record<string, unknown>;
  answer: (value: unknown) => void;
}

/** The backend: the form's own checks answer at once; fires reads wait for the test. */
function fakeBackend() {
  const sent: Sent[] = [];
  fakeInvoke(
    (command, args) =>
      new Promise((resolve, reject) => {
        sent.push({ command, args, answer: resolve });
        switch (command) {
          case "praxis_validate":
            return resolve(accepted);
          case "praxis_check_trigger":
            return resolve(NO_CHECK);
          case "praxis_host_trigger_fires":
            return;
          case "praxis_host_cancel":
          case "plugin:opener|open_url":
            return resolve(undefined);
          default:
            return reject(new Error(`unexpected invoke ${command}`));
        }
      }),
  );
  const reads = () => sent.filter((s) => s.command === "praxis_host_trigger_fires");
  const cancels = () => sent.filter((s) => s.command === "praxis_host_cancel").map((s) => s.args.callId);
  const opened = () => sent.filter((s) => s.command === "plugin:opener|open_url").map((s) => s.args.url);
  return { sent, reads, cancels, opened };
}

/** What the recorded host printed for `triggers fires on-push`, as a call outcome. */
const recordedFires = (): CallOutcome => ({ kind: "record", record: recordedTrigger("triggers fires") });

/** One fire entry in the recorded shape, `fireId` with `fields` over the recorded refused fire's. */
function fire(fireId: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  const [refused] = (recordedTrigger("triggers fires").fires as Record<string, unknown>[]);
  return { ...refused, fireId, eventId: `evt-${fireId}`, ...fields };
}

/** A fires page of `fires`, newest first, whose `nextBefore` is `nextBefore`. */
const page = (fires: unknown[], nextBefore: number | null = null): CallOutcome => ({
  kind: "record",
  record: { ...recordedTrigger("triggers fires"), fires, nextBefore },
});

const view = (state: TriggerHostState = { kind: "admitted", revision: 1 }): GraphTriggerHostView => ({
  state,
  checkedAt: NOW - 60_000,
  muted: false,
  checking: false,
  admissionPageAddress: null,
  current: null,
  compared: true,
  hostEnabled: true,
  savedEnabled: true,
  revisions: [],
  olderRevisions: false,
});

interface FormProps {
  projectPath?: string;
  name?: string;
  shown?: boolean;
  state?: TriggerHostState;
  workflow?: string | null;
  onShowRun?: (workflow: string, workOrderId: string) => void;
}

/** The form for EVENT trigger `name`, which starts graph workflow `release-review`, as a graph trigger on the host. */
function form(props: FormProps = {}) {
  const name = props.name ?? NAME;
  const made = createDraft(
    { kind: "triggers", id: name },
    {
      id: name,
      kind: "triggers",
      missing: false,
      content: { id: name, revision: "1", kind: "EVENT", source: "github", eventType: "push", contractId: "c", action: "START_RUN", enabled: true, maxDepth: "0" },
      contentHash: "h",
      target: { version: 1, graphWorkflow: WORKFLOW },
      targetHash: "th",
    },
  );
  assert.ok(made.ok);
  const host: GraphTriggerHost = { view: view(props.state), condition: { state: "signedIn" }, onCheckAgain: () => {} };
  return createElement(TriggerForm, {
    projectPath: props.projectPath ?? PROJECT,
    draft: made.value,
    contracts: ["c"],
    graphWorkflows: [{ id: WORKFLOW, contractId: "c" }],
    refresh: 0,
    crossRecord: null,
    host,
    fires: {
      shown: props.shown ?? true,
      workflow: props.workflow === undefined ? WORKFLOW : props.workflow,
      onShowRun: props.onShowRun ?? (() => {}),
    },
    onEdit: () => {},
    onOpen: () => {},
    onValidated: () => {},
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
  [...root.querySelectorAll("button")].find((b) => name.test(b.getAttribute("aria-label") ?? text(b).trim())) as HTMLButtonElement | undefined;
const click = (el: HTMLElement | undefined) => {
  assert.ok(el, "the control is drawn");
  return act(async () => el.click());
};
const tick = (ms: number) => act(async () => mock.timers.tick(ms));
const list = (root: HTMLElement) => root.querySelector('[aria-label="Fires"]') as HTMLElement | null;
const rows = (root: HTMLElement) => [...root.querySelectorAll('[aria-label="Fires"] li')] as HTMLElement[];

async function openFires(root: HTMLElement): Promise<void> {
  await click(button(root, /^Show fires$/));
}

test("the Fires panel reads nothing until it is opened, then lists the 20 newest fires with time, disposition and reason code", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  assert.equal(backend.reads().length, 0, "a closed panel reads nothing");
  await openFires(root);
  assert.equal(backend.reads().length, 1);
  assert.deepEqual(
    { projectPath: backend.reads()[0].args.projectPath, name: backend.reads()[0].args.name, limit: backend.reads()[0].args.limit, before: backend.reads()[0].args.before },
    { projectPath: PROJECT, name: NAME, limit: 20, before: undefined },
  );
  await act(async () => backend.reads()[0].answer(recordedFires()));
  const [third, second, first] = rows(root);
  assert.equal(rows(root).length, 3);
  assert.ok(text(third).includes(formatDateTime(Date.UTC(2026, 10, 9, 15, 37, 11, 875))), "the time the host received it");
  assert.match(text(third), /REFUSED/);
  assert.match(text(third), /RUN_HELD/);
  assert.match(text(second), /REFUSED/);
  assert.match(text(first), /ADMITTED/);
  assert.doesNotMatch(text(first), /RUN_HELD/, "an admitted fire has no reason");
  assert.ok(text(root).includes(`Read at ${formatClock(NOW)}`));
});

/** Opens Fires, answers its first read, and asserts the poller's next read is in flight. */
async function polling(backend: ReturnType<typeof fakeBackend>, root: HTMLElement): Promise<unknown> {
  await openFires(root);
  await act(async () => backend.reads()[0].answer(recordedFires()));
  await tick(14_999);
  assert.equal(backend.reads().length, 1, "no read before 15 s");
  await tick(1);
  assert.equal(backend.reads().length, 2, "the fires are read again after 15 s");
  return backend.reads()[1].args.callId;
}

/** Asserts the in-flight read `callId` was cancelled and nothing more is read. */
async function stopped(backend: ReturnType<typeof fakeBackend>, callId: unknown): Promise<void> {
  assert.deepEqual(backend.cancels(), [callId], "its praxis call is killed");
  const before = backend.reads().length;
  await tick(10 * 60_000);
  assert.equal(backend.reads().length, before, "no read follows");
}

test("the fires are read again every 15 s while the panel is open, and Read again reads at once", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await act(async () => backend.reads()[1].answer(page([fire(4), ...(recordedTrigger("triggers fires").fires as unknown[])])));
  assert.equal(rows(root).length, 4);
  await tick(5_000);
  await click(button(root, /^Read again$/));
  assert.equal(backend.reads().length, 3, "Read again reads at once");
  assert.notEqual(backend.reads()[2].args.callId, callId);
  await act(async () => backend.reads()[2].answer(recordedFires()));
  await tick(14_999);
  assert.equal(backend.reads().length, 3, "the 15 s start over from the read on demand");
  await tick(1);
  assert.equal(backend.reads().length, 4);
});

test("hiding the panel stops the poller and kills its call; showing it again reads at once", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  const toggle = button(root, /^Hide fires$/);
  assert.equal(toggle?.getAttribute("aria-expanded"), "true");
  await click(toggle);
  assert.equal(button(root, /^Show fires$/)?.getAttribute("aria-expanded"), "false");
  assert.equal(list(root), null, "the hidden panel draws no list");
  await stopped(backend, callId);
  await openFires(root);
  assert.equal(backend.reads().length, 3);
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

test("turning to another trigger stops the poller and kills its call", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  const callId = await polling(backend, root);
  await rerender(form({ name: "other-trigger" }));
  assert.deepEqual(backend.cancels(), [callId]);
  assert.ok(backend.reads().slice(2).every((r) => r.args.name === "other-trigger"));
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
  test(`while the host can't be used (${down.kind}), the last fires stay, dimmed, with their read time, and are read every 60 s`, async () => {
    const backend = fakeBackend();
    const root = await render(form());
    await openFires(root);
    await act(async () => backend.reads()[0].answer(recordedFires()));
    const readAt = formatClock(NOW);
    await tick(15_000);
    await act(async () => backend.reads()[1].answer(down));
    assert.ok(list(root), "the last list is still shown");
    assert.equal(rows(root).length, 3);
    assert.match(list(root)!.className, /opacity-50/);
    assert.match(text(root), /may be out of date/);
    assert.ok(text(root).includes(`read at ${readAt}`));
    assert.ok(text(root).includes((down as { message: string }).message));
    await tick(59_999);
    assert.equal(backend.reads().length, 2);
    await tick(1);
    assert.equal(backend.reads().length, 3);
    await act(async () => backend.reads()[2].answer(recordedFires()));
    assert.doesNotMatch(list(root)!.className, /opacity-50/, "undimmed once the host answers");
    await tick(15_000);
    assert.equal(backend.reads().length, 4, "back to 15 s");
  });
}

test("a refusal that isn't the host's keeps the list undimmed and says why", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openFires(root);
  await act(async () => backend.reads()[0].answer(recordedFires()));
  await tick(15_000);
  const record = recordedTrigger("triggers fires: not submitted");
  await act(async () => backend.reads()[1].answer({ kind: "hostRefused", message: String(record.message), hostCode: String(record.hostCode), record }));
  assert.doesNotMatch(list(root)!.className, /opacity-50/);
  assert.match(text(root), new RegExp(`The host has no trigger ${NAME}, so it has no fires\.`));
});

test("only the newest read's answer is kept: an older read's late answer is dropped", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openFires(root);
  await act(async () => backend.reads()[0].answer(page(Array.from({ length: 20 }, (_, i) => fire(40 - i)), 21)));
  await tick(15_000);
  // A poll is in flight when Show more asks again; the newer read answers first.
  assert.equal(backend.reads().length, 2);
  await click(button(root, /^Show more$/));
  assert.equal(backend.reads().length, 3);
  await act(async () => backend.reads()[2].answer(page(Array.from({ length: 30 }, (_, i) => fire(40 - i)))));
  await act(async () => backend.reads()[1].answer(page([fire(1)])));
  assert.equal(rows(root).length, 30);
});

test("20 fires are shown; Show more raises the limit to the host's cap of 100 and says so at the cap", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openFires(root);
  await act(async () => backend.reads()[0].answer(page(Array.from({ length: 20 }, (_, i) => fire(300 - i)), 281)));
  assert.equal(rows(root).length, 20);
  assert.doesNotMatch(text(root), /newest 100/);
  await click(button(root, /^Show more$/));
  assert.equal(backend.reads()[1].args.limit, 100);
  await act(async () => backend.reads()[1].answer(page(Array.from({ length: 100 }, (_, i) => fire(300 - i)), 201)));
  assert.equal(rows(root).length, 100);
  assert.equal(button(root, /^Show more$/), undefined);
  assert.match(text(root), /Showing the newest 100 fires, the most the host gives at once\. Older fires aren't shown\./);
  await tick(15_000);
  assert.equal(backend.reads()[2].args.limit, 100, "the raised limit holds for the polls that follow");
});

test("a page the host says is the last offers no Show more and no cap note, even when it is full", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openFires(root);
  await act(async () => backend.reads()[0].answer(page(Array.from({ length: 20 }, (_, i) => fire(20 - i)), null)));
  assert.equal(rows(root).length, 20);
  assert.equal(button(root, /^Show more$/), undefined);
  assert.doesNotMatch(text(root), /newest 100/);
});

test("a trigger with no fires says so", async () => {
  const backend = fakeBackend();
  const root = await render(form({ name: "later" }));
  await openFires(root);
  await act(async () => backend.reads()[0].answer({ kind: "record", record: recordedTrigger("triggers fires: none") }));
  assert.match(text(root), /The host has no fires of later\./);
  assert.equal(list(root), null);
});

test("a skipped fire says how many slots it stands for", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openFires(root);
  await act(async () =>
    backend.reads()[0].answer(page([fire(2, { disposition: "SKIPPED", reason: "CATCH_UP_SKIPPED", skipped: { from: "a", to: "b", count: 3 } })])),
  );
  const [skipped] = rows(root);
  assert.match(text(skipped), /SKIPPED/);
  assert.match(text(skipped), /CATCH_UP_SKIPPED/);
  assert.match(text(skipped), /3 slots/);
});

test("a fire that created a graph run links to that run in the target graph workflow's Runs view", async () => {
  const backend = fakeBackend();
  const shown: [string, string][] = [];
  const root = await render(form({ onShowRun: (workflow, workOrderId) => void shown.push([workflow, workOrderId]) }));
  await openFires(root);
  await act(async () => backend.reads()[0].answer(recordedFires()));
  const [refused, , admitted] = rows(root);
  assert.equal(button(refused, /^Show the run/), undefined, "a refused fire created no run");
  await click(button(admitted, /^Show the run fire 1 created in the Runs of release-review$/));
  assert.deepEqual(shown, [[WORKFLOW, RECORDED_RUN]]);
  assert.deepEqual(backend.opened(), [], "the run is shown in Quay, not opened in the browser");
});

test("without a saved target to show it in, a fire's run has no link", async () => {
  const backend = fakeBackend();
  const root = await render(form({ workflow: null }));
  await openFires(root);
  await act(async () => backend.reads()[0].answer(recordedFires()));
  assert.equal(button(root, /^Show the run/), undefined);
});

test("a name the host refuses is never sent to praxis", async () => {
  const backend = fakeBackend();
  const root = await render(form({ state: { kind: "nameRefused", rule: "lower-case" } }));
  await openFires(root);
  assert.match(text(root), /Quay doesn't send praxis a name the host refuses\./);
  await tick(10 * 60_000);
  assert.equal(backend.reads().length, 0);
  assert.equal(button(root, /^Read again$/), undefined);
});

test("the Fires panel has no fire, admit, reject or enable control", async () => {
  const backend = fakeBackend();
  const root = await render(form());
  await openFires(root);
  await act(async () => backend.reads()[0].answer(recordedFires()));
  const section = [...root.querySelectorAll("section")].find((s) => text(s.querySelector("h3")) === "Fires");
  assert.ok(section, "the Fires panel");
  const labels = [...section.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? text(b).trim());
  assert.deepEqual(labels.filter((l) => /\b(fire|admit|reject|enable)\b/i.test(l) && !/^Show the run fire \d+ created/.test(l)), []);
});

test("without what the Fires panel needs from the builder, the form draws none", async () => {
  fakeBackend();
  const root = await render(createElement(TriggerForm, { ...form().props, fires: undefined }));
  assert.equal(button(root, /^Show fires$/), undefined);
});
