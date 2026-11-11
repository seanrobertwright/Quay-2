/// <reference types="node" />
// Component tests for a graph run's run canvas (#571): the main graph of the revision the run's row
// names, read from the host with `praxis graphs show <name> --revision <n>`, drawn read-only above
// the node table with each card in its node phase.
// They render the real graph workflow form into happy-dom and fake only Tauri's `invoke`, the
// out-of-process boundary. The recorded run of several phases and the recorded revision it runs
// (graph_outputs.fixture.json) are drawn, and hand-made revisions in the recorded one's shape.
// happy-dom lays nothing out, so React Flow never measures a card: the cards are in the document
// at their positions, and the edges, which wait for the measures, aren't.
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

/** What `praxis_read` gives for a graph: the project's saved graph file and its layout file, if any. */
type SavedGraph = { content?: Record<string, unknown>; layout?: Record<string, unknown> } | null;

/**
 * The backend: the form's own reads answer at once, and so does `praxis_read` of a graph, with
 * `saved`, or as a graph the project hasn't got; the runs list, graph status and revision reads
 * wait for the test.
 */
function fakeBackend(saved: SavedGraph = null) {
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
            return resolve(
              saved === null
                ? { id: args.id, kind: "graphs", missing: true }
                : { id: args.id, kind: "graphs", missing: false, contentHash: "h", content: saved.content ?? { id: args.id, nodes: [] }, layout: saved.layout },
            );
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
    layoutReads: () => of("praxis_read"),
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
/** Asserts the backend was sent only reads: no layout file, or any other, was written or changed. */
const onlyReads = (backend: Backend) => assert.deepEqual(backend.sent.map((s) => s.command).filter((c) => !READS.has(c)), []);

interface FormSpies {
  onEdit?: (edit: unknown) => void;
  onOpen?: (ref: unknown) => void;
  /** The `workOrderId` of a run to show as the form opens. */
  showRun?: string;
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
    showRun: spies.showRun,
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

/** Opens Runs, lists `rows`, and shows run `n`'s detail. */
async function showRun(backend: Backend, n = 1, rows: unknown[] = [entry(n)], spies: FormSpies = {}): Promise<HTMLElement> {
  const root = await render(form(spies));
  await click(button(root, /^Runs$/));
  await answer(backend.lists()[0], graphRunsRecord(NAME, rows));
  await click(button(root, new RegExp(`^Show run-${n}$`)));
  return root;
}

const detail = (root: HTMLElement) => root.querySelector('[aria-label^="Run run-"]') as HTMLElement | null;
const header = (root: HTMLElement) => detail(root)?.querySelector("header") as HTMLElement;
/** The run canvas, found by its heading. */
const runCanvas = (root: HTMLElement) =>
  ([...(detail(root)?.querySelectorAll("section") ?? [])].find((s) => /^Run canvas/.test(text(s.querySelector("h4")))) as HTMLElement | undefined) ?? null;
const cards = (root: HTMLElement) => [...(runCanvas(root)?.querySelectorAll<HTMLElement>(".react-flow__node") ?? [])];
/** The ids of the run canvas's cards, in the order it draws them. */
const cardIds = (root: HTMLElement) => cards(root).map((card) => card.getAttribute("data-id"));
/** Where each card is on the canvas, as React Flow places it. */
const cardPositions = (root: HTMLElement) => Object.fromEntries(cards(root).map((card) => [card.getAttribute("data-id"), card.style.transform]));
/** Each card as its id, its phase chip's text and tone, and its counter line. */
const cardStates = (root: HTMLElement) =>
  cards(root).map((card) => {
    const chip = card.querySelector('[data-chip="phase"]');
    return [card.getAttribute("data-id"), text(chip), chip?.getAttribute("data-tone") ?? null, text(card.querySelector("[data-counter]"))];
  });
const problems = (root: HTMLElement) => [...(runCanvas(root)?.querySelectorAll('[aria-label="Run canvas problems"] li') ?? [])].map((li) => text(li));
const nodesToggle = (root: HTMLElement) => button(detail(root) as HTMLElement, /^Nodes/) as HTMLButtonElement;
const nodeTable = (root: HTMLElement) => detail(root)?.querySelector("table") ?? null;
/** The node table's rows, each as its id, its phase chip's text and tone, and its counter line. */
const nodeRows = (root: HTMLElement) =>
  [...(nodeTable(root)?.querySelectorAll("tbody tr") ?? [])].map((tr) => {
    const chip = tr.querySelector('[data-chip="phase"]');
    return [text(tr.querySelector("th")), text(chip), chip?.getAttribute("data-tone") ?? null, text(tr.lastElementChild)];
  });

/** The recorded revision the recorded run of several phases runs. */
const recordedRevision = (): CallOutcome => ({ kind: "record", record: recordedStdout("graphs show: a revision") });
const severalPhases = () => statusRecord(recordedStdout("status: nodes in several phases"));
/** The ids of the recorded revision's nodes, in its graph's order. */
const RECORDED_IDS = ["build", "test", "cooldown", "signoff", "package", "deploy", "end"];

/** Shows run 1, whose view is the recorded run of several phases, and answers its revision read with `revision`. */
async function drawRun(backend: Backend, revision: CallOutcome = recordedRevision(), spies: FormSpies = {}): Promise<HTMLElement> {
  const root = await showRun(backend, 1, [entry(1)], spies);
  await answer(backend.statuses()[0], severalPhases());
  await answer(backend.revisionReads()[0], revision);
  return root;
}

/** A graph node with no settings. */
const graphNode = (id: string, kind: string, dependsOn: string[] = []) => ({ id, kind, dependsOn, config: {} });

test("a graph run's detail draws the main graph of the revision its row names, as the host gave it, never the project's saved graph", async () => {
  const saved = { content: { id: "release-review", nodes: [graphNode("draft-only", "TASK")] } };
  const backend = fakeBackend(saved);
  const root = await showRun(backend, 1, [entry(1, { workflowRevision: 1 })]);
  await answer(backend.statuses()[0], severalPhases());
  assert.deepEqual(
    backend.revisionReads().map((s) => [s.args.projectPath, s.args.name, s.args.revision]),
    [[PROJECT, NAME, 1]],
    "one read of the revision the run's row names",
  );
  await answer(backend.revisionReads()[0], recordedRevision());
  assert.deepEqual(cardIds(root), RECORDED_IDS);
  assert.doesNotMatch(text(runCanvas(root)), /draft-only/, "the saved graph isn't drawn");
});

test("a run of an older revision draws that revision's graph, and a run of the newer one the newer graph", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(2, { workflowRevision: 2 }), entry(1, { workflowRevision: 1 })]);
  await answer(backend.statuses()[0], severalPhases());
  assert.equal(backend.revisionReads()[0].args.revision, 1);
  await answer(backend.revisionReads()[0], revisionRecord([graphNode("build", "TASK"), graphNode("end", "END", ["build"])]));
  assert.deepEqual(cardIds(root), ["build", "end"]);
  await click(button(header(root), /^Close /));
  await click(button(root, /^Show run-2$/));
  await answer(backend.statuses()[1], severalPhases());
  assert.equal(backend.revisionReads()[1].args.revision, 2);
  await answer(backend.revisionReads()[1], revisionRecord([graphNode("lint", "TASK"), graphNode("ship", "TASK", ["lint"]), graphNode("end", "END", ["ship"])]));
  assert.deepEqual(cardIds(root), ["lint", "ship", "end"]);
});

