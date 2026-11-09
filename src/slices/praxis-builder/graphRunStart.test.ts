/// <reference types="node" />
// Component tests for starting a graph run (#444, #466): Run in a graph workflow's Runs header,
// its confirm over one fresh `graphs show`, and every outcome of `praxis run <name> --json`. They
// render the real graph workflow form and the real graph host model into happy-dom and fake only
// Tauri's `invoke`, the out-of-process boundary, answering it with the records the real praxis
// printed (graph_outputs.fixture.json) and the outcomes the Praxis CLI runner gives for the fake
// praxis's replays.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft, type Draft } from "./drafts.ts";
import { createGraphHost, type GraphHost } from "./graphHost.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";
import { graphRunEntry, graphRunsRecord } from "./fixtures/runs.ts";
import { createRunStarts, GRAPH_RUN } from "./runStart.ts";

const { GraphWorkflowForm } = await import("./GraphWorkflowForm.tsx");

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const NAME = "nightly-build";
const SIGNED_IN: HostCondition = { state: "signedIn" };

/** What the real `praxis --json` printed for each graph command, by case name. */
const recorded = JSON.parse(
  readFileSync(new URL("../../../src-tauri/src/slices/praxis/host/graph_outputs.fixture.json", import.meta.url), "utf8"),
) as { cases: { name: string; stdout: Record<string, unknown> }[] };
const stdout = (name: string) => structuredClone(recorded.cases.find((c) => c.name === name)!.stdout);

/** The digest the recorded bundle has, on every revision the recorded host holds. */
const RECORDED_DIGEST = "sha256:f29d05656810f1a352c2fa594710e4f01333ea7e1f8833708bdb6a915870474f";
const OTHER_DIGEST = `sha256:${"e".repeat(64)}`;
const REVIEW_DIGEST = `sha256:${"7".repeat(64)}`;

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
  graphs?.dispose();
  graphs = null;
  mock.timers.reset();
});

type Revision = Record<string, unknown>;

/** The recorded `graphs list`, holding `names`. */
function listRecord(names: string[]): CallOutcome {
  const record = stdout("graphs list");
  const base = (record.workflows as Record<string, unknown>[])[0];
  record.workflows = names.map((name) => ({ ...base, name }));
  record.nextAfter = null;
  return { kind: "record", record };
}

/**
 * The recorded `graphs show` of NAME changed as a test needs. By default revision 1 is admitted
 * and current, runnable, reviewed with REVIEW_DIGEST, and nothing is pending.
 */
function showRecord(change: { revisions?: (rs: Revision[]) => Revision[]; [field: string]: unknown } = {}): CallOutcome {
  const record = stdout("graphs show");
  record.name = NAME;
  record.revisions = (record.revisions as Revision[]).map((r, i) => ({ ...r, status: i === 0 ? "WITHDRAWN" : "CURRENT" }));
  Object.assign(record, {
    currentRevision: 1,
    runnable: true,
    pendingCount: 0,
    admissionPageAddress: null,
    review: { reviewDigest: REVIEW_DIGEST, computedAt: "2026-11-08T23:31:00.000Z", runnable: true, agents: [] },
  });
  const { revisions, ...fields } = change;
  if (revisions) record.revisions = revisions(record.revisions as Revision[]);
  Object.assign(record, fields);
  return { kind: "record", record };
}

/** Nothing of NAME was ever submitted: the list lacks it. */
const NOT_SUBMITTED = "notSubmitted" as const;

interface Sent {
  command: string;
  args: Record<string, unknown>;
  answer: (value: unknown) => void;
}

/**
 * The backend. The form's own reads and the host's `graphs list` and `graphs show` answer at once
 * from `state`, which a test may change; a show is held while `holdShow` is set. Runs lists, run
 * creations and statuses wait for the test.
 */
