/// <reference types="node" />
// Component tests for the Workflows panel (#645): the engine strip, Needs you, Running, Start and
// Recent, top to bottom, and what each control does. Tauri's `invoke`, the out-of-process
// boundary, is faked: the Factory switch and Halt call `machina_set_loop_mode`.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ArchonRun, ArchonWorkflow, SpecTask } from "../archon/types.ts";
import type { MachinaStatus, MachinaWorkOrder } from "../machina/types.ts";
import type { RunSource } from "./workflowRuns.ts";
import type { WorkflowsData } from "./workflowsData.ts";

const { WorkflowsPanel } = await import("./WorkflowsPanel.tsx");

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 15, 18, 0);

const archon = (id: string, status: string, over: Partial<ArchonRun> = {}): ArchonRun => ({
  id,
  workflow_name: `owner/${id}`,
  status,
  started_ms: NOW - HOUR,
  ...over,
});
const STATUS: MachinaStatus = {
  loopMode: "ACTIVE",
  epoch: 1,
  sessionStartedAtMs: 0,
  statePath: "",
  vaultRoot: "",
  workOrderCount: 1,
  measuredSpendUsd: 0,
  budgetUsd: 0,
  activeHolds: 0,
  runningJobs: 0,
};
const workOrder = (id: string, over: Partial<MachinaWorkOrder> = {}): MachinaWorkOrder => ({
  id,
  title: "Add a greeting",
  objective: "",
  repoPath: "C:/repo",
  baseBranch: "main",
  baseSha: "a".repeat(40),
  branchName: `machina/${id}`,
  worktreePath: "C:/repo/wt",
  authorAgent: "claude",
  authorTerminalId: null,
  allowedOutputPaths: [],
  dependsOn: [],
  maxCorrections: 2,
  attempts: 1,
  budgetUsd: 5,
  spend: { measured: true, usd: 0.75, responses: 1, note: "" },
  status: "IN_PROGRESS",
  stages: [],
  hold: null,
  vault: null,
  setupChecks: [],
  lastGate: null,
  mergeCommit: null,
  worktreeRemoved: false,
  error: null,
  epoch: 1,
  createdAtMs: NOW - 2 * HOUR,
  updatedAtMs: NOW - HOUR,
  events: [],
  ...over,
});

const data = (over: Partial<WorkflowsData> = {}): WorkflowsData => ({
  archon: { online: true, runs: [], workflows: [], tasks: [] },
  factory: { status: STATUS, workOrders: [] },
  praxis: { condition: { state: "signedIn" }, graphs: [], runs: [] },
  ...over,
});

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

interface Calls {
  picked: RunSource[];
  browser: RunSource[];
  invoked: [string, Record<string, unknown>][];
  start: string[];
}

async function render(shown: WorkflowsData = data(), pinned: readonly string[] = []) {
  const calls: Calls = { picked: [], browser: [], invoked: [], start: [] };
  fakeInvoke(async (command, args) => {
    calls.invoked.push([command, args]);
    return null;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(WorkflowsPanel, {
        data: shown,
        now: NOW,
        pickedKey: null,
        engineFocus: null,
        onPickRun: (source: RunSource) => calls.picked.push(source),
        onRefresh: () => {},
        onOpenInBrowser: (source: RunSource) => calls.browser.push(source),
        start: {
          pinned,
          onRunWorkflow: (name: string) => calls.start.push(`run ${name}`),
          onPin: (name: string) => calls.start.push(`pin ${name}`),
          onUnpin: (name: string) => calls.start.push(`unpin ${name}`),
          onAgentTask: (task: SpecTask) => calls.start.push(`agent ${task.title}`),
          onAllTasks: () => calls.start.push("all tasks"),
          onOpenGraph: (id: string) => calls.start.push(`graph ${id}`),
          onNewWorkOrder: () => calls.start.push("new work order"),
          onFactoryConfig: () => calls.start.push("factory config"),
        },
      }),
    ),
  );
  return { container, calls };
}

const sectionNames = (container: HTMLElement) =>
  [...container.querySelectorAll("section[aria-label]")].map((s) => s.getAttribute("aria-label"));

test("the panel reads top to bottom: engine strip, Needs you, Running, Start, Recent", async () => {
  const { container } = await render();
  assert.deepEqual(sectionNames(container), ["Engines", "Needs you", "Running", "Start", "Recent"]);
});

