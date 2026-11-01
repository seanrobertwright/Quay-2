/// <reference types="node" />
// Component tests for starting a template run (#362, #454): Run in the Runs view header, its
// confirm dialog over a fresh `workflows show`, and every outcome of `praxis run <name> --json`.
// They render the real template form and the real host catalog into happy-dom and fake only
// Tauri's `invoke`, the out-of-process boundary, answering it with the outcomes the Praxis CLI
// runner gives for the fake praxis's replays.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createNewDraft, type Draft } from "./drafts.ts";
import { createHostCatalog, type HostCatalog } from "./hostCatalog.ts";
import type { TemplateHost } from "./HostStatusLine.tsx";
import type { CallOutcome } from "./praxisHost.ts";
import { runsRecord } from "./fixtures/runs.ts";
import { createRunStarts } from "./runStart.ts";
import type { ChangeStatus } from "./types.ts";

const { TemplateForm } = await import("./TemplateForm.tsx");

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const NAME = "review-code";
const LOCAL_DIGEST = "a".repeat(64);
const OTHER_DIGEST = "f".repeat(64);
const PAGE = "https://praxis-abcdefghij.localhost:7443/#work-order=wo-new";
const BLOCKING_PAGE = "https://praxis-abcdefghij.localhost:7443/#work-order=wo-held";

// Each test has its own project, so a creation one test leaves in flight can't reach another.
let projectN = 0;
let project = "";
let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  projectN += 1;
  project = `C:/project-${projectN}`;
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
});
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  mock.timers.reset();
});

/** The host's copy of the template, as `workflows show` describes it. */
interface HostCopy {
  installed?: boolean;
  digest?: string;
  revision?: number;
  runnable?: boolean;
  reasons?: string[];
}

const listRecord = (copy: HostCopy): CallOutcome => ({
  kind: "record",
  record: {
    format: "aiws-workflow-catalog/1",
    templates: copy.installed === false ? [] : [{ name: NAME, revision: copy.revision ?? 3, validity: "VALID", diagnostics: [] }],
  },
});

const showRecord = (copy: HostCopy): CallOutcome => ({
  kind: "record",
  record: {
    format: "aiws-workflow-catalog/1",
    name: NAME,
    revision: copy.revision ?? 3,
    validity: "VALID",
    diagnostics: [],
    templateDigest: copy.digest ?? LOCAL_DIGEST,
    readiness: { reasons: copy.reasons ?? [] },
    runnable: copy.runnable ?? true,
  },
});

/** `aiws-workflow-run-result/1` as `praxis run` prints it, with its `runPageAddress`. */
const created = (workOrderId = "wo-new"): CallOutcome => ({
  kind: "record",
  record: {
    format: "aiws-workflow-run-result/1",
    requestId: "3f2c8a1e-5b7d-4c9e-8a6f-1d2e3c4b5a69",
    disposition: "COMMITTED",
    workOrderId,
    runId: "run-new",
    revision: 1,
    status: "AWAITING_APPROVAL",
    runPageAddress: PAGE,
  },
});

interface Sent {
  command: string;
  args: Record<string, unknown>;
  answer: (value: unknown) => void;
}

/**
 * The backend. Catalog reads answer at once from `host`, which a test may change; a show is held
 * while `holdShow` is set. Runs lists, run creations and statuses wait for the test.
 */
