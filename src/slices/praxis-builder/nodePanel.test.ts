/// <reference types="node" />
// Component tests for a graph run's node panel and its shared selection (#572): choosing a card on
// the run canvas, or a row of the node table, selects that node in both and opens its read-only
// node panel beside the run canvas, with what the view's `nodes[]` gives of it.
// They render the real graph workflow form into happy-dom and fake only Tauri's `invoke`, the
// out-of-process boundary. The recorded run of several phases and the recorded revision it runs
// (graph_outputs.fixture.json) are drawn, and hand-made views in the recorded one's shape.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import { createRevisionCache, type RevisionCache } from "./graphRevision.ts";
import { IS_MAC } from "./keymap.ts";
import type { CallOutcome } from "./praxisHost.ts";
import { graphNodeView as node, graphOperatorView, graphRunEntry as entry, graphRunsRecord, statusRecord } from "./fixtures/runs.ts";
import { recordedStdout, revisionRecord } from "./fixtures/graphOutputs.ts";
import { formatDateTime } from "../../lib/dates.ts";

const { GraphWorkflowForm } = await import("./GraphWorkflowForm.tsx");

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const PROJECT = "C:/project";
/** The graph workflow the recorded run of several phases runs. */
const NAME = "release-train";

let mounted: { root: Root; container: HTMLElement } | null = null;
/** Each test's own revision cache, so no test reads a revision another kept. */
let revisions: RevisionCache;

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  revisions = createRevisionCache();
});

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
});

interface Sent {
  command: string;
  args: Record<string, unknown>;
  answer: (value: unknown) => void;
}

/**
 * The backend: the form's own reads answer at once, and so does `praxis_read` of a graph, as a
 * graph the project hasn't got; the runs list, graph status and revision reads wait for the test.
 */
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
          case "praxis_read":
            if (args.kind !== "graphs") return reject(new Error(`unexpected read of ${String(args.kind)}`));
            return resolve({ id: args.id, kind: "graphs", missing: true });
          case "praxis_host_graph_runs":
          case "praxis_host_graph_status":
          case "praxis_host_graph_revision":
            return;
          case "praxis_host_cancel":
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
    revisionReads: () => of("praxis_host_graph_revision"),
  };
}
type Backend = ReturnType<typeof fakeBackend>;

/** Everything the form and its Runs view may send: each reads, and none writes a file or the host. */
const READS = new Set([
  "praxis_validate",
  "praxis_check_graph_workflow",
  "praxis_graph_workflow_triggers",
  "praxis_read",
  "praxis_host_graph_runs",
  "praxis_host_graph_status",
  "praxis_host_graph_revision",
  "praxis_host_cancel",
]);

interface FormSpies {
  onEdit?: (edit: unknown) => void;
  onOpen?: (ref: unknown) => void;
}

function form(spies: FormSpies = {}) {
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
    onEdit: spies.onEdit ?? (() => {}),
    onOpen: spies.onOpen ?? (() => {}),
    onValidated: () => {},
    runsShown: true,
    revisions,
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

const text = (el: Element | null | undefined) => el?.textContent ?? "";
const buttons = (root: Element) => [...root.querySelectorAll("button")];
const button = (root: Element, name: RegExp) =>
  buttons(root).find((b) => name.test(b.getAttribute("aria-label") ?? text(b))) as HTMLButtonElement | undefined;
const click = (el: HTMLElement | undefined) => act(async () => el?.click());
const tick = (ms: number) => act(async () => mock.timers.tick(ms));
const answer = (s: Sent, outcome: CallOutcome) => act(async () => s.answer(outcome));

/** Sends a keydown of `key` to `target`, as the browser does, and returns it. */
async function press(target: Element, key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => void target.dispatchEvent(event));
  return event;
}

/** Opens Runs, lists run 1, and shows its detail. */
async function showRun(backend: Backend, spies: FormSpies = {}): Promise<HTMLElement> {
  const root = await render(form(spies));
  await click(button(root, /^Runs$/));
  await answer(backend.lists()[0], graphRunsRecord(NAME, [entry(1)]));
  await click(button(root, /^Show run-1$/));
  return root;
}

const detail = (root: HTMLElement) => root.querySelector('[aria-label^="Run run-"]') as HTMLElement | null;
/** The run canvas, found by its heading. */
const runCanvas = (root: HTMLElement) =>
  ([...(detail(root)?.querySelectorAll("section") ?? [])].find((s) => /^Run canvas/.test(text(s.querySelector("h4")))) as HTMLElement | undefined) ?? null;
