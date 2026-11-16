/// <reference types="node" />
// What the Workflows panel reads from the three engines (#645), through Tauri's `invoke`, the
// out-of-process boundary, which is faked here: Archon's server, Machina, and the Praxis CLI
// runner for the builder project's graphs and graph workflow runs.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkflowsData } from "./workflowsData.ts";

const { useWorkflowsData } = await import("./useWorkflowsData.ts");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function read(answers: Record<string, (args: Record<string, unknown>) => unknown>, active = true) {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  const asked: string[] = [];
  fakeInvoke(async (command, args) => {
    asked.push(command);
    const answer = answers[command];
    if (!answer) throw new Error(`no fake for ${command}`);
    return answer(args);
  });
  let latest: WorkflowsData | null = null;
  const Harness = () => {
    latest = useWorkflowsData({ active, project: "C:/repo", praxisProject: "C:/repo", recentGraphs: ["g2"] }).data;
    return null;
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(Harness)));
  for (let i = 0; i < 5; i++) await settle();
  return { data: latest as unknown as WorkflowsData, asked };
}

const GRAPH_RUN = { workOrderId: "wo_1", runId: "r1", createdAt: "2026-11-15T10:00:00Z", status: "RUNNING", control: "NONE", held: false, workflowRevision: 1, awaitingApproval: false };

const ANSWERS: Record<string, (args: Record<string, unknown>) => unknown> = {
  archon_check_service: () => ({ running: true, port: 3090, message: "" }),
  archon_get_runs: () => [{ id: "run-1", workflow_name: "w", status: "running" }],
  archon_get_workflows: () => [{ id: "w", name: "w" }],
  archon_parse_repo_specs: () => ({ project_path: "C:/repo", tasks: [{ id: "t", title: "Task", completed: false, line_number: 1, section: "", file_name: "tasks.md" }], adrs: [], spec_files_found: [] }),
  machina_get_status: () => ({ loopMode: "PAUSED" }),
  machina_list_work_orders: () => [{ id: "WO-1" }],
  praxis_host_condition: () => ({ state: "signedIn" }),
  praxis_list: (args) =>
    args.kind === "graphs" ? { entries: [{ id: "g1" }, { id: "g2" }], truncated: false } : { entries: [{ id: "review" }], truncated: false },
  praxis_host_graph_runs: (args) => ({ kind: "record", record: { runs: args.name === "review" ? [GRAPH_RUN] : [] } }),
};

test("the panel reads Archon's runs, workflows and spec tasks, the Factory, and the Praxis project's graphs and graph runs", async () => {
  const { data } = await read(ANSWERS);
  assert.equal(data.archon.online, true);
  assert.deepEqual(data.archon.runs.map((r) => r.id), ["run-1"]);
  assert.deepEqual(data.archon.workflows.map((w) => w.name), ["w"]);
  assert.deepEqual(data.archon.tasks.map((t) => t.title), ["Task"]);
  assert.equal(data.factory.status?.loopMode, "PAUSED");
  assert.deepEqual(data.factory.workOrders.map((w) => w.id), ["WO-1"]);
  assert.deepEqual(data.praxis.condition, { state: "signedIn" });
  // The recently opened graph comes first.
  assert.deepEqual(data.praxis.graphs, ["g2", "g1"]);
  assert.deepEqual(data.praxis.runs.map((r) => [r.workflow, r.run.workOrderId]), [["review", "wo_1"]]);
});

test("with Archon offline, its runs aren't asked for; while the panel is away nothing is read", async () => {
  const offline = { ...ANSWERS, archon_check_service: () => ({ running: false, port: 3090, message: "" }) };
  const { data, asked } = await read(offline);
  assert.equal(data.archon.online, false);
  assert.ok(!asked.includes("archon_get_runs"));
  const away = await read(ANSWERS, false);
  assert.deepEqual(away.asked.filter((c) => !c.startsWith("praxis_host_condition")), []);
});