function fakeBackend(initial: HostCopy = {}) {
  const sent: Sent[] = [];
  const state = { host: initial, holdShow: false };
  fakeInvoke(
    (command, args) =>
      new Promise((resolve, reject) => {
        sent.push({ command, args, answer: resolve });
        switch (command) {
          case "praxis_validate":
            return resolve({ verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } });
          case "praxis_host_workflows_list":
            return resolve(listRecord(state.host));
          case "praxis_host_workflow_show":
            return state.holdShow ? undefined : resolve(showRecord(state.host));
          case "praxis_host_runs":
          case "praxis_host_run":
          case "praxis_host_status":
            return;
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
    state,
    sent,
    shows: () => of("praxis_host_workflow_show"),
    runCalls: () => of("praxis_host_run"),
    reads: () => of("praxis_host_runs"),
    statuses: () => of("praxis_host_status"),
    opened: () => of("plugin:opener|open_url").map((s) => s.args.url),
  };
}

interface FormOptions {
  draft?: Draft;
  changed?: ChangeStatus | "unknown";
  onInstall?: () => void;
}

let catalog: HostCatalog | null = null;
let options: FormOptions = {};

function hostOf(c: HostCatalog): TemplateHost {
  return { view: c.template(NAME), condition: { state: "signedIn" }, copy: c.hostCopy(NAME), onCheckAgain: () => void c.checkAgain(NAME) };
}

function savedDraft(): Draft {
  const made = createNewDraft({ kind: "templates", id: NAME }, {});
  assert.ok(made.ok);
  return { ...made.value, baseHash: "saved" };
}

function form() {
  return createElement(TemplateForm, {
    draft: options.draft ?? savedDraft(),
    onEdit: () => {},
    onValidated: () => {},
    onInstall: options.onInstall ?? (() => {}),
    host: catalog ? hostOf(catalog) : null,
    runs: { projectPath: project, shown: true, changed: options.changed },
  });
}

/**
 * Renders the template's Runs view over a real host catalog that has read the host once, as the
 * builder's Workflow templates group does when it is shown.
 */
async function renderRuns(opts: FormOptions = {}): Promise<HTMLElement> {
  options = opts;
  const made = createHostCatalog({ projectPath: project });
  catalog = made;
  made.setLocal([{ name: NAME, digest: LOCAL_DIGEST, nameProblem: null }]);
  made.setCondition({ state: "signedIn" });
  made.subscribe(() => mounted?.root.render(form()));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(form()));
  await act(async () => made.groupShown());
  await click(button(container, /^Runs$/));
  return container;
}

const text = (el: Element | null) => el?.textContent ?? "";
const button = (root: Element, name: RegExp) =>
  [...root.querySelectorAll("button")].find((b) => name.test(b.getAttribute("aria-label") ?? text(b))) as HTMLButtonElement | undefined;
const click = (el: HTMLElement | undefined) => act(async () => el?.click());
const flush = () => act(async () => {});
const lastOf = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];
const runButton = (root: HTMLElement) => button(root.querySelector("header") as Element, /^Run$/);
const dialog = (root: HTMLElement) => root.querySelector('[role="dialog"]') as HTMLElement | null;

test("Run sits in the Runs view header, disabled with show's reasons when the host can't run the template", async () => {
  fakeBackend({ runnable: false, reasons: ["The agent does not declare TOOL node."] });
  const root = await renderRuns();
  const run = runButton(root);
  assert.ok(run, "Run is in the header");
  assert.equal(run.getAttribute("aria-disabled"), "true");
  const reasonId = run.getAttribute("aria-describedby");
  assert.ok(reasonId);
  assert.match(text(root.querySelector(`[id="${reasonId}"]`)), /The agent does not declare TOOL node\./);
  await click(run);
  assert.equal(dialog(root), null, "a disabled Run opens nothing");
});

test("the confirm says the host's installed copy runs, with its revision and digest, after one fresh workflows show", async () => {
  const backend = fakeBackend({ revision: 4 });
  const root = await renderRuns();
  const showsBefore = backend.shows().length;
  backend.state.holdShow = true;
  await click(runButton(root));
  const confirm = dialog(root);
  assert.ok(confirm, "Run opens the confirm");
  assert.equal(confirm.getAttribute("aria-modal"), "true");
  assert.equal(backend.shows().length, showsBefore + 1, "opening it runs one fresh show");
  assert.equal(lastOf(backend.shows())?.args.name, NAME);
  assert.match(text(confirm), /The host runs its installed copy of review-code, not the file in this project/);
  assert.match(text(confirm), /Checking the host's copy/);
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "true", "Run waits for the fresh show");
  // The host's copy changed since the list was read: the fresh show says so.
  backend.state.host = { revision: 5, digest: OTHER_DIGEST };
  await act(async () => lastOf(backend.shows())?.answer(showRecord(backend.state.host)));
  assert.match(text(confirm), new RegExp(`Revision 5, digest ${OTHER_DIGEST}`));
  assert.match(text(confirm), /Warning: The host's installed copy differs from the saved file/);
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "false");
  // The fresh show refreshed the template's host state outside the dialog too.
  assert.deepEqual(catalog?.template(NAME).state, { kind: "differs" });
  assert.equal(backend.runCalls().length, 0, "nothing runs before Start run");
});

