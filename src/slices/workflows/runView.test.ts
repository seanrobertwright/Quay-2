/// <reference types="node" />
// Component tests for the companion's Run view (#645): the picked run or work order and its
// decision. Tauri's `invoke`, the out-of-process boundary, is faked and records each call.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ArchonRun } from "../archon/types.ts";
import type { MachinaWorkOrder } from "../machina/types.ts";
import type { RunSource } from "./workflowRuns.ts";

const { RunView } = await import("./RunView.tsx");

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 15, 18, 0);

const archon = (status: string, over: Partial<ArchonRun> = {}): ArchonRun => ({
  id: "run-1",
  workflow_name: "owner/lril-sdlc:implement",
  status,
  started_ms: NOW - HOUR,
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
  invoked: [string, Record<string, unknown>][];
  changed: number;
  lens: number;
  browser: number;
}

async function render(source: RunSource) {
  const calls: Calls = { invoked: [], changed: 0, lens: 0, browser: 0 };
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
      createElement(RunView, {
        source,
        now: NOW,
        onChanged: () => calls.changed++,
        onOpenLens: () => calls.lens++,
        onOpenInBrowser: () => calls.browser++,
      }),
    ),
  );
  return { container, calls };
}

const click = async (el: Element) => act(async () => (el as HTMLElement).click());
const buttonNamed = (root: Element, name: string) =>
  [...root.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);
const buttonNames = (root: Element) => [...root.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());

test("an Archon run at an approval gate offers Approve or Reject, with an optional comment", async () => {
  const { container, calls } = await render({ engine: "archon", run: archon("paused") });
  assert.match(container.textContent ?? "", /lril-sdlc:implement/);
  assert.match(container.textContent ?? "", /Awaiting approval/);
  const comment = container.querySelector<HTMLTextAreaElement>("textarea")!;
  assert.equal(document.querySelector(`label[for="${comment.id}"]`)?.textContent, "Comment (optional)");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(comment), "value")!.set!;
    setValue.call(comment, "ship it");
    comment.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(buttonNamed(container, "Approve")!);
  assert.deepEqual(calls.invoked, [["archon_run_action", { runId: "run-1", action: "approve", text: "ship it" }]]);
  assert.equal(calls.changed, 1);
  assert.ok(buttonNames(container).includes("Reject"));
});

test("a failed Archon run offers Resume, and Abandon once pressed twice", async () => {
  const { container, calls } = await render({ engine: "archon", run: archon("failed", { completed_ms: NOW - HOUR }) });
  await click(buttonNamed(container, "Resume")!);
  assert.deepEqual(calls.invoked, [["archon_run_action", { runId: "run-1", action: "resume", text: null }]]);
  await click(buttonNamed(container, "Abandon")!);
  assert.equal(calls.invoked.length, 1);
  await click(buttonNamed(container, "Press again to abandon")!);
  assert.deepEqual(calls.invoked[calls.invoked.length - 1], ["archon_run_action", { runId: "run-1", action: "abandon", text: null }]);
});

const workOrder = (over: Partial<MachinaWorkOrder>): MachinaWorkOrder => ({
  id: "WO-3",
  title: "Add a greeting",
  objective: "",
  repoPath: "C:/repo",
  baseBranch: "main",
  baseSha: "a".repeat(40),
  branchName: "machina/wo-3",
  worktreePath: "C:/repo/wt",
  authorAgent: "claude",
  authorTerminalId: null,
  allowedOutputPaths: [],
  dependsOn: [],
  maxCorrections: 2,
  attempts: 1,
  budgetUsd: 5,
  spend: { measured: true, usd: 0.5, responses: 1, note: "" },
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

test("a Factory hold offers the hold's own options", async () => {
  const hold = {
    reason: "SCOPE_DRIFT" as const,
    summary: "Touched files outside the allowed paths",
    createdAtMs: NOW - HOUR,
    options: [
      { id: "allow", label: "Allow the files", description: "Widen the scope", variant: "primary" as const },
      { id: "abort", label: "Abort", description: "Stop the work order", variant: "danger" as const },
    ],
  };
  const { container, calls } = await render({ engine: "factory", workOrder: workOrder({ status: "ON_HOLD", hold }) });
  assert.match(container.textContent ?? "", /Touched files outside the allowed paths/);
  await click([...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Allow the files"))!);
  assert.deepEqual(calls.invoked, [["machina_resolve_hold", { request: { workOrderId: "WO-3", optionId: "allow" } }]]);
  assert.equal(calls.changed, 1);
});

test("a work order whose gate passed offers Accept, which squash-merges it into its base branch", async () => {
  const { container, calls } = await render({ engine: "factory", workOrder: workOrder({ status: "AWAITING_ACCEPTANCE" }) });
  await click(buttonNamed(container, "Accept: squash-merge into main")!);
  assert.deepEqual(calls.invoked, [["machina_accept_and_merge", { workOrderId: "WO-3" }]]);
});

test("an interrupted work order offers Resume", async () => {
  const { container, calls } = await render({ engine: "factory", workOrder: workOrder({ status: "INTERRUPTED" }) });
  await click(buttonNamed(container, "Resume")!);
  assert.deepEqual(calls.invoked, [["machina_resume", { workOrderId: "WO-3" }]]);
});

test("a Praxis decision opens in the browser; every run opens its graph and log in the run lens", async () => {
  const run = {
    workOrderId: "wo_1",
    runId: "r1",
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
    runPageAddress: "https://127.0.0.1:8443/r",
  };
  const { container, calls } = await render({ engine: "praxis", workflow: "review", run });
  await click(buttonNamed(container, "Open in browser")!);
  assert.equal(calls.browser, 1);
  assert.deepEqual(calls.invoked, []);
  await click(buttonNamed(container, "Graph and log")!);
  assert.equal(calls.lens, 1);
});

test("a running run has no decision to make", async () => {
  const { container } = await render({ engine: "archon", run: archon("running") });
  assert.equal(container.querySelector('section[aria-label="Decision"]'), null);
  assert.match(container.textContent ?? "", /Nothing waits on you/);
});