/** The run canvas's card for node `nodeId`. */
const card = (root: HTMLElement, nodeId: string) => runCanvas(root)?.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`) ?? null;
/** The node panel, found by its heading. */
const nodePanel = (root: HTMLElement) =>
  ([...(detail(root)?.querySelectorAll("section") ?? [])].find((s) => /^Node panel/.test(text(s.querySelector("h4")))) as HTMLElement | undefined) ?? null;

const nodesToggle = (root: HTMLElement) => button(detail(root) as HTMLElement, /^Nodes/) as HTMLButtonElement;
/** The node table's row for node `nodeId`, found by its row header. */
const row = (root: HTMLElement, nodeId: string) =>
  ([...(detail(root)?.querySelectorAll("table tbody tr") ?? [])].find((tr) => text(tr.querySelector("th")) === nodeId) as HTMLElement | undefined) ?? null;
/** The button in node `nodeId`'s row that selects the node. */
const rowButton = (root: HTMLElement, nodeId: string) => row(root, nodeId)?.querySelector("th button") as HTMLButtonElement | null;
/** The ids of the nodes whose card is marked selected, as a screen reader is told. */
const selectedCards = (root: HTMLElement) =>
  [...(runCanvas(root)?.querySelectorAll(".react-flow__node") ?? [])].filter((c) => c.getAttribute("aria-current") === "true").map((c) => c.getAttribute("data-id"));
/** The ids of the nodes whose row is marked selected, as a screen reader is told. */
const selectedRows = (root: HTMLElement) =>
  [...(detail(root)?.querySelectorAll("table tbody th button") ?? [])].filter((b) => b.getAttribute("aria-current") === "true").map((b) => text(b));

/** The node panel's facts, each as its term and its value's text. */
const panelFacts = (root: HTMLElement) => [...(nodePanel(root)?.querySelectorAll("dt") ?? [])].map((dt) => [text(dt), text(dt.nextElementSibling)]);

/** The recorded revision the recorded run of several phases runs. */
const recordedRevision = (): CallOutcome => ({ kind: "record", record: recordedStdout("graphs show: a revision") });
const severalPhases = () => statusRecord(recordedStdout("status: nodes in several phases"));

/** Shows run 1, whose view is the recorded run of several phases, and draws the recorded revision it runs. */
async function drawRun(backend: Backend, spies: FormSpies = {}): Promise<HTMLElement> {
  const root = await showRun(backend, spies);
  await answer(backend.statuses()[0], severalPhases());
  await answer(backend.revisionReads()[0], recordedRevision());
  return root;
}

test("choosing a card opens the node panel, headed with the node's id, and never called an inspector", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  assert.equal(nodePanel(root), null, "no node panel before a node is selected");
  await click(card(root, "build") as HTMLElement);
  const panel = nodePanel(root);
  assert.ok(panel, "the node panel opened");
  assert.equal(text(panel.querySelector("h4")), "Node panel: build");
  assert.equal(panel.getAttribute("aria-labelledby"), panel.querySelector("h4")?.id, "the panel is named by its heading");
  assert.doesNotMatch(panel.outerHTML, /inspector/i);
  assert.deepEqual(panelFacts(root), [
    ["Kind", "TASK"],
    ["Phase", "COMPLETED"],
    ["Attempt status", "SETTLED"],
    ["Attempt outcome", "SUCCEEDED"],
    ["Attempts", "1 of 2"],
    ["Spent", "0 micro-USD"],
  ], "the recorded node's facts");
});

test("choosing a card marks it, and its row in the node table, as the one node selected", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  assert.deepEqual(selectedCards(root), []);
  assert.deepEqual(selectedRows(root), []);
  await click(card(root, "build") as HTMLElement);
  assert.deepEqual(selectedCards(root), ["build"]);
  assert.deepEqual(selectedRows(root), ["build"], "the same node's row is marked");
  await click(card(root, "cooldown") as HTMLElement);
  assert.deepEqual(selectedCards(root), ["cooldown"], "one node is selected at a time");
  assert.deepEqual(selectedRows(root), ["cooldown"]);
  assert.equal(text(nodePanel(root)?.querySelector("h4")), "Node panel: cooldown");
});

test("choosing a row of the node table marks the same node's card and opens the same node panel", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  await click(rowButton(root, "signoff") as HTMLButtonElement);
  assert.deepEqual(selectedRows(root), ["signoff"]);
  assert.deepEqual(selectedCards(root), ["signoff"], "the same node's card is marked");
  assert.equal(text(nodePanel(root)?.querySelector("h4")), "Node panel: signoff");
  await click(rowButton(root, "deploy") as HTMLButtonElement);
  assert.deepEqual(selectedRows(root), ["deploy"], "one node is selected at a time");
  assert.deepEqual(selectedCards(root), ["deploy"]);
  assert.equal(text(nodePanel(root)?.querySelector("h4")), "Node panel: deploy");
});

test("on the run canvas, Enter or Space selects the focused card, so Tab and one of them move the selection, and Shift+Space adds nothing", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  const build = card(root, "build") as HTMLElement;
  const held = card(root, "test") as HTMLElement;
  assert.equal(build.tabIndex, 0, "each card is a tab stop");
  assert.equal(held.tabIndex, 0);
  const enter = await press(build, "Enter");
  assert.equal(enter.defaultPrevented, true, "the key is the run canvas's");
  assert.deepEqual(selectedCards(root), ["build"]);
  assert.equal(text(nodePanel(root)?.querySelector("h4")), "Node panel: build");
  await press(held, " ");
  assert.deepEqual(selectedCards(root), ["test"], "the selection moved");
  assert.equal(text(nodePanel(root)?.querySelector("h4")), "Node panel: test");
  await press(build, " ", { shiftKey: true });
  assert.deepEqual(selectedCards(root), ["test"], "there is no multi-select");
  await press(runCanvas(root)?.querySelector(".react-flow") as HTMLElement, "Enter");
  assert.deepEqual(selectedCards(root), ["test"], "Enter on the canvas itself selects nothing");
});

test("in the node table, each row's node id is a button in the tab order, so Tab and Enter or Space select a node and move the selection", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  const ids = ["build", "test", "cooldown", "signoff", "package", "deploy", "end"];
  for (const id of ids) {
    const b = rowButton(root, id) as HTMLButtonElement;
    assert.equal(b?.tagName, "BUTTON", `${id}'s row has a native button, which Enter and Space press`);
    assert.equal(b.type, "button");
    assert.equal(b.disabled, false);
    assert.equal(b.tabIndex, 0, `${id}'s button is in the tab order`);
    assert.equal(text(b), id, "named by the node's id");
  }
  // happy-dom doesn't press a focused button from a key, so the test presses it as the browser does on Enter or Space.
  for (const id of ["package", "cooldown"]) {
    const b = rowButton(root, id) as HTMLButtonElement;
    await act(async () => b.focus());
    assert.equal(document.activeElement, b);
    await click(b);
    assert.deepEqual(selectedRows(root), [id]);
    assert.deepEqual(selectedCards(root), [id]);
    assert.equal(text(nodePanel(root)?.querySelector("h4")), `Node panel: ${id}`);
    assert.equal(document.activeElement, rowButton(root, id), "focus stays on the row, so Tab goes on from it");
  }
});