function fakeBackend(initial: CallOutcome | typeof NOT_SUBMITTED = showRecord()) {
  const sent: Sent[] = [];
  const state: {
    show: CallOutcome | typeof NOT_SUBMITTED;
    holdShow: boolean;
    changes: { path: string; status: string }[] | Error;
  } = { show: initial, holdShow: false, changes: [] };
  fakeInvoke(
    (command, args) =>
      new Promise((resolve, reject) => {
        sent.push({ command, args, answer: resolve });
        switch (command) {
          case "praxis_validate":
            return resolve({ verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } });
          case "praxis_check_graph_workflow":
            return resolve({ grants: ["grant-a"], diagnostics: [] });
          case "praxis_graph_workflow_triggers":
            return resolve({ ids: [], unchecked: [] });
          case "praxis_host_graphs_list":
            return resolve(listRecord(state.show === NOT_SUBMITTED ? [] : [NAME]));
          case "praxis_host_graph_show":
            if (state.holdShow) return;
            return resolve(state.show === NOT_SUBMITTED ? { kind: "refused", message: "not listed" } : state.show);
          case "praxis_graph_workflow_changes":
            return state.changes instanceof Error ? reject(state.changes) : resolve({ files: state.changes });
          case "praxis_host_graph_runs":
          case "praxis_host_graph_run":
          case "praxis_host_graph_status":
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
    shows: () => of("praxis_host_graph_show"),
    runCalls: () => of("praxis_host_graph_run"),
    reads: () => of("praxis_host_graph_runs"),
    statuses: () => of("praxis_host_graph_status"),
    changeReads: () => of("praxis_graph_workflow_changes"),
    opened: () => of("plugin:opener|open_url").map((s) => s.args.url),
  };
}

let graphs: GraphHost | null = null;
let unsavedKeys: ReadonlySet<string> = new Set();

function savedDraft(): Draft {
  const ref = { kind: "graph-workflows" as const, id: NAME };
  const content = { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" };
  const draft = createDraft(ref, { id: NAME, kind: "graph-workflows", missing: false, content, contentHash: "h" });
  assert.ok(draft.ok);
  return draft.value;
}

function form() {
  const host = graphs && {
    view: graphs.workflow(NAME),
    condition: SIGNED_IN,
    onCheckAgain: () => void graphs?.checkAgain(NAME),
    onWithdraw: () => assert.fail("no withdrawal in these tests"),
  };
  return createElement(GraphWorkflowForm, {
    projectPath: project,
    draft: savedDraft(),
    contracts: ["c"],
    graphs: ["g"],
    graphBindings: [{ id: "g-1", graphId: "g" }],
    refresh: 0,
    host,
    onEdit: () => {},
    onOpen: () => {},
    onValidated: () => {},
    runsShown: true,
    unsavedKeys,
  });
}

/**
 * Renders the graph workflow's Runs view over a real graph host model that has read the host
 * once, as the builder's Graph workflows group does when it is shown.
 */
async function renderRuns(opts: { localDigest?: string | null; unsaved?: string[] } = {}): Promise<HTMLElement> {
  unsavedKeys = new Set(opts.unsaved ?? []);
  const made = createGraphHost({ projectPath: project });
  graphs = made;
  made.setLocal([{ name: NAME, bundleDigest: opts.localDigest === undefined ? RECORDED_DIGEST : opts.localDigest, nameProblem: null }]);
  made.setCondition(SIGNED_IN);
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
const runButton = (root: HTMLElement) => button(root.querySelector("section > header") as Element, /^Run$/);
const dialog = (root: HTMLElement) => root.querySelector('[role="dialog"]') as HTMLElement | null;
const reasonOf = (root: HTMLElement, el: HTMLElement | undefined) => text(root.querySelector(`[id="${el?.getAttribute("aria-describedby")}"]`));

test("Run sits in the Runs header, disabled with the reason when the host has no admitted revision", async () => {
  const cases: [CallOutcome | typeof NOT_SUBMITTED, RegExp][] = [
    [NOT_SUBMITTED, /The host has no admitted revision of nightly-build to run/],
    // The recorded show: two pending candidates, nothing admitted.
    [showRecord({ revisions: (rs) => rs.map((r) => ({ ...r, status: "CANDIDATE" })), currentRevision: null, review: null }), /No revision of nightly-build is admitted yet/],
    [showRecord({ state: "RETIRED" }), /The owner retired nightly-build on the host/],
  ];
  for (const [show, reason] of cases) {
    fakeBackend(show);
    const root = await renderRuns();
    const run = runButton(root);
    assert.ok(run, "Run is in the Runs header");
    assert.equal(run.getAttribute("aria-disabled"), "true");
    assert.match(reasonOf(root, run), reason);
    await click(run);
    assert.equal(dialog(root), null, "a disabled Run opens nothing");
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;
  }
});

test("the confirm names the admitted revision and its review digest after one fresh graphs show, and says the run waits for approval", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const showsBefore = backend.shows().length;
  backend.state.holdShow = true;
  await click(runButton(root));
  const confirm = dialog(root);
  assert.ok(confirm, "Run opens the confirm");
  assert.equal(confirm.getAttribute("aria-modal"), "true");
  assert.equal(backend.shows().length, showsBefore + 1, "opening it runs one fresh show");
  assert.equal(lastOf(backend.shows())?.args.name, NAME);
  assert.equal(backend.changeReads().length, 1, "and reads the bundle's git status once");
  assert.deepEqual(lastOf(backend.changeReads())?.args, { projectPath: project, name: NAME });
  assert.match(text(confirm), /The host runs its admitted revision of nightly-build, not the files in this project/);
  assert.match(text(confirm), /The run waits for approval in the browser/);
  assert.match(text(confirm), /Checking the host's admitted revision/);
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "true", "Start run waits for the fresh show");
  // The owner admitted revision 2 since the list was read: the fresh show says so.
  const newer = `sha256:${"9".repeat(64)}`;
  backend.state.show = showRecord({
    revisions: (rs) => [{ ...rs[0], status: "CURRENT" }, { ...rs[1], status: "ADMITTED" }],
    currentRevision: 2,
    review: { reviewDigest: newer, computedAt: "2026-11-08T23:40:00.000Z", runnable: true, agents: [] },
  });
  await act(async () => lastOf(backend.shows())?.answer(backend.state.show));
  assert.match(text(confirm), new RegExp(`Admitted revision 2, review digest ${newer}`));
  assert.doesNotMatch(text(confirm), /Warning:/, "the saved files are the admitted revision's");
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "false");
  // The fresh show refreshed the graph workflow's host state outside the dialog too.
  assert.deepEqual(graphs?.workflow(NAME).state, { kind: "admitted", revision: 2 });
  assert.equal(backend.runCalls().length, 0, "nothing runs before Start run");
});

test("a review the host didn't give is named so", async () => {
  fakeBackend(showRecord({ review: null }));
  const root = await renderRuns();
  await click(runButton(root));
  assert.match(text(dialog(root)), /Admitted revision 1, review digest not given by the host/);
});

test("the confirm warns when the saved files differ from the admitted revision, even under a pending candidate", async () => {
  fakeBackend();
  const root = await renderRuns({ localDigest: OTHER_DIGEST });
  await click(runButton(root));
  let confirm = dialog(root) as HTMLElement;
  assert.match(text(confirm), /Warning: The saved files differ from admitted revision 1\. Revision 1 runs, not the saved files/);
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "false", "Differs warns but doesn't stop a run");
  await click(button(confirm, /^Cancel$/));

  // A candidate outranks Differs in the state, but admitted revision 1 is still what runs.
  const backend = fakeBackend(showRecord({ revisions: (rs) => [{ ...rs[0], status: "CANDIDATE" }, rs[1]], pendingCount: 1 }));
  await act(async () => graphs?.checkAgain(NAME));
  assert.equal(graphs?.workflow(NAME).state.kind, "candidate");
  assert.equal(runButton(root)?.getAttribute("aria-disabled"), "false", "an admitted revision runs while a candidate waits");
  await click(runButton(root));
  confirm = dialog(root) as HTMLElement;
  assert.match(text(confirm), /Warning: The saved files differ from admitted revision 1/);
  assert.equal(backend.runCalls().length, 0);
});

test("the confirm warns about unsaved edits and uncommitted changes to the bundle's files", async () => {
  const backend = fakeBackend();
  backend.state.changes = [
    { path: ".praxis/graphs/g.json", status: "modified" },
    { path: ".praxis/grants/grant-a.json", status: "added" },
  ];
  const root = await renderRuns({ unsaved: ["graphs/g", "grants/grant-a", "graphs/some-other-graph"] });
  await click(runButton(root));
  const confirm = dialog(root) as HTMLElement;
  assert.match(text(confirm), /Warning: Unsaved edits to graph g, grant grant-a don't run: admitted revision 1 runs\./);
  assert.match(text(confirm), /Warning: These files have changes that aren't committed: \.praxis\/graphs\/g\.json, \.praxis\/grants\/grant-a\.json\./);
  assert.doesNotMatch(text(confirm), /some-other-graph/, "only the bundle's records are named");
  assert.doesNotMatch(text(confirm), /differ/);
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "false", "edits warn but don't stop a run");
});

test("a git status Quay couldn't read is a warning of its own", async () => {
  const backend = fakeBackend();
  backend.state.changes = new Error("git: not found");
  const root = await renderRuns();
  await click(runButton(root));
  assert.match(text(dialog(root)), /Warning: Quay couldn't read git status, so it can't tell whether the bundle's files have changes that aren't committed: Error: git: not found/);
});

test("the confirm withholds Start run when its fresh show finds no admitted revision, or the read fails", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  backend.state.show = showRecord({ state: "RETIRED" });
  await click(runButton(root));
  let confirm = dialog(root) as HTMLElement;
  assert.match(text(confirm), /The owner retired nightly-build on the host/);
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "true");
  await click(button(confirm, /^Cancel$/));
  // The header's Run follows the fresh show too.
  assert.equal(runButton(root)?.getAttribute("aria-disabled"), "true");

  backend.state.show = { kind: "refused", message: "praxis: something broke" };
  await act(async () => graphs?.checkAgain(NAME));
  assert.equal(runButton(root)?.getAttribute("aria-disabled"), "false", "an unknown state leaves Run to the confirm's fresh read");
  await click(runButton(root));
  confirm = dialog(root) as HTMLElement;
  assert.match(text(confirm), /Quay couldn't read nightly-build's admitted revision from the host: praxis: something broke/);
  assert.equal(button(confirm, /^Start run$/)?.getAttribute("aria-disabled"), "true");
  await click(button(confirm, /^Start run$/));
  assert.equal(backend.runCalls().length, 0);
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
  await press("Escape");
  assert.equal(dialog(root), null, "Escape closes it");
  assert.equal(document.activeElement, runButton(root), "focus is back on Run");
});

