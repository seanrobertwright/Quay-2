/// <reference types="node" />
// Component tests for the run lens (#645): a run's full graph and log over the stage, closing like
// the other lenses, from its close button or with Escape, with focus back on the selected
// terminal. Tauri's `invoke`, the out-of-process boundary, is faked: `archon_get_run_detail`
// answers with a run's nodes and log.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ArchonRun, ArchonRunDetail } from "../archon/types.ts";

const { RunLens } = await import("./RunLens.tsx");

const NOW = Date.UTC(2026, 10, 15, 18, 0);
const RUN: ArchonRun = { id: "run-1", workflow_name: "owner/lril-sdlc:implement", status: "running", started_ms: NOW - 60_000, nodes_total: 2, nodes_completed: 1 };
const DETAIL: ArchonRunDetail = {
  run: RUN,
  nodes: [{ node_id: "plan", state: "completed" }, { node_id: "build", state: "running" }],
  active_nodes: ["build"],
  logs: [{ id: "l1", kind: "tool", label: "Ran the test suite", node_id: "build" }],
  total_events: 1,
  hidden_hook_events: 0,
  logs_truncated: false,
  messages: [],
  fetched_at_ms: NOW,
};

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

async function render() {
  let closed = 0;
  fakeInvoke(async (command) => {
    if (command === "archon_get_run_detail") return DETAIL;
    throw new Error(`no fake for ${command}`);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(RunLens, {
        source: { engine: "archon", run: RUN },
        now: NOW,
        terminalId: "t1",
        projectPath: "C:/repo",
        archonOnline: true,
        workflows: [],
        terminals: [],
        onChanged: () => {},
        onSelectTerminal: () => {},
        onSpawnTerminal: async () => null,
        replyStrip: null,
        onClose: () => closed++,
      }),
    ),
  );
  // The monitor's first read lands after its effect starts.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return { container, closed: () => closed };
}

test("the run lens shows a run's graph and log, and closes from its button with focus back on the terminal", async () => {
  const focused: string[] = [];
  const listener = (e: Event) => focused.push((e as CustomEvent<{ terminalId: string }>).detail.terminalId);
  window.addEventListener("quay:focus-terminal", listener);
  try {
    const { container, closed } = await render();
    const lens = container.querySelector<HTMLElement>('section[aria-label="Run lens"]')!;
    assert.ok(lens, "the run lens is open");
    assert.match(lens.querySelector("h2")?.textContent ?? "", /lril-sdlc:implement/);
    assert.match(lens.textContent ?? "", /build/);
    assert.match(lens.textContent ?? "", /Ran the test suite/);
    // The run list beside the monitor is the panel's job, so the lens shows the one run.
    assert.equal(lens.querySelector('nav[aria-label="Archon runs"]'), null);
    await act(async () => [...lens.querySelectorAll("button")].find((b) => b.textContent === "Close lens")!.click());
    assert.equal(closed(), 1);
    assert.deepEqual(focused, ["t1"]);
  } finally {
    window.removeEventListener("quay:focus-terminal", listener);
  }
});

test("Escape closes the run lens", async () => {
  const { container, closed } = await render();
  await act(async () => void container.querySelector("section")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(closed(), 1);
});