test("the confirm warns when the host doesn't have the template, and withholds Start run", async () => {
  fakeBackend({ installed: false });
  const root = await renderRuns();
  await click(runButton(root));
  const confirm = dialog(root) as HTMLElement;
  await flush();
  assert.match(text(confirm), /Warning: The host doesn't have this template installed/);
  assert.ok(button(confirm, /^Install on host…$/));
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "true");
});

test("the confirm warns when the fresh show finds the host's copy isn't ready, with show's reasons", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  backend.state.host = { runnable: false, reasons: ["The agent does not declare TOOL node."] };
  await click(runButton(root));
  const confirm = dialog(root) as HTMLElement;
  assert.match(text(confirm), /Warning: The host's copy isn't ready to run: The agent does not declare TOOL node\./);
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "true");
});

test("the confirm warns about unsaved and uncommitted edits, linking Install on host…", async () => {
  fakeBackend();
  let installs = 0;
  const unsavedDraft = { ...savedDraft(), fingerprint: "edited" };
  const root = await renderRuns({ draft: unsavedDraft, changed: "modified", onInstall: () => (installs += 1) });
  await click(runButton(root));
  const confirm = dialog(root) as HTMLElement;
  assert.match(text(confirm), /Warning: The draft has unsaved changes/);
  assert.match(text(confirm), /Warning: The template file has changes that aren't committed/);
  assert.doesNotMatch(text(confirm), /differs/);
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "false", "edits warn but don't stop a run");
  await click(button(confirm, /^Install on host…$/));
  assert.equal(installs, 1);
  assert.equal(dialog(root), null, "Install on host… takes the place of the confirm");
});

test("a git status Quay couldn't read is a warning of its own", async () => {
  fakeBackend();
  const root = await renderRuns({ changed: "unknown" });
  await click(runButton(root));
  assert.match(text(dialog(root)), /Warning: Quay couldn't read git status/);
});

test("the confirm keeps focus inside it and gives it back to Run when it closes", async () => {
  fakeBackend();
  const root = await renderRuns();
  const run = runButton(root) as HTMLButtonElement;
  run.focus();
  await click(run);
  const confirm = dialog(root) as HTMLElement;
  const controls = [...confirm.querySelectorAll("button")];
  assert.ok(confirm.contains(document.activeElement), "focus moves into the dialog");
  const press = (key: string, shiftKey = false) =>
    act(async () => void (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true })));
  lastOf(controls)?.focus();
  await press("Tab");
  assert.equal(document.activeElement, controls[0], "Tab from the last control wraps to the first");
  await press("Tab", true);
  assert.equal(document.activeElement, lastOf(controls), "Shift+Tab from the first wraps to the last");
  await press("Escape");
  assert.equal(dialog(root), null, "Escape closes it");
  assert.equal(document.activeElement, runButton(root), "focus is back on Run");
  await click(runButton(root));
  await click(button(dialog(root) as HTMLElement, /^Cancel$/));
  assert.equal(document.activeElement, runButton(root));
});

/** Opens the confirm, presses Start run, and returns the `praxis_host_run` call it sent. */
async function startRun(backend: ReturnType<typeof fakeBackend>, root: HTMLElement): Promise<Sent> {
  const before = backend.runCalls().length;
  await click(runButton(root));
  await click(button(dialog(root) as HTMLElement, /^Start run$/));
  assert.equal(backend.runCalls().length, before + 1, "Start run sends one praxis run");
  return backend.runCalls()[before];
}

const notice = (root: HTMLElement, label: string) => root.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;