/** Opens the confirm, presses Start run, and returns the `praxis_host_graph_run` call it sent. */
async function startRun(backend: ReturnType<typeof fakeBackend>, root: HTMLElement): Promise<Sent> {
  const before = backend.runCalls().length;
  await click(runButton(root));
  await click(button(dialog(root) as HTMLElement, /^Start run$/));
  assert.equal(backend.runCalls().length, before + 1, "Start run sends one praxis run");
  return backend.runCalls()[before];
}

const notice = (root: HTMLElement, label: string) => root.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;

/** The recorded `praxis run` of a graph workflow that created a run awaiting approval. */
const created = (): CallOutcome => ({ kind: "record", record: stdout("run: created") });
const CREATED_ID = "wo-5f263bc1-d259-48e1-bb3e-e6113225bb1b";
const CREATED_RUN = "run-93ccd6e7-27b6-48e6-8def-e5f45e725f3e";
const CREATED_PAGE = `https://praxis-nmdro7k3gf.localhost:49889/#work-order=${CREATED_ID}`;

test("Run is a headless praxis run of the graph workflow's name through the runner, and Run is disabled while it is in flight", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  assert.deepEqual(Object.keys(call.args).sort(), ["callId", "name", "projectPath"], "no flag such as --follow is passed");
  assert.equal(call.args.name, NAME);
  assert.equal(call.args.projectPath, project);
  assert.equal(dialog(root), null);
  const run = runButton(root) as HTMLButtonElement;
  assert.equal(run.getAttribute("aria-disabled"), "true");
  assert.match(reasonOf(root, run), /Starting a run of nightly-build/);
  await click(run);
  assert.equal(dialog(root), null, "a Run in flight can't be pressed again");
  await act(async () => call.answer(created()));
  assert.equal(runButton(root)?.getAttribute("aria-disabled"), "false");
});

