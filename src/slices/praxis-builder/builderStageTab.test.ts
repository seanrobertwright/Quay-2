/// <reference types="node" />
// Component tests for the Praxis Builder as a stage tab (#646): no overlay of its own, the
// definitions list as a 40 px rail whose button opens the list over the canvas, and the Inspector
// drawn into the slot the companion's Inspector view gives it.
// They render the real builder into happy-dom and fake only Tauri's `invoke`, the out-of-process
// boundary.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { PraxisBuilder, DEFINITIONS_RAIL_WIDTH } = await import("./PraxisBuilder.tsx");
const { MODULE_BAR_WIDTH } = await import("../shell/ModuleBar.tsx");
const { DEFAULT_COMPANION_WIDTH } = await import("../companion/companionPrefs.ts");

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

/** The backend: the project lists one graph, GRAPH, with one TASK node, and no host is set up. */
function fakeBackend() {
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
        throw new Error(`unexpected invoke ${command}`);
    }
  });
}

/** The builder on the project, with the Inspector drawn into `inspectorSlot` when one is given. */
const builderOn = (isOpen: boolean, inspectorSlot: HTMLElement | null = null) =>
  createElement(PraxisBuilder, {
    isOpen,
    project: { path: PROJECT, name: "project" },
    onClose: () => {},
    onAddProject: () => {},
    inspectorSlot,
  });

/** Shows the builder on the project, with the Inspector drawn into `inspectorSlot` when one is given. */
async function showBuilder(inspectorSlot: HTMLElement | null = null): Promise<HTMLElement> {
  fakeBackend();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(builderOn(true, inspectorSlot)));
  return container;
}

/** Hides the builder, as leaving or closing its stage tab does. */
const hideBuilder = () => act(async () => mounted!.root.render(builderOn(false)));

const definitions = (root: HTMLElement) => root.querySelector('nav[aria-label="Definitions"]') as HTMLElement;
const graphRow = (root: HTMLElement) => {
  const row = [...definitions(root).querySelectorAll("button")].find((b) => b.title === GRAPH);
  assert.ok(row, "the list has a row for the graph");
  return row;
};
const railButton = (root: HTMLElement) => {
  const button = root.querySelector("[data-definitions-rail] button") as HTMLButtonElement | null;
  assert.ok(button, "the rail has a button");
  return button;
};

test("the definitions list is a 40 px rail whose button opens the list, and picking a definition closes it", async () => {
  const root = await showBuilder();
  const rail = root.querySelector("[data-definitions-rail]") as HTMLElement;
  assert.ok(rail, "the builder has a definitions rail");
  assert.equal(getComputedStyle(rail).width, "40px");

  // With no definition open, the list is open over the canvas so one can be picked.
  assert.equal(definitions(root).hidden, false);
  assert.equal(railButton(root).getAttribute("aria-expanded"), "true");
  await act(async () => graphRow(root).click());
  assert.ok(root.querySelector('.react-flow__node[data-id="build"]'), "the graph is drawn");
  assert.equal(definitions(root).hidden, true, "picking a definition closes the list");
  assert.equal(railButton(root).getAttribute("aria-expanded"), "false");
  assert.equal(railButton(root).getAttribute("aria-label"), "Show the definitions list");

  await act(async () => railButton(root).click());
  assert.equal(definitions(root).hidden, false, "the rail's button opens the list");
  assert.equal(railButton(root).getAttribute("aria-controls"), definitions(root).id);
  await act(async () => graphRow(root).click());
  assert.equal(definitions(root).hidden, true);
});

test("given an inspector slot, the Inspector for the selected node draws in the slot and the builder draws none of its own", async () => {
  const slot = document.createElement("div");
  document.body.appendChild(slot);
  try {
    const root = await showBuilder(slot);
    await act(async () => graphRow(root).click());
    const card = root.querySelector('.react-flow__node[data-id="build"]') as HTMLElement;
    assert.ok(card, "the graph is drawn");
    // Compared as a boolean: a failing assertion on a happy-dom element never finishes printing it.
    assert.equal(root.querySelector('[aria-label="Inspector"]') !== null, false, "the builder draws no inspector of its own");
    assert.match(slot.querySelector('[aria-label="Inspector"]')?.textContent ?? "", /No node selected/);

    await act(async () => card.click());
    const inspector = slot.querySelector('[aria-label="Inspector"]') as HTMLElement;
    assert.ok(inspector, "the Inspector is in the slot");
    assert.ok(
      [...inspector.querySelectorAll("input")].some((input) => input.value === "build"),
      "the Inspector shows the selected node's id",
    );
  } finally {
    slot.remove();
  }
});

test("the builder is drawn in its stage tab, not as an overlay: no modal dialog, backdrop or close button of its own", async () => {
  const root = await showBuilder();
  assert.equal(root.querySelectorAll('[aria-modal="true"], [role="dialog"]').length, 0);
  assert.equal(root.querySelectorAll(".fixed").length, 0, "nothing in the builder is laid over the window");
  assert.equal(
    [...root.querySelectorAll("button")].some((b) => b.getAttribute("aria-label") === "Close Praxis Builder"),
    false,
    "the stage tab closes it",
  );
  const builder = root.querySelector('[aria-label="Praxis Builder"]');
  assert.equal(builder?.tagName, "SECTION", "the builder is a region named Praxis Builder");
});

test("a builder that hides leaves the focus where the operator has taken it", async () => {
  const opener = document.createElement("button");
  const elsewhere = document.createElement("button");
  document.body.append(opener, elsewhere);
  try {
    opener.focus();
    const root = await showBuilder();
    assert.equal(root.contains(document.activeElement), true, "the builder takes the focus as it shows");
    elsewhere.focus();
    await hideBuilder();
    assert.equal(document.activeElement === elsewhere, true);
  } finally {
    opener.remove();
    elsewhere.remove();
  }
});

test("with no graph open, the inspector slot says what the Inspector will show", async () => {
  const slot = document.createElement("div");
  document.body.appendChild(slot);
  try {
    await showBuilder(slot);
    assert.match(slot.textContent ?? "", /Open a graph and select a node to inspect it\./);
  } finally {
    slot.remove();
  }
});

test("with the panel folded and the inspector in the companion, the canvas is about as wide as the spec's figures", () => {
  // The spec's Stage section: about 1,492 px at 1920, 1,172 at 1600 and 852 at 1280. The canvas
  // has the window less the module bar, the companion at its default width, and the rail with its
  // 1 px border.
  const canvas = (windowWidth: number) => windowWidth - MODULE_BAR_WIDTH - DEFAULT_COMPANION_WIDTH - DEFINITIONS_RAIL_WIDTH - 1;
  for (const [windowWidth, spec] of [
    [1920, 1492],
    [1600, 1172],
    [1280, 852],
  ]) {
    assert.ok(Math.abs(canvas(windowWidth) - spec) <= 2, `${canvas(windowWidth)} px at ${windowWidth}, not about ${spec}`);
  }
});
