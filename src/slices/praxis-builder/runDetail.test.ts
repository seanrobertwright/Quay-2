/// <reference types="node" />
// Component tests for a template run's detail (#453): the run drawn live on the template's
// read-only stage strip, followed by polled `praxis status`, with its banners and hold panel.
// They render the real template form into happy-dom and fake only Tauri's `invoke`, the
// out-of-process boundary, and the terminal the window opens.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createNewDraft } from "./drafts.ts";
import type { CallOutcome } from "./praxisHost.ts";
import { attempt, BROWSER_ORIGIN, operatorView, runEntry as entry, runsRecord, statusRecord } from "./fixtures/runs.ts";

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

interface Sent {
  command: string;
  args: Record<string, unknown>;
  answer: (value: unknown) => void;
}

/** The backend: the form's own reads answer at once; `praxis runs` and `praxis status` wait for the test. */
function fakeBackend() {
  const sent: Sent[] = [];
  fakeInvoke(
    (command, args) =>
      new Promise((resolve, reject) => {
        sent.push({ command, args, answer: resolve });
        switch (command) {
          case "praxis_validate":
            return resolve({ verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } });
          case "praxis_host_runs":
          case "praxis_host_status":
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
    lists: () => of("praxis_host_runs"),
    statuses: () => of("praxis_host_status"),
    cancels: () => of("praxis_host_cancel").map((s) => s.args.callId),
    opened: () => of("plugin:opener|open_url").map((s) => s.args.url),
    commands: () => sent.map((s) => s.command),
  };
}
type Backend = ReturnType<typeof fakeBackend>;

const terminals: { cwd: string; argv: string[] }[] = [];

function form(props: { shown?: boolean; maxCorrections?: number } = {}) {
  const draft = createNewDraft({ kind: "templates", id: NAME }, {});
  assert.ok(draft.ok);
  const content = { ...draft.value.content, maxCorrections: props.maxCorrections ?? 2 };
  return createElement(TemplateForm, {
    draft: { ...draft.value, content },
    onEdit: () => {},
    onValidated: () => {},
    onInstall: () => {},
    host: null,
    runs: {
      projectPath: PROJECT,
      shown: props.shown ?? true,
      runInTerminal: async (cwd: string, argv: string[]) => {
        terminals.push({ cwd, argv });
        return true;
      },
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
  await answer(backend.lists()[0], runsRecord(NAME, rows));
  await click(button(root, new RegExp(`^Show run-${n}$`)));
  return root;
}

const detail = (root: HTMLElement) => root.querySelector('[aria-label^="Run run-"]') as HTMLElement | null;
const strip = (root: HTMLElement) => detail(root)?.querySelector('[aria-label^="Stages of run"]') as HTMLElement | null;
const stage = (root: HTMLElement, label: string) =>
  [...(strip(root)?.querySelectorAll("li") ?? [])].find((li) => text(li.querySelector("[data-stage-label]")) === label) as HTMLElement;

test("showing a run reads praxis status for its work order and draws it on the template's stage strip, never the canvas", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  assert.equal(backend.statuses().length, 1);
  assert.equal(backend.statuses()[0].args.workOrderId, "wo-1");
  assert.equal(backend.statuses()[0].args.projectPath, PROJECT);
  const view = operatorView(1, {
    status: "READY",
    stage: "VALIDATION",
    attempts: [attempt("a3", "t-validation-2", 3, null), attempt("a2", "t-correction-1", 2), attempt("a1b", "t-validation-1", 1), attempt("a1", "t-implementation", 0)],
  });
  await answer(backend.statuses()[0], statusRecord(view));
  assert.ok(strip(root), "the stage strip is drawn");
  assert.equal(root.querySelector("canvas, .react-flow, [data-graph-canvas]"), null);
  assert.equal(stage(root, "Validation").getAttribute("aria-current"), "step");
  assert.match(text(stage(root, "Validation")), /Current/);
  for (const done of ["Approve", "Implementation", "Correction"]) {
    assert.match(text(stage(root, done)), /Finished/, done);
    assert.equal(stage(root, done).getAttribute("aria-current"), null, done);
  }
  assert.doesNotMatch(text(stage(root, "Acceptance")), /Finished|Current/);
  assert.match(text(stage(root, "Correction")), /1 correction round/);
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

const working = (n: number, extra: Record<string, unknown> = {}) => statusRecord(operatorView(1, { attempts: [attempt(`a${n}`, `t${n}`, n, null)], ...extra }));

test("a run is read every 3 s while it changes, doubling to 15 s while it doesn't, and every 60 s while the host is down", async () => {
  const backend = fakeBackend();
  await showRun(backend);
  await answer(backend.statuses()[0], working(0));
  await nextReadAfter(backend, 3_000, working(1));
  await nextReadAfter(backend, 3_000, working(1));
  await nextReadAfter(backend, 6_000, working(1));
  await nextReadAfter(backend, 12_000, working(1));
  await nextReadAfter(backend, 15_000, working(1));
  await nextReadAfter(backend, 15_000, { kind: "hostDown", message: "Nothing answered at https://127.0.0.1:7443; is it running?" });
  await nextReadAfter(backend, 60_000, { kind: "hostDown", message: "Nothing answered at https://127.0.0.1:7443; is it running?" });
  await nextReadAfter(backend, 60_000, working(2));
  await nextReadAfter(backend, 3_000, working(2));
  await nextReadAfter(backend, 6_000, working(2));
  // Every read went to praxis status, never follow.
  assert.ok(backend.commands().every((c) => c !== "praxis_host_follow"));
});

test("a held or awaiting run is read every 15 s straight away", async () => {
  for (const extra of [
    { status: "AWAITING_APPROVAL", pending: ["HUMAN_APPROVAL"] },
    { status: "AWAITING_ACCEPTANCE", pending: ["HUMAN_ACCEPTANCE"] },
    { status: "HELD", pending: ["RECONCILIATION"] },
    { status: "READY", pending: ["RECONCILIATION"] },
  ]) {
    const backend = fakeBackend();
    await showRun(backend);
    await answer(backend.statuses()[0], working(0));
    await nextReadAfter(backend, 3_000, working(1, extra));
    await nextReadAfter(backend, 15_000, working(1, extra));
    await nextReadAfter(backend, 15_000, working(1, extra));
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;
  }
});

test("an ended run is no longer read", async () => {
  for (const extra of [{ status: "SUCCEEDED" }, { control: { status: "CANCELED" } }]) {
    const backend = fakeBackend();
    const root = await showRun(backend);
    await answer(backend.statuses()[0], working(0, extra));
    await tick(10 * 60_000);
    assert.equal(backend.statuses().length, 1, JSON.stringify(extra));
    assert.match(text(detail(root)), /no longer read/);
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;
  }
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

test("the Runs list's stop triggers stop the followed run and kill its call", async () => {
  const leave: [string, (root: HTMLElement) => Promise<void>][] = [
    ["Template switch", (root) => click(button(root, /^Template$/))],
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
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;
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

test("only the newest answer is kept: a read answered after a newer one changes nothing", async () => {
  const backend = fakeBackend();
  const { root } = await following(backend);
  const stale = backend.statuses()[1];
  await act(async () => setWindowVisible(false));
  await act(async () => setWindowVisible(true));
  assert.equal(backend.statuses().length, 3, "showing the window again reads at once");
  await answer(backend.statuses()[2], working(5, { status: "AWAITING_APPROVAL", pending: ["HUMAN_APPROVAL"] }));
  await answer(stale, working(4, { status: "READY", stage: "VALIDATION" }));
  assert.equal(stage(root, "Approve").getAttribute("aria-current"), "step");
});

const awaiting = (extra: Record<string, unknown> = {}) =>
  operatorView(1, { status: "AWAITING_APPROVAL", stage: "IMPLEMENTATION", pending: ["HUMAN_APPROVAL"], ...extra });
const banner = (root: HTMLElement) => detail(root)?.querySelector('[aria-label="Waiting for a decision"]') as HTMLElement | null;
const header = (root: HTMLElement) => detail(root)?.querySelector("header") as HTMLElement;

test("Open in browser in the run header and in the waiting banner opens the run page praxis gave, on the host's browser origin", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(awaiting()));
  assert.match(text(banner(root)), /waits for approval, decided in the browser/);
  await click(button(header(root), /^Open in browser for run-1$/));
  await flush();
  await click(button(banner(root) as HTMLElement, /^Open in browser for run-1$/));
  await flush();
  assert.deepEqual(backend.opened(), [`${BROWSER_ORIGIN}/#work-order=wo-1`, `${BROWSER_ORIGIN}/#work-order=wo-1`]);
  assert.equal(backend.commands().filter((c) => c === "praxis_host_status").length, 1, "the address came from the followed read");
});

test("Open in browser opens a page on 127.0.0.1 too, and refuses any other address, saying so", async () => {
  for (const [address, opens] of [
    ["https://127.0.0.1:7443/#work-order=wo-1", true],
    ["https://praxis-a2b3c4d5e7.localhost:51234/#work-order=wo-1", true],
    ["https://example.com/#work-order=wo-1", false],
    ["http://praxis-abcdefghij.localhost:7443/#work-order=wo-1", false],
    ["https://praxis-abcdefgh01.localhost:7443/#work-order=wo-1", false],
    ["https://localhost:7443/#work-order=wo-1", false],
  ] as const) {
    const backend = fakeBackend();
    const root = await showRun(backend);
    await answer(backend.statuses()[0], statusRecord(awaiting({ runPageAddress: address })));
    await click(button(header(root), /^Open in browser for run-1$/));
    await flush();
    assert.deepEqual(backend.opened(), opens ? [address] : [], address);
    if (!opens) assert.match(text(detail(root)), /Quay opens only pages on this machine's Praxis host/, address);
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;
  }
});

test("a run that waits for nothing has no waiting banner", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], working(0));
  assert.equal(banner(root), null);
  assert.ok(button(header(root), /^Open in browser for run-1$/), "the header still opens the run's page");
});

/** A hold card as `aiws-hold-card/1` gives it at the SDK pin, with the fields the panel draws. */
const holdCard = {
  format: "aiws-hold-card/1",
  holdId: "hold-1",
  stage: "VALIDATION",
  reasonText: "Validation failed and no corrections are left",
  cause: "The validation command exited with 1 after the last correction.",
  evidence: "3 tests failed.",
  notes: ["The run used 4 of its 5 attempts."],
  phaseText: "Raised after the attempt committed.",
  exits: [
    { exit: "ABANDON", label: "Abandon the run", does: "Ends the run without success.", available: true, unavailable: null, command: null },
    { exit: "EXTEND", label: "Allow another correction", does: "Raises the correction limit by one.", available: false, unavailable: "Needs a governed command.", command: null },
  ],
};
const panel = (root: HTMLElement) => [...(detail(root)?.querySelectorAll('[role="region"]') ?? [])].find((r) => /^Held:/.test(text(r))) as HTMLElement | undefined;

test("a held run gets a Held badge, its stopping stage marked on the strip, and a hold panel from its holdCard with Resolve in browser", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true, status: "HELD" })]);
  await answer(
    backend.statuses()[0],
    statusRecord(operatorView(1, { status: "HELD", stage: "CORRECTION", pending: ["HOLD_DECISION", "RECONCILIATION"], holdCard })),
  );
  assert.match(text(header(root)), /Held/);
  assert.match(text(stage(root, "Validation")), /Held here/, "the strip marks the stage the hold card names");
  assert.equal(stage(root, "Validation").getAttribute("aria-current"), "step");
  const hold = panel(root);
  assert.ok(hold, "the hold panel is shown");
  assert.match(text(hold), /Held: Validation failed and no corrections are left/);
  assert.match(text(hold), /The validation command exited with 1 after the last correction\./);
  assert.match(text(hold), /3 tests failed\./);
  assert.match(text(hold), /The run used 4 of its 5 attempts\./);
  assert.match(text(hold), /Abandon the run: Ends the run without success\./);
  assert.match(text(hold), /Allow another correction: Raises the correction limit by one\. \(not available now\)/);
  assert.equal(banner(root), null, "the hold panel stands in for the waiting banner");
  await click(button(hold, /^Resolve in browser for run-1$/));
  await flush();
  assert.deepEqual(backend.opened(), [`${BROWSER_ORIGIN}/#work-order=wo-1`]);
  // The exits are words, never controls: only Resolve in browser is a button in the panel.
  assert.deepEqual(buttons(hold).map((b) => text(b)), ["Resolve in browser"]);
});

test("a run with reconciliation pending and no hold card is held too, with the run's reason in the panel", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(operatorView(1, { status: "READY", stage: "IMPLEMENTATION", reason: "ATTEMPT_UNKNOWN", pending: ["RECONCILIATION"] })));
  assert.match(text(header(root)), /Held/);
  assert.match(text(stage(root, "Implementation")), /Held here/);
  assert.match(text(panel(root)), /Held: ATTEMPT_UNKNOWN/);
  assert.ok(button(panel(root) as HTMLElement, /^Resolve in browser for run-1$/));
});