test("Run is a headless praxis run of the template's name through the runner, and Run is disabled while it is in flight", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  assert.deepEqual(Object.keys(call.args).sort(), ["callId", "name", "projectPath"], "no flag such as --follow is passed");
  assert.equal(call.args.name, NAME);
  assert.equal(call.args.projectPath, project);
  assert.equal(dialog(root), null);
  const run = runButton(root) as HTMLButtonElement;
  assert.equal(run.getAttribute("aria-disabled"), "true");
  assert.match(text(root.querySelector(`[id="${run.getAttribute("aria-describedby")}"]`)), /Starting a run of review-code/);
  await click(run);
  assert.equal(dialog(root), null, "a Run in flight can't be pressed again");
  await act(async () => call.answer(created()));
  assert.equal(runButton(root)?.getAttribute("aria-disabled"), "false");
});

test("exit 0 selects and follows the new run, and a toast offers Open in browser", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  await act(async () => backend.reads()[0].answer(runsRecord(NAME, [])));
  const call = await startRun(backend, root);
  await act(async () => call.answer(created()));
  assert.ok(backend.statuses().some((s) => s.args.workOrderId === "wo-new"), "the new run's detail follows it");
  assert.equal(backend.reads().length, 2, "the list is read again at once");
  const newRun = { workOrderId: "wo-new", runId: "run-new", revision: 1, createdAt: "2026-11-01T12:00:00.000Z", status: "AWAITING_APPROVAL", stage: "IMPLEMENTATION", control: "RUNNING", held: false };
  await act(async () => backend.reads()[1].answer(runsRecord(NAME, [newRun])));
  assert.equal(button(root, /^Show run-new$/)?.getAttribute("aria-pressed"), "true", "the new run is selected");
  const toast = notice(root, "Run started") as HTMLElement;
  assert.equal(toast.getAttribute("role"), "status");
  assert.match(text(toast), /Started run-new of review-code/);
  await click(button(toast, /^Open in browser$/));
  await flush();
  assert.deepEqual(backend.opened(), [PAGE]);
});

test("exit 7 says a held run blocks new runs, with Show run and Open in browser at blockingRunAddress", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  const record = { format: "aiws-workflow-run-error/1", code: "WORKFLOW_RUN_HELD", commitStatus: "NOT_COMMITTED", blockingWorkOrderId: "wo-held", blockingRunAddress: BLOCKING_PAGE };
  await act(async () => call.answer({ kind: "blocked", record, blockingRunAddress: BLOCKING_PAGE }));
  const shown = notice(root, "Run not started") as HTMLElement;
  assert.match(text(shown), /A held run of this template blocks new runs of review-code/);
  await click(button(shown, /^Open in browser$/));
  await flush();
  assert.deepEqual(backend.opened(), [BLOCKING_PAGE]);
  await click(button(shown, /^Show run$/));
  assert.ok(backend.statuses().some((s) => s.args.workOrderId === "wo-held"), "Show run opens the blocking run's detail");
});

test("exit 7 for a run awaiting approval names that", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  const record = { format: "aiws-workflow-run-error/1", code: "WORKFLOW_RUN_PENDING_APPROVAL", commitStatus: "NOT_COMMITTED", blockingWorkOrderId: "wo-held" };
  await act(async () => call.answer({ kind: "blocked", record, blockingRunAddress: BLOCKING_PAGE }));
  assert.match(text(notice(root, "Run not started")), /A run of this template awaiting approval blocks new runs/);
});