test("opening the same revision again, for the same run or another, draws it without reading it again", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend, 1, [entry(1), entry(2)]);
  await answer(backend.statuses()[0], severalPhases());
  await answer(backend.revisionReads()[0], recordedRevision());
  for (const [read, run] of [
    [1, "run-2"],
    [2, "run-1"],
  ] as const) {
    await click(button(header(root), /^Close /));
    await click(button(root, new RegExp(`^Show ${run}$`)));
    await answer(backend.statuses()[read], severalPhases());
    assert.deepEqual(cardIds(root), RECORDED_IDS, run);
  }
  assert.equal(backend.revisionReads().length, 1, "one revision read");
  assert.equal(backend.statuses().length, 3, "each detail read its own run");
});

test("the run canvas has a heading that names the run and its revision", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  const runId = String(recordedStdout("status: nodes in several phases").runId);
  assert.equal(text(runCanvas(root)?.querySelector("h4")), `Run canvas: ${runId}, revision 1`);
  const canvas = runCanvas(root)?.querySelector(".react-flow");
  assert.equal(canvas?.getAttribute("aria-labelledby"), runCanvas(root)?.querySelector("h4")?.id, "the drawing is named by it too");
});

test("with the project's saved layout for the revision's graph id, the cards take its positions, and a node it lacks is placed near its placed neighbours", async () => {
  const layout = {
    version: 1,
    nodes: { build: { x: 0, y: 0 }, test: { x: 300, y: 0 }, cooldown: { x: 600, y: 0 }, signoff: { x: 0, y: 200 }, package: { x: 300, y: 200 }, deploy: { x: 0, y: 400 } },
  };
  const backend = fakeBackend({ layout });
  const root = await drawRun(backend);
  assert.deepEqual(backend.layoutReads().map((s) => [s.args.projectPath, s.args.kind, s.args.id]), [[PROJECT, "graphs", "release-review"]]);
  assert.deepEqual(cardPositions(root), {
    build: "translate(0px,0px)",
    test: "translate(300px,0px)",
    cooldown: "translate(600px,0px)",
    signoff: "translate(0px,200px)",
    package: "translate(300px,200px)",
    deploy: "translate(0px,400px)",
    // Not in the layout: dagre's place, moved by the mean offset of package, deploy and cooldown from theirs.
    end: "translate(300px,372px)",
  });
  onlyReads(backend);
});