/** A node's `scope` in the recorded view's shape, with `attempts` used of `maxAttempts`, which it leaves out when the scope has no bound. */
const scope = (spent: string, attempts: number, maxAttempts?: number) => ({
  spent,
  reserved: "0",
  costUnit: "micro-USD",
  attempts,
  ...(maxAttempts === undefined ? {} : { maxAttempts }),
});
/** A LOOP node's `loop`, with `iteration` of its `maxIterations` completed, and its next iteration due at `nextDueMs`, if it is parked. */
const loop = (iteration: number, maxIterations: number, nextDueMs: number | null = null) => ({
  iteration,
  maxIterations,
  intervalMs: nextDueMs === null ? null : 60_000,
  nextDueMs,
  truncated: false,
  iterations: [],
});
const attempt = (status: string, outcome: string) => ({ attemptId: `att-${status}`, status, outcome });

test("the node panel shows each attempt, scope, loop, wait and human-task fact the node has, and leaves out each it hasn't", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  const due = NOW + 60_000;
  await answer(
    backend.statuses()[0],
    statusRecord(
      graphOperatorView(1, {
        nodes: [
          node("build", "TASK", "COMPLETED", { attempt: attempt("SETTLED", "SUCCEEDED"), scope: scope("1200", 1, 2) }),
          node("improve", "LOOP", "PARKED", { attempt: attempt("SETTLED", "SUCCEEDED"), scope: scope("4500", 3, 10), loop: loop(2, 5, due) }),
          node("poll", "LOOP", "NOT_READY", { loop: loop(0, 3) }),
          node("cooldown", "WAIT", "WAITING", { scope: scope("0", 0, 2), wait: { waitId: "wait:1", kind: "TIMER", status: "PENDING", deadlineMs: due } }),
          node("review", "TASK", "AWAITING_HUMAN", { attempt: attempt("DISPATCH_AUTHORIZED", "PENDING"), scope: scope("0", 1), humanTask: { taskId: "task-1" } }),
          node("end", "END", "NOT_READY"),
        ],
      }),
    ),
  );
  await click(nodesToggle(root));
  const expected: Record<string, string[][]> = {
    build: [
      ["Kind", "TASK"],
      ["Phase", "COMPLETED"],
      ["Attempt status", "SETTLED"],
      ["Attempt outcome", "SUCCEEDED"],
      ["Attempts", "1 of 2"],
      ["Spent", "1200 micro-USD"],
    ],
    improve: [
      ["Kind", "LOOP"],
      ["Phase", "PARKED"],
      ["Attempt status", "SETTLED"],
      ["Attempt outcome", "SUCCEEDED"],
      ["Attempts", "3 of 10"],
      ["Spent", "4500 micro-USD"],
      ["Iterations", "2 of 5"],
      ["Next due", formatDateTime(due)],
    ],
    poll: [
      ["Kind", "LOOP"],
      ["Phase", "NOT_READY"],
      ["Iterations", "0 of 3"],
    ],
    cooldown: [
      ["Kind", "WAIT"],
      ["Phase", "WAITING"],
      ["Attempts", "0 of 2"],
      ["Spent", "0 micro-USD"],
      ["Wait kind", "TIMER"],
      ["Wait status", "PENDING"],
    ],
    review: [
      ["Kind", "TASK"],
      ["Phase", "AWAITING_HUMAN"],
      ["Attempt status", "DISPATCH_AUTHORIZED"],
      ["Attempt outcome", "PENDING"],
      ["Attempts", "1, with no bound"],
      ["Spent", "0 micro-USD"],
      ["Human task", "Open"],
    ],
    end: [
      ["Kind", "END"],
      ["Phase", "NOT_READY"],
    ],
  };
  for (const [id, facts] of Object.entries(expected)) {
    await click(rowButton(root, id) as HTMLButtonElement);
    assert.deepEqual(panelFacts(root), facts, id);
    assert.doesNotMatch(text(nodePanel(root)), /task-1|att-|wait:1/, `${id}: never the id of a task, an attempt or a wait`);
  }
  // Each node's SDK status is PENDING here, which only an attempt's outcome may read too.
  await click(rowButton(root, "build") as HTMLButtonElement);
  assert.doesNotMatch(text(nodePanel(root)), /PENDING/, "never the node's SDK status");
});