test("exit 1 for host down, signed out and expired each get their own message", async () => {
  const cases: [CallOutcome, RegExp][] = [
    [{ kind: "hostDown", message: "praxis: Could not connect to the host at https://127.0.0.1:7443; is it running?" }, /The Praxis host isn't answering.*Start the host/],
    [{ kind: "notSignedIn", message: "praxis: There is no CLI session for this host" }, /isn't signed in to this host.*Sign in/],
    [{ kind: "expired", message: "praxis: The host did not accept the CLI session (UNAUTHENTICATED)." }, /session on this host has expired.*Sign in again/],
    [{ kind: "noHost", message: "praxis: There is no Praxis host connection descriptor at C:/x." }, /No Praxis host is set up.*Set up a host/],
  ];
  const backend = fakeBackend();
  const root = await renderRuns();
  for (const [outcome, expected] of cases) {
    const call = await startRun(backend, root);
    await act(async () => call.answer(outcome));
    const shown = notice(root, "Run not started") as HTMLElement;
    assert.match(text(shown), expected, outcome.kind);
    assert.equal(button(shown, /^Copy$/), undefined, `${outcome.kind} has its own words, not praxis's`);
  }
});

test("every other refusal is shown verbatim with Copy, which copies it and says so", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  const words = "praxis: The host refused the run (READINESS_BLOCKED): Required capability TOOL node is not supported.";
  await act(async () => call.answer({ kind: "refused", message: words }));
  const shown = notice(root, "Run not started") as HTMLElement;
  assert.ok(text(shown).includes(words));
  await click(button(shown, /^Copy$/));
  await flush();
  assert.equal(await navigator.clipboard.readText(), words);
  assert.match(text(shown), /Copied praxis's words/);
});

test("exit 2 or an unknown format says Quay needs an update for this praxis", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const outcomes: CallOutcome[] = [
    { kind: "needsUpdate", detail: "praxis didn't accept Quay's arguments: praxis: unknown option" },
    { kind: "needsUpdate", detail: "praxis printed a aiws-workflow-run-result/2 record, and this Quay reads aiws-workflow-run-result/1." },
    { kind: "record", record: { format: "aiws-workflow-run-result/1" } },
  ];
  for (const outcome of outcomes) {
    const call = await startRun(backend, root);
    await act(async () => call.answer(outcome));
    assert.match(text(notice(root, "Run not started")), /Quay needs an update for this praxis/);
  }
});

test("an unknown outcome says Run again can't create a second run", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  await act(async () => call.answer({ kind: "unknown", detail: "praxis exited with 9. praxis: something broke" }));
  assert.match(text(notice(root, "Run not started")), /something broke.*Run again finishes it and can't create a second run/);
});

test("after Quay's own timeout nothing is retried, and Run again resumes the pending creation", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const first = await startRun(backend, root);
  await act(async () => first.answer({ kind: "timedOut" }));
  assert.match(text(notice(root, "Run not started")), /within 75 s.*Run again finishes it and can't create a second run/);
  await act(async () => mock.timers.tick(10 * 60_000));
  assert.equal(backend.runCalls().length, 1, "Quay never runs a creation again by itself");
  // Run again is the same praxis run, which praxis resumes from its profile.
  const again = await startRun(backend, root);
  assert.equal(again.args.name, first.args.name);
  assert.equal(again.args.projectPath, first.args.projectPath);
  await act(async () => again.answer(created()));
  assert.match(text(notice(root, "Run started")), /Started run-new/);
});

test("a creation in flight when the Runs view leaves the screen is joined when it comes back", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  await click(button(root, /^Template$/));
  await click(button(root, /^Runs$/));
  assert.equal(runButton(root)?.getAttribute("aria-disabled"), "true", "Run stays disabled while the creation runs");
  await act(async () => call.answer(created()));
  assert.match(text(notice(root, "Run started")), /Started run-new/);
  assert.equal(backend.runCalls().length, 1, "the creation was joined, not run twice");
});

test("a second Run of the same name while one is in flight joins it rather than starting another", async () => {
  const answers: ((value: unknown) => void)[] = [];
  const sentNames: unknown[] = [];
  const starts = createRunStarts((command, args) => {
    sentNames.push(`${command} ${String(args.name)}`);
    return new Promise((resolve) => answers.push(resolve));
  });
  const first = starts.start("C:/p", NAME);
  const second = starts.start("C:/p", NAME);
  assert.equal(first, second);
  assert.ok(starts.inFlight("C:/p", NAME));
  starts.start("C:/p", "other-template");
  assert.deepEqual(sentNames, [`praxis_host_run ${NAME}`, "praxis_host_run other-template"]);
  answers[0](created());
  assert.equal((await first).kind, "created");
  assert.equal(starts.inFlight("C:/p", NAME), null, "an ended creation leaves nothing to join");
});