test("without a saved layout for the graph id, dagre lays the revision out", async () => {
  for (const saved of [null, { content: { id: "release-review", nodes: [] } }]) {
    revisions = createRevisionCache();
    const backend = fakeBackend(saved);
    const root = await drawRun(backend);
    assert.deepEqual(cardPositions(root), {
      build: "translate(540px,0px)",
      test: "translate(270px,172px)",
      cooldown: "translate(0px,344px)",
      signoff: "translate(540px,172px)",
      package: "translate(270px,344px)",
      deploy: "translate(540px,344px)",
      end: "translate(270px,516px)",
    });
    onlyReads(backend);
    unmount();
  }
});

test("each card shows the same node phase, in the same tone, and the same counter line as its row in the node table", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  const expected = [
    ["build", "COMPLETED", "ok", "Attempts: 1 of 2"],
    ["test", "HELD", "amber", "Attempts: 1 of 2"],
    ["cooldown", "WAITING", "active", "Attempts: 0 of 2"],
    ["signoff", "AWAITING_HUMAN", "amber", ""],
    ["package", "BLOCKED_BY_HOLD", "amber", "Attempts: 0 of 2"],
    ["deploy", "NOT_READY", "neutral", "Attempts: 0 of 2"],
    ["end", "BLOCKED_BY_HOLD", "amber", ""],
  ];
  assert.deepEqual(cardStates(root), expected);
  assert.deepEqual(nodeRows(root), expected);
  // Each card also gives its kind, id and settings, without a problem count.
  const build = cards(root)[0];
  assert.match(text(build), /Task.*build.*AGENT/s);
  assert.doesNotMatch(text(build), /problem/);
  assert.equal(build.getAttribute("aria-label"), "TASK build, AGENT, COMPLETED, Attempts: 1 of 2");
});

test("a node's card follows its phase from one read of the run to the next, and the revision isn't read again", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  const at = (n: number, phase: string) => statusRecord(graphOperatorView(1, { changeToken: String(n).repeat(64), nodes: [node("build", "TASK", phase), node("end", "END", "NOT_READY")] }));
  await answer(backend.statuses()[0], at(0, "READY"));
  await answer(backend.revisionReads()[0], revisionRecord([graphNode("build", "TASK"), graphNode("end", "END", ["build"])]));
  assert.deepEqual(cardStates(root)[0], ["build", "READY", "neutral", ""]);
  await tick(3_000);
  await answer(backend.statuses()[1], at(1, "RUNNING"));
  assert.deepEqual(cardStates(root)[0], ["build", "RUNNING", "active", ""]);
  assert.equal(backend.revisionReads().length, 1);
});

/**
 * Runs `body` with each card measured at 230 by 76 and React Flow's resize observer reporting each
 * element once, when it starts to observe it, as a browser's does before anything resizes. happy-dom
 * lays nothing out, so without this React Flow measures no card, and draws no edge.
 */