/** The detail's hold panels. */
const holdPanels = (root: HTMLElement) => [...(detail(root)?.querySelectorAll('[role="region"]') ?? [])].filter((r) => /^Held:/.test(text(r))) as HTMLElement[];

test("a node held, or blocked by a hold, links to that hold's panel in the detail, and the link moves focus there", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  const [panel] = holdPanels(root);
  assert.equal(holdPanels(root).length, 1, "the recorded run has one open hold, on node test");
  // test is HELD; package and end are BLOCKED_BY_HOLD, by the hold on test.
  for (const id of ["test", "package", "end"]) {
    await click(card(root, id) as HTMLElement);
    const link = nodePanel(root)?.querySelector("a") as HTMLAnchorElement;
    assert.ok(link, `${id}'s panel links to the hold`);
    assert.deepEqual(panelFacts(root).slice(-1), [["Hold", "Held: EXECUTION_FAILED on node test"]], "named as the hold panel is");
    assert.equal(link.getAttribute("href"), `#${panel.id}`);
    await click(link);
    assert.equal(document.activeElement, panel, `${id}'s link moved focus to the hold panel`);
    assert.equal(panel.tabIndex, -1, "the hold panel takes focus from the link, and isn't a tab stop");
    await act(async () => (card(root, "build") as HTMLElement).focus());
  }
  await click(card(root, "build") as HTMLElement);
  assert.equal(nodePanel(root)?.querySelector("a"), null, "a node with no hold has no link");
  assert.ok(!panelFacts(root).some(([term]) => term === "Hold"));
});

