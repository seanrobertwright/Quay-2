// The Workflows panel's run rows (#645): what each Archon run, Factory work order and Praxis run
// shows, which section it lands in, its action chip and its segment bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArchonRun } from "../archon/types.ts";
import type { MachinaWorkOrder, StageRecord } from "../machina/types.ts";
import type { RunRow } from "../praxis-builder/runsList.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import { epochMsFromLocalParts } from "../../lib/dates.ts";
import { archonRunRow, factorySpendToday, panelSections, praxisRunRow, runTerminalId, workOrderRow } from "./workflowRuns.ts";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const archon = (over: Partial<ArchonRun>): ArchonRun => ({
  id: "run-1",
  workflow_name: "owner/lril-sdlc:implement",
  status: "running",
  started_ms: NOW - HOUR,
  ...over,
});

test("an Archon run waiting for approval needs you, with Approve, and its nodes as segments", () => {
  const row = archonRunRow(archon({ status: "paused", nodes_total: 4, nodes_completed: 2, active_nodes: ["review"], total_cost_usd: 1.5 }), NOW);
  assert.equal(row.section, "needs-you");
  assert.equal(row.chip, "Approve");
  assert.equal(row.engine, "archon");
  assert.equal(row.name, "lril-sdlc:implement");
  assert.equal(row.status, "Awaiting approval");
  assert.equal(row.spendUsd, 1.5);
  assert.deepEqual(row.segments.map((s) => s.state), ["done", "done", "waiting", "pending"]);
  assert.deepEqual(row.decision, { kind: "archon-approval" });
});

test("a failed Archon run needs you with Resume however long ago it failed", () => {
  const failed = archonRunRow(archon({ status: "failed", nodes_total: 3, nodes_completed: 1, completed_ms: NOW - 2 * HOUR }), NOW);
  assert.equal(failed.section, "needs-you");
  assert.equal(failed.chip, "Resume");
  assert.deepEqual(failed.segments.map((s) => s.state), ["done", "failed", "pending"]);
  assert.deepEqual(failed.decision, { kind: "archon-failed" });
  const old = archonRunRow(archon({ status: "failed", completed_ms: NOW - 25 * HOUR }), NOW);
  assert.equal(old.section, "needs-you");
  assert.equal(old.chip, "Resume");
});

test("a running Archon run is Running; a completed one is Recent for 24 hours", () => {
  const running = archonRunRow(archon({ status: "running", nodes_total: 3, nodes_completed: 1, active_nodes: ["a"] }), NOW);
  assert.equal(running.section, "running");
  assert.equal(running.chip, null);
  assert.deepEqual(running.segments.map((s) => s.state), ["done", "running", "pending"]);
  const done = archonRunRow(archon({ status: "completed", nodes_total: 2, nodes_completed: 2, completed_ms: NOW - 23 * HOUR }), NOW);
  assert.equal(done.section, "recent");
  assert.deepEqual(done.segments.map((s) => s.state), ["done", "done"]);
  assert.equal(done.decision, null);
  assert.equal(archonRunRow(archon({ status: "completed", completed_ms: NOW - 25 * HOUR }), NOW).section, null);
});

const stage = (id: StageRecord["id"], status: StageRecord["status"]): StageRecord => ({ id, status, startedAtMs: null, finishedAtMs: null, detail: "" });
const workOrder = (over: Partial<MachinaWorkOrder>): MachinaWorkOrder => ({
  id: "WO-7",
  title: "Add a greeting",
  objective: "",
  repoPath: "C:/repo",
  baseBranch: "main",
  baseSha: "a".repeat(40),
  branchName: "machina/wo-7",
  worktreePath: "C:/repo/.machina/worktrees/wo-7",
  authorAgent: "claude",
  authorTerminalId: null,
  allowedOutputPaths: [],
  dependsOn: [],
  maxCorrections: 2,
  attempts: 1,
  budgetUsd: 5,
  spend: { measured: true, usd: 0.42, responses: 3, note: "" },
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
  createdAtMs: NOW - 3 * HOUR,
  updatedAtMs: NOW - HOUR,
  events: [],
  ...over,
});

test("a work order on hold needs you with Hold, its stages coloured as segments", () => {
  const row = workOrderRow(
    workOrder({
      status: "ON_HOLD",
      stages: [stage("admission", "PASSED"), stage("scaffold", "PASSED"), stage("implementation", "RUNNING"), stage("gate", "ON_HOLD"), stage("correction", "FAILED"), stage("acceptance", "PENDING")],
    }),
    NOW,
  );
  assert.equal(row.key, "factory:WO-7");
  assert.equal(row.engine, "factory");
  assert.equal(row.name, "WO-7 Add a greeting");
  assert.equal(row.status, "On hold");
  assert.equal(row.spendUsd, 0.42);
  assert.equal(row.section, "needs-you");
  assert.equal(row.chip, "Hold");
  assert.deepEqual(row.decision, { kind: "factory-hold" });
  assert.deepEqual(row.segments.map((s) => s.state), ["done", "done", "running", "waiting", "failed", "pending"]);
});

test("a work order awaiting merge needs you with Merge; running stages are Running; merged ones are Recent", () => {
  const awaiting = workOrderRow(workOrder({ status: "AWAITING_ACCEPTANCE" }), NOW);
  assert.equal(awaiting.chip, "Merge");
  assert.deepEqual(awaiting.decision, { kind: "factory-accept" });
  for (const status of ["QUEUED", "SCAFFOLDING", "IN_PROGRESS", "GATING"] as const) {
    assert.equal(workOrderRow(workOrder({ status }), NOW).section, "running", status);
  }
  const merged = workOrderRow(workOrder({ status: "COMPLETED", updatedAtMs: NOW - 2 * HOUR }), NOW);
  assert.equal(merged.section, "recent");
  assert.equal(merged.decision, null);
  assert.equal(workOrderRow(workOrder({ status: "ABORTED", updatedAtMs: NOW - 30 * HOUR }), NOW).section, null);
});