async function withMeasuredCards(body: () => Promise<void>): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const observer = g.ResizeObserver;
  const proto = HTMLElement.prototype;
  const width = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  const height = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  const seen = new WeakSet<Element>();
  g.ResizeObserver = class {
    report: (entries: { target: Element }[]) => void;
    constructor(report: (entries: { target: Element }[]) => void) {
      this.report = report;
    }
    observe(target: Element) {
      if (seen.has(target)) return;
      seen.add(target);
      queueMicrotask(() => this.report([{ target }]));
    }
    unobserve() {}
    disconnect() {}
  };
  const card = (el: HTMLElement) => el.classList.contains("react-flow__node");
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get(this: HTMLElement) { return card(this) ? 230 : 0; } });
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get(this: HTMLElement) { return card(this) ? 76 : 0; } });
  try {
    await body();
  } finally {
    g.ResizeObserver = observer;
    if (width) Object.defineProperty(proto, "offsetWidth", width);
    if (height) Object.defineProperty(proto, "offsetHeight", height);
  }
}

test("a read that changes a card's node phase keeps the card's measured size, so its edges stay drawn", async () => {
  await withMeasuredCards(async () => {
    const backend = fakeBackend();
    const root = await drawRun(backend);
    const edges = () => runCanvas(root)?.querySelectorAll(".react-flow__edge").length;
    assert.equal(edges(), 6, "each dependsOn of the recorded graph");
    const view = recordedStdout("status: nodes in several phases");
    const nodes = view.nodes as Record<string, unknown>[];
    await tick(15_000);
    await answer(backend.statuses()[1], statusRecord({ ...view, changeToken: "1".repeat(64), nodes: [{ ...nodes[0], phase: "FAILED" }, ...nodes.slice(1)] }));
    assert.deepEqual(cardStates(root)[0], ["build", "FAILED", "error", "Attempts: 1 of 2"]);
    assert.equal(edges(), 6, "no card had to be measured again");
  });
});

test("a SUBWORKFLOW node is one card in its phase, and its child graph isn't drawn", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { nodes: [node("nightly", "SUBWORKFLOW", "RUNNING"), node("end", "END", "NOT_READY")] })));
  const child = { graph: { id: "child", revision: "1", nodes: [graphNode("child-task", "TASK"), graphNode("child-end", "END", ["child-task"])] }, binding: {} };
  await answer(
    backend.revisionReads()[0],
    revisionRecord([{ ...graphNode("nightly", "SUBWORKFLOW"), config: { graphId: "child" } }, graphNode("end", "END", ["nightly"])], { children: [child] }),
  );
  assert.deepEqual(cardIds(root), ["nightly", "end"]);
  assert.deepEqual(cardStates(root)[0], ["nightly", "RUNNING", "active", ""]);
  assert.doesNotMatch(text(runCanvas(root)), /child-task|child-end/);
});

test("a graph node with no view entry draws no chip and says no state is reported, an entry with no graph node is in the node table only, and each is a problem line", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { nodes: [node("build", "TASK", "COMPLETED"), node("extra", "TASK", "RUNNING")] })));
  await answer(backend.revisionReads()[0], revisionRecord([graphNode("build", "TASK"), graphNode("end", "END", ["build"])]));
  assert.deepEqual(cardIds(root), ["build", "end"], "the entry with no graph node draws no card");
  const end = cards(root)[1];
  assert.equal(end.querySelector('[data-chip="phase"]'), null, "no chip");
  assert.match(text(end), /no state reported/);
  assert.match(end.getAttribute("aria-label") ?? "", /no state reported$/);
  assert.deepEqual(problems(root), [
    "Node end is in revision 1's graph, but the host reports no node phase for it.",
    "Node extra has a node phase on the host, but isn't in revision 1's graph, so only the node table shows it.",
  ]);
  await click(nodesToggle(root));
  assert.deepEqual(
    nodeRows(root).map(([id]) => id),
    ["build", "extra"],
  );
});

