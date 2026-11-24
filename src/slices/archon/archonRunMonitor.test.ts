/// <reference types="node" />
// Component tests for the QUAY badge on the Archon run monitor's decisions (#714), drawn as the run
// lens draws it, one run alone, and as the graph modal does, beside the run list: an approval gate,
// and a failed run's Resume or Abandon, each carry the badge, without the Quay mark's glow, and a run
// that waits on neither carries none. Tauri's `invoke`, the out-of-process boundary, is faked:
// `archon_get_run_detail` answers with a run's detail.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ArchonPendingApproval, ArchonRun } from "./types.ts";

const { ArchonRunMonitor } = await import("./ArchonRunMonitor.tsx");

const NOW = Date.UTC(2026, 10, 24, 18, 0);
const PLACES = [
  { place: "run lens", showRunList: false },
  { place: "graph modal", showRunList: true },
];

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (!mounted) return;
  act(() => mounted?.root.unmount());
  mounted.container.remove();
  mounted = null;
});

async function render(status: string, showRunList: boolean, pendingApproval: ArchonPendingApproval | null = null) {
  const run: ArchonRun = { id: "run-1", workflow_name: "owner/lril-sdlc:implement", status, started_ms: NOW - 60_000 };
  fakeInvoke(async (command) => {
    if (command !== "archon_get_run_detail") throw new Error(`no fake for ${command}`);
    return {
      run,
      nodes: [],
      active_nodes: [],
      logs: [],
      total_events: 0,
      hidden_hook_events: 0,
      logs_truncated: false,
      messages: [],
      pending_approval: pendingApproval,
      fetched_at_ms: NOW,
    };
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(ArchonRunMonitor, {
        runs: [run],
        workflows: [],
        selectedRunId: run.id,
        onSelectRun: () => {},
        serviceOnline: true,
        showRunList,
      }),
    ),
  );
  // The monitor's first read lands after its effect starts.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return container;
}

/** Every QUAY badge in `root` that a screen reader reads. */
const badges = (root: Element) =>
  [...root.querySelectorAll("span")].filter((span) => span.textContent === "QUAY" && !span.closest('[aria-hidden="true"]'));

/** The names of the buttons in the smallest element around `badge` that holds any. */
const asksFor = (badge: Element) => {
  let around: Element | null = badge;
  while (around && around.querySelectorAll("button").length === 0) around = around.parentElement;
  return [...(around?.querySelectorAll("button") ?? [])].map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim());
};

for (const { place, showRunList } of PLACES) {
  test(`an approval gate in the ${place} carries the QUAY badge, without the glow`, async () => {
    const container = await render("paused", showRunList, { prompt: "Ship it?", node_id: "gate" });
    assert.deepEqual(badges(container).map(asksFor), [["Approve", "Reject"]]);
    assert.equal(container.querySelectorAll("[data-neon]").length, 0, "no glow in a lens");
  });

  test(`a failed run's Resume or Abandon in the ${place} carries the QUAY badge, without the glow`, async () => {
    const container = await render("failed", showRunList);
    assert.deepEqual(badges(container).map(asksFor), [["Resume", "Abandon", "Refresh run"]]);
    assert.equal(container.querySelectorAll("[data-neon]").length, 0, "no glow in a lens");
  });

  // Cancel and Refresh are the operator's own to press, so they ask nothing.
  for (const status of ["running", "pending", "completed", "cancelled"]) {
    test(`a ${status} run in the ${place} carries no QUAY badge`, async () => {
      assert.equal(badges(await render(status, showRunList)).length, 0);
    });
  }
}