test("exit 0 selects and follows the new run, and a toast offers Open in browser", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  await act(async () => backend.reads()[0].answer(graphRunsRecord(NAME, [])));
  const call = await startRun(backend, root);
  await act(async () => call.answer(created()));
  assert.ok(backend.statuses().some((s) => s.args.workOrderId === CREATED_ID), "the new run's detail follows it");
  assert.equal(backend.reads().length, 2, "the list is read again at once");
  const newRun = graphRunEntry(1, { workOrderId: CREATED_ID, runId: CREATED_RUN, status: "AWAITING_APPROVAL", awaitingApproval: true, runPageAddress: CREATED_PAGE });
  await act(async () => backend.reads()[1].answer(graphRunsRecord(NAME, [newRun])));
  assert.equal(button(root, new RegExp(`^Show ${CREATED_RUN}$`))?.getAttribute("aria-pressed"), "true", "the new run is selected");
  const toast = notice(root, "Run started") as HTMLElement;
  assert.equal(toast.getAttribute("role"), "status");
  assert.match(text(toast), new RegExp(`Started ${CREATED_RUN} of nightly-build`));
  await click(button(toast, /^Open in browser$/));
  await flush();
  assert.deepEqual(backend.opened(), [CREATED_PAGE]);
});

test("exit 7 says a run awaiting approval blocks new runs, with Show run and Open in browser at blockingRunAddress", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  const record = stdout("run: blocked by a run awaiting approval, exit 7");
  await act(async () => call.answer({ kind: "blocked", record, blockingRunAddress: String(record.blockingRunAddress) }));
  const shown = notice(root, "Run not started") as HTMLElement;
  assert.equal(shown.getAttribute("role"), "alert");
  assert.match(text(shown), /A run of this graph workflow awaiting approval blocks new runs of nightly-build/);
  await click(button(shown, /^Open in browser$/));
  await flush();
  assert.deepEqual(backend.opened(), [CREATED_PAGE]);
  await click(button(shown, /^Show run$/));
  assert.ok(backend.statuses().some((s) => s.args.workOrderId === CREATED_ID), "Show run opens the blocking run's detail");
});