test("when the revision can't be read, the canvas area gives the host's problem and Try again, the node table opens by itself, and the run-level facts still show", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await answer(backend.statuses()[0], severalPhases());
  assert.equal(nodesToggle(root).getAttribute("aria-expanded"), "false", "the table starts collapsed");
  const refusal = recordedStdout("graphs show: a revision, not submitted");
  await answer(backend.revisionReads()[0], { kind: "hostRefused", message: String(refusal.message), hostCode: "NOT_FOUND", record: refusal });
  assert.match(text(runCanvas(root)), /Revision 1 of release-train couldn't be read: The host refused the request \(NOT_FOUND\)\./);
  assert.deepEqual(cardIds(root), []);
  assert.equal(nodesToggle(root).getAttribute("aria-expanded"), "true", "the node table opened by itself");
  assert.equal(nodeRows(root).length, 7);
  assert.match(text(header(root)), /RUNNING/, "the run-level facts still show");
  assert.match(text(header(root)), /Held/);
  await click(button(runCanvas(root) as HTMLElement, /^Try again$/));
  assert.equal(backend.revisionReads().length, 2, "Try again reads the revision again");
  assert.match(text(runCanvas(root)), /Reading revision 1 of release-train/);
  await answer(backend.revisionReads()[1], recordedRevision());
  assert.deepEqual(cardIds(root), RECORDED_IDS);
  assert.equal(button(runCanvas(root) as HTMLElement, /^Try again$/), undefined);
});

/** The recorded refusal of a revision the host doesn't hold. */
function refused(): CallOutcome {
  const refusal = recordedStdout("graphs show: a revision, not submitted");
  return { kind: "hostRefused", message: String(refusal.message), hostCode: "NOT_FOUND", record: refusal };
}

/** Shows run 1, refuses its revision read, and presses Try again with focus on it. Returns Try again. */
async function triedAgain(backend: Backend, root: HTMLElement): Promise<HTMLButtonElement> {
  await answer(backend.statuses()[0], severalPhases());
  await answer(backend.revisionReads()[0], refused());
  const tryAgain = button(runCanvas(root) as HTMLElement, /^Try again$/) as HTMLButtonElement;
  await act(async () => tryAgain.focus());
  await click(tryAgain);
  return tryAgain;
}

test("Try again stays, with focus, while the revision is read again, takes no second press meanwhile, and stays for a read that fails again", async () => {
  const backend = fakeBackend();
  const tryAgain = await triedAgain(backend, await showRun(backend));
  assert.equal(backend.revisionReads().length, 2);
  // Compared by identity, so a failure doesn't print two whole DOM nodes.
  assert.ok(tryAgain.isConnected && document.activeElement === tryAgain, "Try again stays, with focus, so focus doesn't fall to the page");
  assert.equal(tryAgain.getAttribute("aria-disabled"), "true");
  assert.equal(tryAgain.disabled, false, "not disabled, which would drop focus");
  await click(tryAgain);
  assert.equal(backend.revisionReads().length, 2, "a press while it reads reads nothing more");
  await answer(backend.revisionReads()[1], refused());
  assert.ok(tryAgain.isConnected && document.activeElement === tryAgain, "Try again keeps focus");
  assert.equal(tryAgain.getAttribute("aria-disabled"), "false", "it can be pressed again");
});

test("once Try again's read draws the revision, focus goes to the drawing that took its place", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await triedAgain(backend, root);
  await answer(backend.revisionReads()[1], recordedRevision());
  assert.deepEqual(cardIds(root), RECORDED_IDS);
  assert.ok(document.activeElement === runCanvas(root)?.querySelector(".react-flow"), "focus is on the drawing, not the page");
});

test("once Try again's read finds the revision can't be drawn, focus goes to the status line that says why", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  await triedAgain(backend, root);
  await answer(backend.revisionReads()[1], revisionRecord(Array.from({ length: 1001 }, (_, n) => graphNode(`node-${n}`, "TASK"))));
  const status = runCanvas(root)?.querySelector('[role="status"]');
  assert.match(text(status), /Revision 1 of release-train isn't drawn\./);
  assert.ok(document.activeElement === status, "focus is on the status line, not the page");
});

test("a revision with more nodes than the builder draws isn't drawn: the canvas area says why, and the node table still shows", async () => {
  const backend = fakeBackend();
  const many = Array.from({ length: 1001 }, (_, n) => graphNode(`node-${n}`, "TASK"));
  const root = await drawRun(backend, revisionRecord(many));
  assert.match(
    text(runCanvas(root)),
    /Revision 1 of release-train isn't drawn\. Its graph has 1001 nodes, more than the 1000 the builder draws\. The node table lists the run's nodes\./,
  );
  assert.equal(runCanvas(root)?.querySelector(".react-flow"), null, "no canvas");
  assert.equal(button(runCanvas(root) as HTMLElement, /^Try again$/), undefined, "rereading it would give the same");
  assert.equal(text(nodesToggle(root)), "Nodes (7)");
});