test("an interrupted or failed work order needs you with Resume", () => {
  for (const status of ["INTERRUPTED", "FAILED"] as const) {
    const row = workOrderRow(workOrder({ status }), NOW);
    assert.equal(row.section, "needs-you", status);
    assert.equal(row.chip, "Resume");
    assert.deepEqual(row.decision, { kind: "factory-resume" });
  }
});

const praxis = (over: Partial<RunRow>): RunRow => ({
  workOrderId: "wo_1",
  runId: "run_1",
  revision: 2,
  createdAt: NOW - HOUR,
  createdAtText: "",
  updatedAt: null,
  updatedAtText: null,
  status: "RUNNING",
  stage: null,
  control: "NONE",
  held: false,
  awaitingApproval: false,
  needsYou: false,
  runPageAddress: "https://127.0.0.1:8443/runs/wo_1",
  ...over,
});

test("a Praxis run that needs you opens in the browser; a finished one is Recent", () => {
  const waiting = praxisRunRow("review-graph", praxis({ status: "AWAITING_APPROVAL", awaitingApproval: true, needsYou: true }), NOW);
  assert.equal(waiting.key, "praxis:review-graph/wo_1");
  assert.equal(waiting.engine, "praxis");
  assert.equal(waiting.name, "review-graph");
  assert.equal(waiting.section, "needs-you");
  assert.equal(waiting.chip, "Browser");
  assert.deepEqual(waiting.decision, { kind: "praxis-browser" });
  assert.deepEqual(waiting.segments.map((s) => s.state), ["waiting"]);
  assert.equal(waiting.spendUsd, null);
  const running = praxisRunRow("review-graph", praxis({}), NOW);
  assert.equal(running.section, "running");
  assert.deepEqual(running.segments.map((s) => s.state), ["running"]);
  const failed = praxisRunRow("review-graph", praxis({ status: "FAILED" }), NOW);
  assert.equal(failed.section, "recent");
  assert.deepEqual(failed.segments.map((s) => s.state), ["failed"]);
  const done = praxisRunRow("review-graph", praxis({ status: "COMPLETED", createdAt: NOW - 30 * HOUR }), NOW);
  assert.equal(done.section, null);
});

test("sections hold their rows newest first, and drop rows outside every section", () => {
  const rows = [
    archonRunRow(archon({ id: "old", status: "paused", started_ms: NOW - 3 * HOUR }), NOW),
    workOrderRow(workOrder({ id: "WO-1", status: "ON_HOLD", updatedAtMs: NOW - HOUR }), NOW),
    archonRunRow(archon({ id: "r", status: "running" }), NOW),
    archonRunRow(archon({ id: "gone", status: "completed", completed_ms: NOW - 48 * HOUR }), NOW),
    workOrderRow(workOrder({ id: "WO-2", status: "COMPLETED", updatedAtMs: NOW - 5 * HOUR }), NOW),
  ];
  const sections = panelSections(rows);
  assert.deepEqual(sections.needsYou.map((r) => r.id), ["WO-1", "old"]);
  assert.deepEqual(sections.running.map((r) => r.id), ["r"]);
  assert.deepEqual(sections.recent.map((r) => r.id), ["WO-2"]);
});

test("today's Factory spend adds the work orders that changed today, by the local calendar", () => {
  const midnight = epochMsFromLocalParts({ year: 2026, month: 11, day: 15, hour: 0, minute: 0 })!;
  const now = midnight + 10 * HOUR;
  const orders = [
    workOrder({ id: "a", updatedAtMs: midnight + HOUR, spend: { measured: true, usd: 1.25, responses: 1, note: "" } }),
    workOrder({ id: "b", updatedAtMs: now, spend: { measured: true, usd: 0.5, responses: 1, note: "" } }),
    workOrder({ id: "c", updatedAtMs: midnight - 1, spend: { measured: true, usd: 9, responses: 1, note: "" } }),
  ];
  assert.equal(factorySpendToday(orders, now), 1.75);
  assert.equal(factorySpendToday([], now), 0);
});

const term = (id: string, over: Partial<TerminalInfo>): TerminalInfo => ({
  id,
  name: id,
  project_path: "C:/repo",
  run_kind: "archon",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "working",
  auto_approved_count: 0,
  ...over,
});

test("a run's own terminal: a work order's author terminal, or the Archon terminal working in the run's folder", () => {
  const terminals = [term("shell", { run_kind: "powershell", project_path: "C:/wt/a" }), term("arch", { project_path: "c:\\wt\\a\\" }), term("author", { run_kind: "claude" })];
  assert.equal(runTerminalId({ engine: "archon", run: archon({ working_path: "C:/wt/a" }) }, terminals), "arch");
  assert.equal(runTerminalId({ engine: "archon", run: archon({ working_path: "C:/elsewhere" }) }, terminals), null);
  assert.equal(runTerminalId({ engine: "archon", run: archon({ working_path: null }) }, terminals), null);
  assert.equal(runTerminalId({ engine: "factory", workOrder: workOrder({ authorTerminalId: "author" }) }, terminals), "author");
  // An author terminal that has since closed is no terminal to select.
  assert.equal(runTerminalId({ engine: "factory", workOrder: workOrder({ authorTerminalId: "closed" }) }, terminals), null);
  assert.equal(runTerminalId({ engine: "praxis", workflow: "g", run: praxis({}) }, terminals), null);
});
