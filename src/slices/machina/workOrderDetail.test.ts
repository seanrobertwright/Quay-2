/// <reference types="node" />
// Component tests for the QUAY badge on the work order detail's decisions (#714): the hold's
// options, Accept: squash-merge and Resume each carry it, without the Quay mark's glow, and a work
// order that waits on none of them carries none.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MachinaWorkOrder, WorkOrderStatus } from "./types.ts";

const { WorkOrderDetail } = await import("./WorkOrderDetail.tsx");

const NOW = Date.UTC(2026, 10, 24, 18, 0);

const workOrder = (over: Partial<MachinaWorkOrder>): MachinaWorkOrder => ({
  id: "WO-7",
  title: "Pair each answer with its turn",
  objective: "Pair each answer with its turn.",
  repoPath: "C:/repo",
  baseBranch: "master",
  baseSha: "0123456789abcdef",
  branchName: "machina/wo-7",
  worktreePath: "C:/repo/.wt/wo-7",
  authorAgent: "claude",
  authorTerminalId: null,
  allowedOutputPaths: ["src/"],
  dependsOn: [],
  maxCorrections: 2,
  attempts: 1,
  budgetUsd: 5,
  spend: { measured: false, usd: 0, responses: 0, note: "" },
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
  createdAtMs: NOW - 120_000,
  updatedAtMs: NOW - 60_000,
  events: [],
  ...over,
});

const HELD = workOrder({
  status: "ON_HOLD",
  hold: {
    reason: "SCOPE_DRIFT",
    summary: "Two files are outside the allowed paths.",
    createdAtMs: NOW - 60_000,
    options: [
      { id: "allow", label: "Allow them", description: "Widen the scope.", variant: "primary" },
      { id: "abort", label: "Abort", description: "Stop the work order.", variant: "danger" },
    ],
  },
});

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (!mounted) return;
  act(() => mounted?.root.unmount());
  mounted.container.remove();
  mounted = null;
});

function render(wo: MachinaWorkOrder) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(WorkOrderDetail, {
        wo,
        now: NOW,
        terminals: [],
        busy: null,
        run: async () => {},
        onLaunchAuthor: () => {},
        onOpenTerminal: () => {},
      }),
    ),
  );
  mounted = { root, container };
  return container;
}

/** Every QUAY badge in `root` that a screen reader reads. */
const badges = (root: Element) =>
  [...root.querySelectorAll("span")].filter((span) => span.textContent === "QUAY" && !span.closest('[aria-hidden="true"]'));

/** The names of the buttons in the smallest element around `badge` that holds any. */
const asksFor = (badge: Element) => {
  let around: Element | null = badge;
  while (around && around.querySelectorAll("button").length === 0) around = around.parentElement;
  return [...(around?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.trim());
};

test("a hold's options carry the QUAY badge, without the glow", () => {
  const container = render(HELD);
  assert.deepEqual(badges(container).map(asksFor), [["Allow themWiden the scope.", "AbortStop the work order."]]);
  assert.equal(container.querySelectorAll("[data-neon]").length, 0, "no glow in a lens");
});

test("Accept: squash-merge carries the QUAY badge, without the glow", () => {
  const container = render(workOrder({ status: "AWAITING_ACCEPTANCE" }));
  assert.deepEqual(badges(container).map(asksFor), [["Accept: squash-merge into master"]]);
  assert.equal(container.querySelectorAll("[data-neon]").length, 0, "no glow in a lens");
});

for (const [status, scaffold, button] of [
  ["INTERRUPTED", "PASSED", "Resume"],
  ["FAILED", "PASSED", "Resume"],
  ["FAILED", "FAILED", "Retry the scaffold"],
] as const) {
  test(`${button} on a work order that is ${status} carries the QUAY badge, without the glow`, () => {
    const stages = [{ id: "scaffold" as const, status: scaffold, startedAtMs: null, finishedAtMs: null, detail: "" }];
    const container = render(workOrder({ status, stages }));
    assert.deepEqual(badges(container).map(asksFor), [[button]]);
    assert.equal(container.querySelectorAll("[data-neon]").length, 0, "no glow in a lens");
  });
}

// Run the gate, Remove the worktree and Abort are the operator's own to press, so they ask nothing.
const ASKS_NOTHING: WorkOrderStatus[] = ["QUEUED", "SCAFFOLDING", "IN_PROGRESS", "GATING", "COMPLETED", "ABORTED"];
for (const status of ASKS_NOTHING) {
  test(`a work order that is ${status} carries no QUAY badge`, () => {
    assert.equal(badges(render(workOrder({ status }))).length, 0);
  });
}
