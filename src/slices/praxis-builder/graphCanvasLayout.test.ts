/// <reference types="node" />
// Component tests for the graph canvas's line about a saved layout it ignored: a graph whose
// `.praxis/layout/<id>.json` `praxis_read` reports it can't use opens with a line above the canvas
// that says why, in the words the run canvas uses too (runCanvas.test.ts).
// They render the real builder into happy-dom and fake only Tauri's `invoke`, the out-of-process
// boundary.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FileProblem } from "./types.ts";

const { PraxisBuilderModal } = await import("./PraxisBuilderModal.tsx");

// The builder watches Quay's window for closing, which asks Tauri which window it is.
Object.assign((window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__, { metadata: { currentWindow: { label: "main" } } });

const PROJECT = "C:/project";
const GRAPH = "release-review";

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
});

/**
 * The backend: the project lists one graph, GRAPH, which `praxis_read` gives with `layoutProblem`
 * as why its layout file was ignored, or with no layout file; it has no other records and no host
 * set up. Every command it answers only reads. Returns each command it doesn't answer, as a write
 * would be.
 */
function fakeBackend(layoutProblem: FileProblem | undefined): string[] {
  const unanswered: string[] = [];
  fakeInvoke(async (command, args) => {
    switch (command) {
      case "praxis_list":
        return { entries: args.kind === "graphs" ? [{ id: GRAPH }] : [], truncated: false };
      case "praxis_changes":
        return { files: [] };
      case "praxis_check_context":
        return { contracts: [], unchecked: [] };
      case "praxis_read":
        return {
          id: GRAPH,
          kind: "graphs",
          missing: false,
          contentHash: "h",
          content: { id: GRAPH, revision: "r", nodes: [{ id: "build", kind: "TASK", dependsOn: [], config: {} }] },
          layoutProblem,
        };
      case "praxis_graph_pin":
        return null;
      case "praxis_binding_suggestions":
        return { agentId: [], protocolBindingId: [], action: [], resource: [] };
      case "praxis_validate":
        return { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
      case "praxis_host_condition":
        return { state: "noHostSetUp" };
      case "praxis_host_workflows_list":
      case "praxis_host_graphs_list":
        return { kind: "noHost", message: `praxis: There is no Praxis host connection descriptor at ${PROJECT}.` };
      default:
        unanswered.push(command);
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  return unanswered;
}

/** Shows the builder on the project and opens graph GRAPH from its list. */
async function openGraph(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  const builder = createElement(PraxisBuilderModal, { isOpen: true, project: { path: PROJECT, name: "project" }, onClose: () => {}, onAddProject: () => {} });
  await act(async () => root.render(builder));
  const row = [...container.querySelectorAll("button")].find((b) => b.title === GRAPH);
  assert.ok(row, "the list has a row for the graph");
  await act(async () => row.click());
  assert.ok(container.querySelector('.react-flow__node[data-id="build"]'), "the graph is drawn");
  return container;
}

/** The text of each status line, the lines that tell of the open graph. */
const statusLines = (root: HTMLElement) => [...root.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? "");

test("the graph canvas says why it ignored a graph's saved layout, in the run canvas's words", async () => {
  const unanswered = fakeBackend({ message: "Not valid JSON: key must be a string at line 1 column 2", line: 1, column: 2 });
  const root = await openGraph();
  const line = ".praxis/layout/release-review.json was ignored, so the graph is laid out automatically: Not valid JSON: key must be a string at line 1 column 2";
  assert.ok(statusLines(root).includes(line), JSON.stringify(statusLines(root)));
  assert.deepEqual(unanswered, [], "only reads were sent, so no layout file was written");
});

test("a graph with no layout file opens with no line about its layout", async () => {
  const unanswered = fakeBackend(undefined);
  const root = await openGraph();
  assert.deepEqual(
    statusLines(root).filter((line) => line.includes("was ignored")),
    [],
  );
  assert.deepEqual(unanswered, [], "only reads were sent");
});