test("the engine strip shows Archon's state, the Factory switch, Halt, today's Factory spend and Praxis sign-in", async () => {
  const today = workOrder("WO-1", { updatedAtMs: NOW, spend: { measured: true, usd: 1.25, responses: 1, note: "" } });
  const { container } = await render(data({ archon: { online: false, runs: [], workflows: [], tasks: [] }, factory: { status: STATUS, workOrders: [today] } }));
  const strip = container.querySelector<HTMLElement>('section[aria-label="Engines"]')!;
  assert.match(strip.textContent ?? "", /Archon offline/);
  const radios = [...strip.querySelectorAll<HTMLInputElement>('[role="radiogroup"][aria-label="Factory"] input[type="radio"]')];
  assert.deepEqual(radios.map((r) => [r.value, r.checked]), [["ACTIVE", true], ["PAUSED", false]]);
  assert.ok([...strip.querySelectorAll("button")].some((b) => b.textContent === "Halt"));
  assert.match(strip.textContent ?? "", /Factory today \$1\.25/);
  assert.match(strip.textContent ?? "", /Praxis: Signed in/);
});

const click = async (el: Element) => act(async () => (el as HTMLElement).click());
const buttonNamed = (root: Element, name: string) =>
  [...root.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);

test("Halt halts the Factory only on its second press; the switch pauses it", async () => {
  const { container, calls } = await render();
  const strip = container.querySelector('section[aria-label="Engines"]')!;
  await click(buttonNamed(strip, "Halt")!);
  assert.deepEqual(calls.invoked, []);
  await click(buttonNamed(strip, "Press again to halt")!);
  assert.deepEqual(calls.invoked, [["machina_set_loop_mode", { mode: "HALTED" }]]);
  await click(strip.querySelector('input[value="PAUSED"]')!);
  assert.deepEqual(calls.invoked[calls.invoked.length - 1], ["machina_set_loop_mode", { mode: "PAUSED" }]);
});

const praxisRun = (workOrderId: string, over: Record<string, unknown> = {}) => ({
  workOrderId,
  runId: `run-${workOrderId}`,
  revision: 1,
  createdAt: NOW - HOUR,
  createdAtText: "",
  updatedAt: null,
  updatedAtText: null,
  status: "AWAITING_APPROVAL",
  stage: null,
  control: "NONE",
  held: false,
  awaitingApproval: true,
  needsYou: true,
  runPageAddress: "https://127.0.0.1:8443/runs/x",
  ...over,
});

const rowsOf = (container: HTMLElement, section: string) =>
  [...container.querySelectorAll(`section[aria-label="${section}"] li`)] as HTMLElement[];

test("Needs you lists every engine's waiting runs with their action chip, three lines and a segment bar", async () => {
  const { container, calls } = await render(
    data({
      archon: { online: true, runs: [archon("approve-me", "paused", { nodes_total: 3, nodes_completed: 1, active_nodes: ["gate"], total_cost_usd: 2 })], workflows: [], tasks: [] },
      factory: { status: STATUS, workOrders: [workOrder("WO-9", { status: "AWAITING_ACCEPTANCE", updatedAtMs: NOW - 2 * HOUR })] },
      praxis: { condition: { state: "signedIn" }, graphs: [], runs: [{ workflow: "review", run: praxisRun("wo_p", { createdAt: NOW - 3 * HOUR }) }] },
    }),
  );
  const rows = rowsOf(container, "Needs you");
  assert.equal(rows.length, 3);
  const [first] = rows;
  const lines = [...first.querySelectorAll("[data-line]")].map((l) => l.textContent);
  assert.deepEqual(lines, ["Aapprove-me", "Awaiting approval · $2.00"]);
  assert.deepEqual([...first.querySelectorAll("[data-segment]")].map((s) => s.getAttribute("data-segment")), ["done", "waiting", "pending"]);
  assert.deepEqual(
    rows.map((r) => r.querySelector("[data-chip]")?.textContent),
    ["Approve", "Merge", "Browser"],
  );
  await click(first.querySelector("button")!);
  assert.equal(calls.picked.length, 1);
  assert.equal(calls.picked[0].engine, "archon");
  // A chip shows the run's decision too; a Praxis decision opens in the browser.
  await click(rows[1].querySelector("[data-chip]")!);
  assert.equal(calls.picked[1].engine, "factory");
  await click(rows[2].querySelector("[data-chip]")!);
  assert.equal(calls.picked.length, 2);
  assert.deepEqual(calls.browser.map((s) => s.engine), ["praxis"]);
});

