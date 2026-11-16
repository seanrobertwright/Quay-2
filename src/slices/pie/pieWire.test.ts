/// <reference types="node" />
// The pie menu's look: a wireframe of neon lines with no fills and no background, in the pie
// palette's colours, labels drawn with a thin dark outline when the setting is on, and dim, empty
// wedges where a command does not apply. Colours are the palettes' own (#606's prototype).
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { pieRing } from "./pieRing.ts";

const { PieWire } = await import("./PieWire.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
});

type Props = Parameters<typeof PieWire>[0];

async function render(over: Partial<Props> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  const props: Props = { ring: pieRing({ surface: "empty-stage" }), palette: "sunset", labelOutline: true, aimed: null, label: "Pie menu", ...over };
  await act(async () => root.render(createElement(PieWire, props)));
  const rerender = (next: Partial<Props>) => act(async () => root.render(createElement(PieWire, { ...props, ...next })));
  return { svg: container.querySelector("svg")!, rerender };
}

const wedge = (svg: SVGElement, name: string) => svg.querySelector(`[data-wedge="${name}"]`)!;

test("eight wedges; those that do not apply are dim and empty, the others carry label and letter", async () => {
  const { svg } = await render();
  assert.equal(svg.querySelectorAll("[data-wedge]").length, 8);
  for (const dim of ["NE", "SE", "SW"]) {
    assert.equal(wedge(svg, dim).getAttribute("data-dim"), "true", dim);
    assert.equal(wedge(svg, dim).querySelectorAll("text").length, 0, `${dim} has no label`);
  }
  assert.deepEqual(
    [...wedge(svg, "NW").querySelectorAll("text")].map((t) => t.textContent),
    ["AGENTS PANEL", "A"]
  );
  assert.equal(wedge(svg, "N").getAttribute("data-dim"), null);
});

test("lines only: nothing in the wire is filled, and there is no background", async () => {
  const { svg } = await render();
  for (const shape of svg.querySelectorAll("path, circle")) assert.equal(shape.getAttribute("fill"), "none", shape.outerHTML);
  assert.equal(svg.querySelector("rect"), null);
});

test("the palette sets the lines: resting in its first colour, the aimed wedge in its second", async () => {
  const { svg, rerender } = await render({ aimed: "W" });
  assert.equal(wedge(svg, "N").querySelector("path")!.getAttribute("stroke"), "#ff3d81");
  assert.equal(wedge(svg, "W").querySelector("path")!.getAttribute("stroke"), "#ffd60a");
  await rerender({ palette: "tron", aimed: null });
  assert.equal(wedge(svg, "W").querySelector("path")!.getAttribute("stroke"), "#18e0ff");
});

test("Spectrum gives each wedge its own hue", async () => {
  const { svg } = await render({ palette: "spectrum" });
  const strokes = ["N", "E", "S", "W"].map((w) => wedge(svg, w).querySelector("path")!.getAttribute("stroke"));
  assert.deepEqual(strokes, ["hsl(170 100% 62%)", "hsl(260 100% 62%)", "hsl(350 100% 62%)", "hsl(80 100% 62%)"]);
});

test("the label outline setting draws a thin dark stroke behind each label, or none", async () => {
  const { svg, rerender } = await render();
  const label = () => wedge(svg, "N").querySelector("text")!;
  assert.equal(label().getAttribute("stroke"), "#0d1117");
  assert.equal(label().getAttribute("paint-order"), "stroke");
  await rerender({ labelOutline: false });
  assert.equal(label().getAttribute("stroke"), null);
});

test("as a menu its wedges are menu items named by direction, label and letter; dim wedges are hidden", async () => {
  const { svg } = await render();
  assert.equal(svg.getAttribute("role"), "menu");
  assert.equal(svg.getAttribute("aria-label"), "Pie menu");
  const items = [...svg.querySelectorAll('[role="menuitem"]')].map((el) => el.getAttribute("aria-label"));
  assert.deepEqual(items, ["N: Next wait (Q)", "E: Split (S)", "S: Palette (P)", "W: New term (N)", "NW: Agents panel (A)"]);
  assert.equal(wedge(svg, "NE").getAttribute("aria-hidden"), "true");
});
