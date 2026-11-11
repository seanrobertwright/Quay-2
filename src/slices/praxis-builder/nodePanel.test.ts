/// <reference types="node" />
// Component tests for a graph run's node panel and its shared selection (#572): choosing a card on
// the run canvas, or a row of the node table, selects that node in both and opens its read-only
// node panel beside the run canvas, with what the view's `nodes[]` gives of it. Its close button,
// or Escape, clears the selection (#577).
// They render the real graph workflow form into happy-dom, inside a stand-in for the builder's
// root that counts the Escapes reaching it, and fake only Tauri's `invoke`, the out-of-process
// boundary. The recorded run of several phases and the recorded revision it runs
// (graph_outputs.fixture.json) are drawn, and hand-made views in the recorded one's shape.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import { createRevisionCache, type RevisionCache } from "./graphRevision.ts";
import { IS_MAC } from "./keymap.ts";
import type { CallOutcome } from "./praxisHost.ts";
import { graphNodeView as node, graphOperatorView, graphRunEntry as entry, graphRunsRecord, statusRecord } from "./fixtures/runs.ts";
import { recordedStdout, revisionRecord } from "./fixtures/graphOutputs.ts";
import { formatDateTime } from "../../lib/dates.ts";

const { GraphWorkflowForm } = await import("./GraphWorkflowForm.tsx");
const { NODE_FOCUS_CLASS } = await import("./NodeCard.tsx");

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const PROJECT = "C:/project";
/** The graph workflow the recorded run of several phases runs. */
const NAME = "release-train";

let mounted: { root: Root; container: HTMLElement } | null = null;
/** Each test's own revision cache, so no test reads a revision another kept. */
let revisions: RevisionCache;
/**
 * How many Escapes reached the builder. It runs its keys on its root, in the bubble phase, and skips
 * a key whose default a control inside it prevented (PraxisBuilderModal.tsx). An Escape it runs with
 * nothing smaller to close, such as the graph canvas's selection, hides the builder.
 */
let builderEscapes = 0;

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  revisions = createRevisionCache();
  builderEscapes = 0;
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

/** The stand-in for the builder's root: it counts each Escape that reaches it and that nothing inside handled. */
const builderKeys = (e: ReactKeyboardEvent) => {
  if (e.key === "Escape" && !e.defaultPrevented) builderEscapes += 1;
};