test("Quay never runs praxis hold or praxis open, and the detail has no approve, pause, cancel or hold control", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { held: true })]);
  await answer(backend.statuses()[0], statusRecord(operatorView(1, { status: "HELD", pending: ["HOLD_DECISION", "RESUME_CONTROL"], control: { status: "PAUSED" }, holdCard })));
  const names = buttons(detail(root) as HTMLElement).map((b) => `${b.getAttribute("aria-label") ?? ""} ${text(b)}`);
  for (const name of names) assert.doesNotMatch(name, /approve|accept|pause|resume|cancel|abandon|hold|reconcile|extend/i, name);
  assert.equal(detail(root)?.querySelectorAll("[aria-disabled], button[disabled]").length, 0, "not even disabled ones");
  for (const s of backend.sent) {
    assert.ok(["praxis_validate", "praxis_host_runs", "praxis_host_status", "praxis_host_cancel"].includes(s.command), s.command);
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
  await answer(backend.statuses()[0], statusRecord(operatorView(1, { status: "HELD", pending: ["HOLD_DECISION"], holdCard }), TRUST_HINT));
  assert.ok(button(panel(root) as HTMLElement, /^Trust certificate$/));
});

test("without the hint, or with one praxis trust can't help, there is no Trust certificate", async () => {
  for (const hint of [undefined, "Your browser does not trust this host's certificate; its trust is the host operator's."]) {
    const backend = fakeBackend();
    const root = await showRun(backend);
    await answer(backend.statuses()[0], statusRecord(awaiting(), hint));
    assert.equal(button(detail(root) as HTMLElement, /^Trust certificate$/), undefined, String(hint));
    if (hint) assert.ok(text(banner(root)).includes(hint), "the hint itself is still shown");
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;
  }
});