test("Needs you grows to five rows, then scrolls", async () => {
  const runs = Array.from({ length: 7 }, (_, i) => archon(`run-${i}`, "paused"));
  const { container } = await render(data({ archon: { online: true, runs, workflows: [], tasks: [] } }));
  const list = container.querySelector<HTMLElement>('section[aria-label="Needs you"] ul')!;
  assert.equal(rowsOf(container, "Needs you").length, 7);
  assert.equal(list.getAttribute("data-max-rows"), "5");
  assert.match(list.className, /overflow-y-auto/);
});

test("Running and Recent list the runs that are going and those that finished in the last 24 hours", async () => {
  const { container } = await render(
    data({
      archon: {
        online: true,
        runs: [archon("going", "running"), archon("done", "completed", { completed_ms: NOW - 2 * HOUR }), archon("stale", "completed", { completed_ms: NOW - 30 * HOUR })],
        workflows: [],
        tasks: [],
      },
      factory: { status: STATUS, workOrders: [workOrder("WO-2", { status: "GATING" })] },
    }),
  );
  assert.deepEqual(rowsOf(container, "Running").map((r) => r.querySelector("[data-line]")?.textContent), ["Agoing", "FWO-2 Add a greeting"]);
  assert.deepEqual(rowsOf(container, "Recent").map((r) => r.querySelector("[data-line]")?.textContent), ["Adone"]);
  assert.match(container.querySelector('section[aria-label="Needs you"]')!.textContent ?? "", /Nothing needs you/);
});

const task = (id: string, title: string, completed = false): SpecTask => ({ id, title, completed, line_number: 1, section: "", file_name: "tasks.md" });
const workflow = (name: string): ArchonWorkflow => ({ id: name, name });

test("Start holds pinned workflows, the top 3 open spec tasks with Agent, 3 recent Praxis graphs, and the Factory's stage tabs", async () => {
  const { container, calls } = await render(
    data({
      archon: {
        online: true,
        runs: [],
        workflows: [workflow("owner/lril-sdlc:implement"), workflow("owner/lril-sdlc:triage"), workflow("archon-ship")],
        tasks: [task("1", "Done already", true), task("2", "Parse the flag"), task("3", "Write the docs"), task("4", "Add the test"), task("5", "Fourth open")],
      },
      praxis: { condition: { state: "signedIn" }, graphs: ["g-new", "g-mid", "g-old", "g-older"], runs: [] },
    }),
    ["owner/lril-sdlc:implement", "gone/workflow"],
  );
  const start = container.querySelector<HTMLElement>('section[aria-label="Start"]')!;
  const pinned = start.querySelector('[aria-label="Pinned workflows"]')!;
  // A pin whose workflow Archon no longer lists isn't offered.
  assert.deepEqual([...pinned.querySelectorAll("[data-run-workflow]")].map((b) => b.textContent), ["lril-sdlc:implement"]);
  await click(pinned.querySelector("[data-run-workflow]")!);
  const tasks = [...start.querySelectorAll('[aria-label="Spec tasks"] li')];
  assert.deepEqual(tasks.map((t) => t.querySelector("[data-task]")?.textContent), ["Parse the flag", "Write the docs", "Add the test"]);
  await click(buttonNamed(tasks[1], "Agent: Write the docs")!);
  await click(buttonNamed(start, "All tasks and ADRs")!);
  const graphs = [...start.querySelectorAll('[aria-label="Recent Praxis graphs"] button')];
  assert.deepEqual(graphs.map((g) => g.textContent), ["g-new", "g-mid", "g-old"]);
  await click(graphs[0]);
  await click(buttonNamed(start, "New work order")!);
  await click(buttonNamed(start, "Factory config")!);
  assert.deepEqual(calls.start, ["run owner/lril-sdlc:implement", "agent Write the docs", "all tasks", "graph g-new", "new work order", "factory config"]);
});

test("a workflow is pinned from Start's picker and unpinned from its chip", async () => {
  const { container, calls } = await render(
    data({ archon: { online: true, runs: [], workflows: [workflow("owner/a"), workflow("owner/b")], tasks: [] } }),
    ["owner/a"],
  );
  const start = container.querySelector<HTMLElement>('section[aria-label="Start"]')!;
  const picker = start.querySelector<HTMLSelectElement>("select")!;
  assert.equal(picker.labels?.[0]?.textContent ?? picker.getAttribute("aria-label"), "Pin a workflow");
  // Only workflows not pinned yet are offered.
  assert.deepEqual([...picker.options].map((o) => o.value), ["", "owner/b"]);
  await act(async () => {
    picker.value = "owner/b";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(buttonNamed(start, "Unpin a")!);
  assert.deepEqual(calls.start, ["pin owner/b", "unpin owner/a"]);
});