/** Shows run 1, whose view is the recorded run of several phases, with no drawing in the run canvas's place. */
async function showUndrawn(backend: Backend): Promise<HTMLElement> {
  const root = await showRun(backend);
  await answer(backend.statuses()[0], severalPhases());
  return root;
}

/** Chooses cooldown's row in the open node table, and asserts its node panel opened beside the run canvas's place, which has no drawing. */
async function choosingARowOpensItsPanel(root: HTMLElement): Promise<void> {
  assert.equal(runCanvas(root)?.querySelector(".react-flow"), null, "no drawing");
  await click(rowButton(root, "cooldown") as HTMLButtonElement);
  assert.deepEqual(selectedRows(root), ["cooldown"]);
  assert.equal(text(nodePanel(root)?.querySelector("h4")), "Node panel: cooldown");
  assert.deepEqual(panelFacts(root).slice(0, 2), [
    ["Kind", "WAIT"],
    ["Phase", "WAITING"],
  ]);
  assert.equal(nodePanel(root)?.parentElement, runCanvas(root)?.parentElement?.parentElement, "beside the run canvas's place");
}

test("when the revision can't be read, the node table opens by itself, and choosing a row opens the node panel beside the run canvas's place", async () => {
  const backend = fakeBackend();
  const root = await showUndrawn(backend);
  const refusal = recordedStdout("graphs show: a revision, not submitted");
  await answer(backend.revisionReads()[0], { kind: "hostRefused", message: String(refusal.message), hostCode: "NOT_FOUND", record: refusal });
  assert.equal(nodesToggle(root).getAttribute("aria-expanded"), "true");
  await choosingARowOpensItsPanel(root);
});

test("when the revision has too many nodes to draw, the node table opens by itself, and choosing a row opens the node panel beside the run canvas's place", async () => {
  const backend = fakeBackend();
  const root = await showUndrawn(backend);
  await answer(backend.revisionReads()[0], revisionRecord(Array.from({ length: 1001 }, (_, n) => ({ id: `node-${n}`, kind: "TASK", dependsOn: [], config: {} }))));
  assert.equal(nodesToggle(root).getAttribute("aria-expanded"), "true");
  await choosingARowOpensItsPanel(root);
});

test("while the revision is still being read, the node table stays collapsed, and once opened, choosing a row opens the node panel beside the run canvas's place", async () => {
  const backend = fakeBackend();
  const root = await showUndrawn(backend);
  assert.equal(backend.revisionReads().length, 1, "the read is left unanswered");
  assert.equal(nodesToggle(root).getAttribute("aria-expanded"), "false");
  await click(nodesToggle(root));
  await choosingARowOpensItsPanel(root);
});

test("selecting nodes and following the panel's link change nothing: the panel has no control, and only reads are sent", async () => {
  const edits: unknown[] = [];
  const opened: unknown[] = [];
  const backend = fakeBackend();
  const root = await drawRun(backend, { onEdit: (edit) => edits.push(edit), onOpen: (ref) => opened.push(ref) });
  await click(nodesToggle(root));
  await click(card(root, "build") as HTMLElement);
  await press(card(root, "signoff") as HTMLElement, "Enter");
  await press(card(root, "cooldown") as HTMLElement, " ");
  await click(rowButton(root, "package") as HTMLButtonElement);
  await click(rowButton(root, "test") as HTMLButtonElement);
  const panel = nodePanel(root) as HTMLElement;
  assert.deepEqual(
    [...panel.querySelectorAll("button, input, select, textarea, [role='button'], [contenteditable]")].map((el) => el.outerHTML),
    [],
    "no control: no approval, acceptance, hold decision or human task is taken here",
  );
  assert.deepEqual(
    [...panel.querySelectorAll("a")].map((a) => text(a)),
    ["Held: EXECUTION_FAILED on node test"],
    "its one link goes to the hold panel",
  );
  await click(panel.querySelector("a") as HTMLElement);
  assert.deepEqual(edits, [], "the form's draft got no edit");
  assert.deepEqual(opened, [], "no record was opened, so no draft was made");
  assert.deepEqual(
    backend.sent.map((s) => s.command).filter((c) => !READS.has(c)),
    [],
    "only reads were sent: nothing on the host, the graph or a file changed",
  );
  assert.equal(backend.statuses().length, 1, "selecting reads nothing more");
  assert.equal(backend.revisionReads().length, 1);
});