/** The graph workflow form, in the stand-in for the builder's root. */
function form(spies: FormSpies = {}) {
  const ref = { kind: "graph-workflows" as const, id: NAME };
  const content = { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" };
  const draft = createDraft(ref, { id: NAME, kind: "graph-workflows", missing: false, content, contentHash: "h" });
  assert.ok(draft.ok);
  const shown = createElement(GraphWorkflowForm, {
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
  return createElement("div", { onKeyDown: builderKeys }, shown);
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

/** The classes of each card's frame, the element its border and the selected card's mark are drawn on, by node id. */
const frames = (root: HTMLElement) =>
  new Map([...(runCanvas(root)?.querySelectorAll<HTMLElement>(".react-flow__node") ?? [])].map((c) => [c.dataset.id ?? "", new Set(c.firstElementChild?.classList)]));

/** A colour as its red, green and blue, each 0 to 255. */
type Rgb = readonly number[];

/**
 * The colour of the first of `classes` that is `utility` with a `#rrggbb` value, such as
 * `border-[#58a6ff]/70`, laid at its opacity over `under`; null when none is.
 */
function colourOf(classes: Iterable<string>, utility: string, under: Rgb = [0, 0, 0]): Rgb | null {
  const pattern = new RegExp(`^${utility}-\\[#([0-9a-f]{6})\\](?:/(\\d+))?$`);
  for (const name of classes) {
    const match = pattern.exec(name);
    if (match === null) continue;
    const alpha = match[2] === undefined ? 1 : Number(match[2]) / 100;
    return under.map((behind, n) => alpha * parseInt(match[1].slice(2 * n, 2 * n + 2), 16) + (1 - alpha) * behind);
  }
  return null;
}

/** The contrast ratio of two colours, as WCAG 2 measures it. */
function contrast(a: Rgb, b: Rgb): number {
  const luminance = (rgb: Rgb) => {
    const [r, g, bl] = rgb.map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

test("the selected card has a mark no other card has, at least 3:1 against its background and its border, in each node phase tone and with no state reported", async () => {
  const backend = fakeBackend();
  const root = await showRun(backend);
  // A node in each tone, and one the view has no entry for.
  const phases = { done: "COMPLETED", failed: "FAILED", held: "HELD", running: "RUNNING", ready: "READY" };
  await answer(backend.statuses()[0], statusRecord(graphOperatorView(1, { nodes: Object.entries(phases).map(([id, phase]) => node(id, "TASK", phase)) })));
  const ids = [...Object.keys(phases), "unreported"];
  await answer(backend.revisionReads()[0], revisionRecord(ids.map((id) => ({ id, kind: "TASK", dependsOn: [], config: {} }))));
  const unselected = frames(root);
  assert.deepEqual([...unselected.keys()], ids);
  for (const id of ids) {
    await click(card(root, id) as HTMLElement);
    const shown = frames(root);
    for (const other of ids.filter((o) => o !== id)) assert.deepEqual(shown.get(other), unselected.get(other), `selecting ${id} marks no other card`);
    const was = unselected.get(id) as Set<string>;
    const now = shown.get(id) as Set<string>;
    assert.ok([...was].every((c) => now.has(c)), `${id} keeps its border in its tone`);
    const mark = [...now].filter((c) => !was.has(c));
    const background = colourOf(was, "bg");
    assert.ok(background, `${id}'s card has a background: ${[...was].join(" ")}`);
    const border = colourOf(was, "border", background);
    assert.ok(border, `${id}'s card has a border: ${[...was].join(" ")}`);
    const colour = colourOf(mark, "ring") ?? colourOf(mark, "outline");
    assert.ok(colour, `${id}'s mark has a colour: ${mark.join(" ")}`);
    // A mark 3:1 from a card is lighter than it, and so further still from the run canvas, which is darker.
    assert.ok(contrast(colour, background) >= 3, `${id}'s mark is at least 3:1 against its background`);
    assert.ok(contrast(colour, border) >= 3, `${id}'s mark is at least 3:1 against its border, so it doesn't read as part of it`);
  }
});

test("a selected card with focus shows both the ring a card with focus has and the selection mark", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  const unselected = frames(root).get("cooldown") as Set<string>;
  const cooldown = card(root, "cooldown") as HTMLElement;
  await act(async () => cooldown.focus());
  await press(cooldown, "Enter");
  assert.deepEqual(selectedCards(root), ["cooldown"]);
  assert.equal(document.activeElement, card(root, "cooldown"), "it keeps focus");
  assert.deepEqual(
    NODE_FOCUS_CLASS.split(" ").filter((c) => !card(root, "cooldown")?.classList.contains(c)),
    [],
    "the card shows the ring a card with focus has",
  );
  const mark = [...(frames(root).get("cooldown") ?? [])].filter((c) => !unselected.has(c));
  assert.notDeepEqual(mark, [], "and its frame, inside that ring, the selection mark");
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

test("selecting nodes and following the panel's link change nothing: the panel has no control but its close button, and only reads are sent", async () => {
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
    [...panel.querySelectorAll("button, input, select, textarea, [role='button'], [contenteditable]")].map((el) => el.getAttribute("aria-label") ?? el.outerHTML),
    ["Close node panel"],
    "no control but its close button: no approval, acceptance, hold decision or human task is taken here",
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

// Closing the node panel (#577): its close button, or Escape on the run canvas, in the node table or
// in the node panel, clears the selection without hiding the builder, and focus never falls to the
// page.

/** The node panel's close button. */
const closeButton = (root: HTMLElement) => button(nodePanel(root) as HTMLElement, /^Close node panel$/) as HTMLButtonElement;
/** The node panel's link to its node's hold panel. */
const holdLink = (root: HTMLElement) => nodePanel(root)?.querySelector("a") as HTMLAnchorElement;

/** Presses `control` as a click does: focus moves to it, then it is pressed. happy-dom's `click` moves no focus. */
async function clickWithFocus(control: HTMLElement): Promise<void> {
  await act(async () => control.focus());
  await click(control);
}

/** Moves focus to `target`, then presses Escape there, and returns the key's event. */
async function escapeFrom(target: HTMLElement): Promise<KeyboardEvent> {
  await act(async () => target.focus());
  return press(target, "Escape");
}

/** Shows run 1, whose view is the recorded run of several phases, with its revision refused, so the run canvas isn't drawn and the node table opened by itself. */
async function showUnreadable(backend: Backend): Promise<HTMLElement> {
  const root = await showUndrawn(backend);
  const refusal = recordedStdout("graphs show: a revision, not submitted");
  await answer(backend.revisionReads()[0], { kind: "hostRefused", message: String(refusal.message), hostCode: "NOT_FOUND", record: refusal });
  assert.equal(runCanvas(root)?.querySelector(".react-flow"), null, "no drawing");
  assert.equal(nodesToggle(root).getAttribute("aria-expanded"), "true");
  return root;
}

test("the node panel's close button, a native button named for what it closes, closes the panel and clears the selection on the run canvas and in the node table", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  await click(card(root, "build") as HTMLElement);
  const close = closeButton(root);
  assert.equal(close?.tagName, "BUTTON", "a native button");
  assert.equal(close.type, "button");
  assert.equal(close.getAttribute("aria-label"), "Close node panel");
  await click(close);
  assert.equal(nodePanel(root), null, "the node panel closed");
  assert.deepEqual(selectedCards(root), [], "no card is selected");
  assert.deepEqual(selectedRows(root), [], "no row is selected");
});

test("while the run canvas is drawn, the close button puts focus on the node's card, so it doesn't fall to the page", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  // Chosen from its row, so focus wasn't on the card before.
  await click(rowButton(root, "cooldown") as HTMLButtonElement);
  await clickWithFocus(closeButton(root));
  assert.equal(nodePanel(root), null);
  // Compared by identity, so a failure doesn't print two whole DOM nodes.
  assert.ok(document.activeElement === card(root, "cooldown"), "focus is on cooldown's card");
});

test("with a node selected, Escape inside the node panel clears the selection, puts focus on the node's card while the run canvas is drawn, and the builder stays open", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  // Each node is chosen from its row, so focus wasn't on its card before.
  await click(rowButton(root, "package") as HTMLButtonElement);
  const escape = await escapeFrom(holdLink(root));
  assert.equal(escape.defaultPrevented, true, "the key is the detail's");
  assert.equal(nodePanel(root), null, "the node panel closed");
  assert.deepEqual(selectedCards(root), []);
  assert.deepEqual(selectedRows(root), []);
  assert.ok(document.activeElement === card(root, "package"), "from the hold link, focus is on package's card");
  await click(rowButton(root, "deploy") as HTMLButtonElement);
  await escapeFrom(closeButton(root));
  assert.equal(nodePanel(root), null);
  assert.ok(document.activeElement === card(root, "deploy"), "from the close button, focus is on deploy's card");
  assert.equal(builderEscapes, 0, "the builder got no Escape, so it didn't hide");
});

test("while the run canvas isn't drawn, the close button, and Escape inside the node panel, put focus on the node's row", async () => {
  const backend = fakeBackend();
  const root = await showUnreadable(backend);
  await click(rowButton(root, "cooldown") as HTMLButtonElement);
  await clickWithFocus(closeButton(root));
  assert.equal(nodePanel(root), null);
  assert.deepEqual(selectedRows(root), []);
  assert.ok(document.activeElement === rowButton(root, "cooldown"), "from the close button, focus is on cooldown's row");
  await click(rowButton(root, "package") as HTMLButtonElement);
  await escapeFrom(holdLink(root));
  assert.equal(nodePanel(root), null);
  assert.deepEqual(selectedRows(root), []);
  assert.ok(document.activeElement === rowButton(root, "package"), "from Escape on the hold link, focus is on package's row");
  assert.equal(builderEscapes, 0, "the builder got no Escape, so it didn't hide");
});

test("closing the node panel while neither the run canvas nor the collapsed node table shows the node puts focus on the Nodes toggle, so it never falls to the page", async () => {
  const backend = fakeBackend();
  const root = await showUnreadable(backend);
  await click(rowButton(root, "cooldown") as HTMLButtonElement);
  await click(nodesToggle(root));
  assert.equal(nodesToggle(root).getAttribute("aria-expanded"), "false", "the node table is collapsed");
  assert.equal(text(nodePanel(root)?.querySelector("h4")), "Node panel: cooldown", "with cooldown's node panel still open");
  await clickWithFocus(closeButton(root));
  assert.equal(nodePanel(root), null);
  assert.ok(document.activeElement === nodesToggle(root), "focus is on the Nodes toggle, which shows the node's row");
});

test("with a node selected, Escape on a card clears the selection on the run canvas and in the node table, leaves focus on that card, and the builder stays open", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  // On the selected card, then on another card.
  for (const id of ["test", "build"]) {
    await click(card(root, "test") as HTMLElement);
    assert.deepEqual(selectedCards(root), ["test"]);
    const focused = card(root, id) as HTMLElement;
    const escape = await escapeFrom(focused);
    assert.equal(escape.defaultPrevented, true, "the key is the detail's");
    assert.equal(nodePanel(root), null, `${id}: the node panel closed`);
    assert.deepEqual(selectedCards(root), []);
    assert.deepEqual(selectedRows(root), []);
    assert.ok(document.activeElement === focused, `focus stays on ${id}'s card`);
  }
  assert.equal(builderEscapes, 0, "the builder got no Escape, so it didn't hide");
});

test("with a node selected, Escape on a row of the node table clears the selection there and on the run canvas, leaves focus on that row, and the builder stays open", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  // On the selected row, then on another row.
  for (const id of ["signoff", "deploy"]) {
    await click(rowButton(root, "signoff") as HTMLButtonElement);
    assert.deepEqual(selectedRows(root), ["signoff"]);
    const focused = rowButton(root, id) as HTMLButtonElement;
    const escape = await escapeFrom(focused);
    assert.equal(escape.defaultPrevented, true, "the key is the detail's");
    assert.equal(nodePanel(root), null, `${id}: the node panel closed`);
    assert.deepEqual(selectedRows(root), []);
    assert.deepEqual(selectedCards(root), []);
    assert.ok(document.activeElement === focused, `focus stays on ${id}'s row`);
  }
  assert.equal(builderEscapes, 0, "the builder got no Escape, so it didn't hide");
});

test("with no node selected, Escape on the run canvas or in the node table isn't the detail's, and reaches the builder as before", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  const places: [string, HTMLElement][] = [
    ["a card", card(root, "build") as HTMLElement],
    ["the drawing", runCanvas(root)?.querySelector(".react-flow") as HTMLElement],
    ["a row", rowButton(root, "build") as HTMLButtonElement],
    ["the Nodes toggle", nodesToggle(root)],
  ];
  for (const [place, target] of places) {
    const escape = await escapeFrom(target);
    assert.equal(escape.defaultPrevented, false, `${place}: the detail left the key alone`);
  }
  assert.equal(builderEscapes, places.length, "each Escape reached the builder, whose cascade runs on it");
});

test("with a node selected, Escape elsewhere in the detail isn't the detail's: it reaches the builder, and the selection stays", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(card(root, "build") as HTMLElement);
  const header = detail(root)?.querySelector("header") as HTMLElement;
  const places: [string, HTMLElement][] = [
    ["the detail's Close", button(header, /^Close run-/) as HTMLButtonElement],
    ["Open in browser", button(header, /^Open in browser for run-/) as HTMLButtonElement],
    ["a hold panel", holdPanels(root)[0]],
  ];
  for (const [place, target] of places) {
    const escape = await escapeFrom(target);
    assert.equal(escape.defaultPrevented, false, `${place}: the detail left the key alone`);
    assert.deepEqual(selectedCards(root), ["build"], `${place}: the selection stays`);
  }
  assert.equal(builderEscapes, places.length, "each Escape reached the builder");
});

test("choosing the selected card or row again keeps its node selected, with its node panel open: only the close button and Escape clear the selection", async () => {
  const backend = fakeBackend();
  const root = await drawRun(backend);
  await click(nodesToggle(root));
  const build = card(root, "build") as HTMLElement;
  const again: [string, () => Promise<unknown>][] = [
    ["a click on its card", () => click(build)],
    ["Enter on its card", () => press(build, "Enter")],
    ["Space on its card", () => press(build, " ")],
    ["its row", () => click(rowButton(root, "build") as HTMLButtonElement)],
  ];
  await click(build);
  for (const [how, choose] of again) {
    await choose();
    assert.deepEqual(selectedCards(root), ["build"], `${how}: still selected`);
    assert.deepEqual(selectedRows(root), ["build"]);
    assert.equal(text(nodePanel(root)?.querySelector("h4")), "Node panel: build", `${how}: the node panel stays open`);
  }
});