test("exit 7 for a held run names that", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  const record: Record<string, unknown> = { ...stdout("run: blocked by a run awaiting approval, exit 7"), code: "WORKFLOW_RUN_HELD" };
  await act(async () => call.answer({ kind: "blocked", record, blockingRunAddress: String(record.blockingRunAddress) }));
  assert.match(text(notice(root, "Run not started")), /A held run of this graph workflow blocks new runs of nightly-build/);
});

test("exit 1 for host down, signed out and expired each get their own message", async () => {
  const cases: [CallOutcome, RegExp][] = [
    [{ kind: "hostDown", message: "praxis: Could not connect to the host at https://127.0.0.1:7443; is it running?" }, /The Praxis host isn't answering.*Start the host/],
    [{ kind: "notSignedIn", message: "praxis: There is no CLI session for this host" }, /isn't signed in to this host.*Sign in/],
    [{ kind: "expired", message: "praxis: The host did not accept the CLI session (UNAUTHENTICATED)." }, /session on this host has expired.*Sign in again/],
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
  // The recorded refusal praxis gives itself for a graph workflow the host has no admitted revision of.
  const words = String(stdout("run: no admitted revision").message);
  await act(async () => call.answer({ kind: "refused", message: words }));
  const shown = notice(root, "Run not started") as HTMLElement;
  assert.ok(text(shown).includes(words));
  await click(button(shown, /^Copy$/));
  await flush();
  assert.equal(await navigator.clipboard.readText(), words);
  assert.match(text(shown), /Copied praxis's words/);
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
  const again = await startRun(backend, root);
  assert.equal(again.args.name, first.args.name);
  assert.equal(again.args.projectPath, first.args.projectPath);
  await act(async () => again.answer(created()));
  assert.match(text(notice(root, "Run started")), new RegExp(`Started ${CREATED_RUN}`));
});

test("exit 2 or an unknown format says Quay needs an update for this praxis", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const outcomes: CallOutcome[] = [
    { kind: "needsUpdate", detail: "praxis didn't accept Quay's arguments: praxis: unknown option" },
    { kind: "record", record: { format: "aiws-graph-run-result/1" } },
  ];
  for (const outcome of outcomes) {
    const call = await startRun(backend, root);
    await act(async () => call.answer(outcome));
    assert.match(text(notice(root, "Run not started")), /Quay needs an update for this praxis/);
  }
});

test("a creation in flight when the Runs view leaves the screen is joined when it comes back", async () => {
  const backend = fakeBackend();
  const root = await renderRuns();
  const call = await startRun(backend, root);
  await click(button(root, /^Workflow$/));
  await click(button(root, /^Runs$/));
  assert.equal(runButton(root)?.getAttribute("aria-disabled"), "true", "Run stays disabled while the creation runs");
  await act(async () => call.answer(created()));
  assert.match(text(notice(root, "Run started")), new RegExp(`Started ${CREATED_RUN}`));
  assert.equal(backend.runCalls().length, 1, "the creation was joined, not run twice");
});

test("a second Run of the same graph workflow while one is in flight joins it, and a template of the same name is apart", async () => {
  const answers: ((value: unknown) => void)[] = [];
  const sentCalls: string[] = [];
  const fake = (command: string, args: Record<string, unknown>) => {
    sentCalls.push(`${command} ${String(args.name)}`);
    return new Promise((resolve) => answers.push(resolve));
  };
  const graphStarts = createRunStarts(fake, GRAPH_RUN);
  const templateStarts = createRunStarts(fake);
  const first = graphStarts.start("C:/p", NAME);
  const second = graphStarts.start("C:/p", NAME);
  assert.equal(first, second);
  assert.ok(graphStarts.inFlight("C:/p", NAME));
  assert.equal(templateStarts.inFlight("C:/p", NAME), null, "a graph run in flight isn't a template's");
  void templateStarts.start("C:/p", NAME);
  assert.deepEqual(sentCalls, [`praxis_host_graph_run ${NAME}`, `praxis_host_run ${NAME}`]);
  answers[0](created());
  assert.equal((await first).kind, "created");
  assert.equal(graphStarts.inFlight("C:/p", NAME), null, "an ended creation leaves nothing to join");
});