test("a card the host reports no node phase for opens a panel saying so, and a row with no card opens its panel and marks no card", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { nodes: [node("build", "TASK", "COMPLETED"), node("extra", "TASK", "RUNNING")] })));
  const graphNode = (id: string, dependsOn: string[] = []) => ({ id, kind: id === "end" ? "END" : "TASK", dependsOn, config: {} });
  await answer(backend.revisionReads()[0], revisionRecord([graphNode("build"), graphNode("end", ["build"])]));
  await click(nodesToggle(root));
  await click(card(root, "end") as HTMLElement);
  assert.deepEqual(selectedCards(root), ["end"]);
  assert.deepEqual(selectedRows(root), [], "end has no row");
  assert.equal(text(nodePanel(root)?.querySelector("h4")), "Node panel: end");
  assert.match(text(nodePanel(root)), /The host reports no node phase for this node\./);
  assert.deepEqual(panelFacts(root), [], "no fact is shown empty");
  await click(rowButton(root, "extra") as HTMLButtonElement);
  assert.deepEqual(selectedRows(root), ["extra"]);
  assert.deepEqual(selectedCards(root), [], "extra has no card");
  assert.deepEqual(panelFacts(root), [
    ["Kind", "TASK"],
    ["Phase", "RUNNING"],
  ]);
});

test("the node panel follows its node from one read of the run to the next, keeps the selection, and dims with the detail", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  /** The run with `build` in `phase` having used `attempts`, under change token `n`. */
  const at = (n: number, phase: string, attempts: number) =>
    statusRecord(graphOperatorView(1, { changeToken: String(n).repeat(64), nodes: [node("build", "TASK", phase, { scope: scope("0", attempts, 2) }), node("end", "END", "NOT_READY")] }));
  await answer(backend.statuses()[0], at(0, "READY", 0));
  await click(nodesToggle(root));
  await click(rowButton(root, "build") as HTMLButtonElement);
  assert.deepEqual(panelFacts(root).slice(1), [
    ["Phase", "READY"],
    ["Attempts", "0 of 2"],
    ["Spent", "0 micro-USD"],
  ]);
  await tick(3_000);
  await answer(backend.statuses()[1], at(1, "RUNNING", 1));
  assert.deepEqual(panelFacts(root).slice(1), [
    ["Phase", "RUNNING"],
    ["Attempts", "1 of 2"],
    ["Spent", "0 micro-USD"],
  ]);
  assert.deepEqual(selectedRows(root), ["build"], "the selection stays");
  const dimmed = () => Boolean(nodePanel(root)?.closest(".opacity-50"));
  assert.equal(dimmed(), false);
  await tick(3_000);
  await answer(backend.statuses()[2], { kind: "hostDown", message: "Nothing answered at https://127.0.0.1:7443; is it running?" });
  assert.equal(dimmed(), true, "dimmed with the run-level facts while the host can't be used");
  assert.deepEqual(panelFacts(root)[1], ["Phase", "RUNNING"], "the last read's facts stay");
});

/** The modifier a builder chord's Mod is here: Cmd on macOS, else Ctrl. */
const MOD = IS_MAC ? "metaKey" : "ctrlKey";

test("with a node selected, the graph canvas's edit keys still change nothing on the run canvas", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  const selected = card(root, "test") as HTMLElement;
  await press(selected, "Enter");
  const drawn = () => (runCanvas(root)?.querySelector(".react-flow__nodes") as HTMLElement).outerHTML;
  const before = drawn();
  const keys: [string, KeyboardEventInit][] = [
    ["Delete", {}],
    ["Backspace", {}],
    ["x", { [MOD]: true }],
    ["v", { [MOD]: true }],
    ["d", { [MOD]: true }],
    ["a", { [MOD]: true }],
    ["A", { shiftKey: true }],
    ["ArrowLeft", {}],
    ["ArrowDown", { shiftKey: true }],
  ];
  for (const [key, init] of keys) {
    await press(selected, key, init);
    assert.equal(drawn(), before, `${JSON.stringify(key)} ${JSON.stringify(init)} changed the run canvas`);
  }
  assert.deepEqual(selectedCards(root), ["test"]);
});

test("a node whose hold has no hold panel in the detail names the hold, with no link", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { nodes: [node("build", "TASK", "HELD", { holdId: "hold-9" })] })));
  await click(nodesToggle(root));
  await click(rowButton(root, "build") as HTMLButtonElement);
  assert.deepEqual(panelFacts(root).slice(-1), [["Hold", "hold-9"]]);
  assert.equal(nodePanel(root)?.querySelector("a"), null);
});