test("when the view has no nodes[], there is no run canvas and no revision is read", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  const { nodes: _, ...view } = graphOperatorView(1);
  await answer(backend.statuses()[0], statusRecord(view));
  assert.equal(runCanvas(root), null);
  assert.deepEqual(backend.revisionReads(), []);
  assert.match(text(detail(root)), /This host doesn't report node phases\./);
});

test("after a failed read of the run the run canvas dims with the detail, and draws on", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  const dimmed = () => Boolean(runCanvas(root)?.closest(".opacity-50"));
  assert.equal(dimmed(), false);
  await tick(15_000);
  await answer(backend.statuses()[1], { kind: "hostDown", message: "Nothing answered at https://127.0.0.1:7443; is it running?" });
  assert.equal(dimmed(), true);
  assert.deepEqual(cardIds(root), RECORDED_IDS);
});

test("a run whose revision the Runs list doesn't name yet says so in place of the run canvas", async () => {
  const backend = fakeBackend();
  const root = await render(form({ showRun: "wo-9" }));
  await answer(backend.lists()[0], graphRunsRecord(NAME, [entry(1)]));
  await answer(backend.statuses()[0], severalPhases());
  assert.match(text(runCanvas(root)), /The run canvas is drawn once the Runs list names the revision this run runs\./);
  assert.deepEqual(backend.revisionReads(), []);
});

// Read-only: the run canvas is given no edit handlers and no draft, and React Flow edits nothing on it.

/** The modifier a builder chord's Mod is here: Cmd on macOS, else Ctrl. */
const MOD = IS_MAC ? "metaKey" : "ctrlKey";

/** Sends a keydown of `key` to `target`, as the browser does, and returns it. */
async function press(target: Element, key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => void target.dispatchEvent(event));
  return event;
}

/** Sends mouse event `type` to `target` at a point on screen, as the browser does. */
async function mouse(target: Element, type: string, at: { x: number; y: number }, init: MouseEventInit = {}): Promise<void> {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 0, view: window as unknown as Window, ...init });
  await act(async () => void target.dispatchEvent(event));
}

/**
 * Every key the graph canvas edits with (keymap.ts): delete, cut, copy, paste, duplicate, select all,
 * auto-arrange, nudge, add to the selection and the menu. Selecting the focused node, with Enter or
 * Space, is the run canvas's too, and edits nothing (nodePanel.test.ts).
 */
const EDIT_KEYS: [string, KeyboardEventInit][] = [
  ["Delete", {}],
  ["Backspace", {}],
  ["x", { [MOD]: true }],
  ["c", { [MOD]: true }],
  ["v", { [MOD]: true }],
  ["d", { [MOD]: true }],
  ["a", { [MOD]: true }],
  ["A", { shiftKey: true }],
  ["ArrowLeft", {}],
  ["ArrowRight", { shiftKey: true }],
  ["ArrowUp", {}],
  ["ArrowDown", { shiftKey: true }],
  [" ", { shiftKey: true }],
  ["F10", { shiftKey: true }],
  ["ContextMenu", {}],
];