test("the certificate hint goes when a later status gives none", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(awaiting(), TRUST_HINT));
  await nextReadAfter(backend, 15_000, statusRecord(awaiting()));
  assert.equal(button(detail(root) as HTMLElement, /^Trust certificate$/), undefined);
});

test("the detail reads only the fields it draws, leniently, falling back to the run's row", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1, { status: "RUNNING", stage: "VALIDATION", control: "PAUSED", revision: 7 })]);
  assert.match(text(header(root)), /RUNNING/, "before the first status read, the row is drawn");
  assert.equal(stage(root, "Validation").getAttribute("aria-current"), "step");
  // A view missing or mistyping every drawn field but its format: each falls back to the row.
  await answer(
    backend.statuses()[0],
    statusRecord({ format: "coding-operator-view/1", workOrderId: "wo-1", status: 3, stage: null, control: "x", attempts: "none", pending: {}, somethingNew: [1] }),
  );
  assert.match(text(header(root)), /RUNNING/);
  assert.match(text(header(root)), /PAUSED/);
  assert.match(text(header(root)), /revision 7/);
  assert.equal(stage(root, "Validation").getAttribute("aria-current"), "step");
  assert.doesNotMatch(text(strip(root)), /correction round/);
});

test("a correction awaiting re-approval lights the correction stage and counts its rounds", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(
    backend.statuses()[0],
    statusRecord(
      awaiting({
        stage: "CORRECTION",
        attempts: [attempt("a1", "t-impl", 0), attempt("a2", "t-val-1", 1), attempt("a3", "t-cor-1", 2), attempt("a4", "t-val-2", 3), attempt("a5", "t-cor-2", 4), attempt("a6", "t-val-3", 5)],
      }),
    ),
  );
  assert.equal(stage(root, "Correction").getAttribute("aria-current"), "step");
  assert.match(text(stage(root, "Correction")), /2 correction rounds/);
  assert.match(text(banner(root)), /approval of the correction/);
});

test("a succeeded run checks every stage it passed and lights none", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(operatorView(1, { status: "SUCCEEDED", stage: "VALIDATION", attempts: [attempt("a1", "t-impl", 0), attempt("a2", "t-val", 1)] })));
  for (const done of ["Approve", "Implementation", "Validation", "Acceptance"]) assert.match(text(stage(root, done)), /Finished/, done);
  assert.doesNotMatch(text(stage(root, "Correction")), /Finished|Current/);
  assert.equal(strip(root)?.querySelector('[aria-current="step"]'), null);
});
