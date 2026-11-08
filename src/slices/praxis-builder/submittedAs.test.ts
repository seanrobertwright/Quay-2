/// <reference types="node" />
// Component tests for a graph canvas's "Submitted as" chips (#467): one link per graph workflow
// whose graphId is the graph, each opening that graph workflow's form, and a note on each one
// whose graphBindingId isn't the binding the Binding dropdown shows. They render the real row
// into happy-dom; it reads only what it is given, so nothing is faked.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DefinitionRef, GraphWorkflowChoice } from "./types.ts";

const { SubmittedAs } = await import("./RunContextPanel.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;

function unmount() {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
}

afterEach(unmount);

const WORKFLOWS: GraphWorkflowChoice[] = [
  { id: "ship", contractId: "c", graphId: "g", graphBindingId: "g-1" },
  { id: "other-graph", contractId: "c", graphId: "h", graphBindingId: "h-1" },
  { id: "review", contractId: "c", graphId: "g", graphBindingId: "g-2" },
];

function render(graphId: string, workflows: readonly GraphWorkflowChoice[], shownBinding: string | null) {
  unmount();
  const opened: DefinitionRef[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() => root.render(createElement(SubmittedAs, { graphId, workflows, shownBinding, onOpen: (ref: DefinitionRef) => opened.push(ref) })));
  return { container, opened };
}

/** The row's chips, each a link, by accessible name (their text, as none has an aria-label). */
const chips = (container: HTMLElement) =>
  [...container.querySelectorAll("a")].map((a) => ({ link: a, name: (a.getAttribute("aria-label") ?? a.textContent ?? "").trim() }));

test("a graph shows one link per graph workflow that names it, under Submitted as", () => {
  const { container } = render("g", WORKFLOWS, "g-1");
  assert.match(container.textContent ?? "", /Submitted as:/);
  const found = chips(container);
  assert.equal(found.length, 2);
  assert.match(found[0].name, /^ship/);
  assert.match(found[1].name, /^review/);
  for (const { link } of found) assert.ok(link.hasAttribute("href"), "a chip is a link, so it has an href");
});

test("a graph no graph workflow names shows no Submitted as row", () => {
  const { container } = render("lonely", WORKFLOWS, null);
  assert.equal(container.innerHTML, "");
  assert.equal(render("g", [], null).container.innerHTML, "");
});

test("clicking a chip opens that graph workflow and doesn't follow its href", () => {
  const { container, opened } = render("g", WORKFLOWS, "g-1");
  const review = chips(container).find((c) => c.name.startsWith("review"))!.link;
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    review.dispatchEvent(click);
  });
  assert.deepEqual(opened, [{ kind: "graph-workflows", id: "review" }]);
  assert.equal(click.defaultPrevented, true);
});

test("a chip on a binding other than the one the dropdown shows says which binding it uses", () => {
  const { container } = render("g", WORKFLOWS, "g-1");
  const [ship, review] = chips(container);
  assert.equal(ship.name, "ship");
  assert.equal(review.name, "review, uses g-2");
});

test("with the dropdown on None, every chip says its binding, and one that names none says so", () => {
  const workflows: GraphWorkflowChoice[] = [...WORKFLOWS, { id: "bare", contractId: "c", graphId: "g", graphBindingId: "" }];
  assert.deepEqual(
    chips(render("g", workflows, null).container).map((c) => c.name),
    ["ship, uses g-1", "review, uses g-2", "bare"]
  );
  assert.deepEqual(
    chips(render("g", workflows, "g-2").container).map((c) => c.name),
    ["ship, uses g-1", "review", "bare, uses no binding"]
  );
});