test("no edit key or pointer action changes anything on the run canvas, and nothing edits a draft or writes a file", async () => {
  const edits: unknown[] = [];
  const opened: unknown[] = [];
  const backend = fakeBackend();
  const root = await drawRun(backend, recordedRevision(), { onEdit: (edit) => edits.push(edit), onOpen: (ref) => opened.push(ref) });
  const canvas = runCanvas(root) as HTMLElement;
  // Everything on the canvas but where its view is, which a drag pans.
  const shown = () => [...canvas.querySelectorAll(".react-flow__nodes, .react-flow__edges, [role='status']")].map((el) => el.outerHTML).join("");
  const viewport = () => (canvas.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
  const drawn = shown();
  const [build, test] = cards(root);
  for (const target of [build, canvas.querySelector(".react-flow") as HTMLElement]) {
    for (const [key, init] of EDIT_KEYS) {
      await press(target, key, init);
      assert.equal(shown(), drawn, `${JSON.stringify(key)} ${JSON.stringify(init)} changed the run canvas`);
    }
  }
  assert.equal(viewport(), "translate(0px,0px) scale(1)", "no edit key moved the view");
  // A drag of a card pans the view and leaves the card where it is.
  await mouse(build, "mousedown", { x: 10, y: 10 });
  await mouse(build, "mousemove", { x: 200, y: 300 });
  await mouse(build, "mouseup", { x: 200, y: 300 });
  // A drag swallows the click that ends it, until the timer it sets runs.
  await tick(0);
  assert.equal(viewport(), "translate(190px,290px) scale(1)");
  assert.equal(shown(), drawn, "a drag moved a card");
  // A drag from a card's handle to another card's, and a right-click on a card and on the empty
  // canvas. A click on a card selects its node, which edits nothing (nodePanel.test.ts).
  await mouse(build.querySelector(".react-flow__handle.source") as HTMLElement, "mousedown", { x: 10, y: 10 });
  await mouse(test, "mousemove", { x: 300, y: 10 });
  await mouse(test.querySelector(".react-flow__handle.target") as HTMLElement, "mouseup", { x: 300, y: 10 });
  await mouse(build, "contextmenu", { x: 10, y: 10 }, { button: 2 });
  await mouse(canvas.querySelector(".react-flow__pane") as HTMLElement, "contextmenu", { x: 400, y: 400 }, { button: 2 });
  assert.equal(shown(), drawn, "a pointer action changed the run canvas");
  assert.equal(root.querySelector('[role="menu"]'), null, "no menu opened");
  // Its only buttons are React Flow's view controls: no palette, no Arrange, no delete.
  assert.deepEqual(buttons(canvas).map((b) => b.getAttribute("aria-label") ?? text(b)), ["Zoom In", "Zoom Out", "Fit View"]);
  assert.deepEqual(edits, [], "the form's draft got no edit");
  assert.deepEqual(opened, [], "no record was opened, so no draft was made");
  onlyReads(backend);
});

/** Asks for reduced motion while `body` runs, so the view moves at once. */
async function withReducedMotion(body: () => Promise<void>): Promise<void> {
  const w = window as unknown as { matchMedia: (query: string) => unknown };
  const matchMedia = w.matchMedia;
  w.matchMedia = (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addEventListener() {}, removeEventListener() {} });
  try {
    await body();
  } finally {
    w.matchMedia = matchMedia;
  }
}

test("the builder's zoom keys zoom the run canvas in and out and back to 100%, fit view is its own, and the page itself doesn't zoom", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  const viewport = () => (runCanvas(root)?.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
  assert.match(viewport(), /scale\(1\)$/);
  await withReducedMotion(async () => {
    const zoomIn = await press(cards(root)[0], "=", { [MOD]: true });
    assert.equal(zoomIn.defaultPrevented, true);
    assert.match(viewport(), /scale\(1\.2\)$/);
    await press(runCanvas(root)?.querySelector(".react-flow") as HTMLElement, "=", { [MOD]: true });
    assert.match(viewport(), /scale\(1\.44\)$/);
    await press(cards(root)[0], "-", { [MOD]: true });
    assert.match(viewport(), /scale\(1\.2\)$/);
    await press(cards(root)[0], "0", { [MOD]: true });
    assert.match(viewport(), /scale\(1\)$/);
    // Fit view is the run canvas's key too, though happy-dom lays out no cards for React Flow to fit.
    const fit = await press(cards(root)[0], "!", { code: "Digit1", shiftKey: true });
    assert.equal(fit.defaultPrevented, true);
  });
  assert.deepEqual(cardIds(root), RECORDED_IDS);
});

test("a run that newer runs push off the Runs list keeps its run canvas drawn, as it was viewed, since a run's revision never changes", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  const viewport = () => (runCanvas(root)?.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
  await withReducedMotion(async () => void (await press(cards(root)[0], "=", { [MOD]: true })));
  assert.match(viewport(), /scale\(1\.2\)$/);
  // The Runs list's next read no longer lists run 1, so the detail has no row for it.
  await tick(15_000);
  assert.equal(backend.lists().length, 2);
  await answer(backend.lists()[1], graphRunsRecord(NAME, [entry(3), entry(2)]));
  assert.deepEqual(cardIds(root), RECORDED_IDS, "still drawn");
  assert.match(viewport(), /scale\(1\.2\)$/, "at the same zoom, so it wasn't drawn again");
  assert.match(text(runCanvas(root)?.querySelector("h4")), /, revision 1$/);
  assert.match(text(header(root)), /revision 1/, "the detail still names the revision");
  assert.equal(backend.revisionReads().length, 1, "and didn't read it again");
});
