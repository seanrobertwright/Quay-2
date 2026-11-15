/// <reference types="node" />
// Component tests for the module bar (#632): its buttons, top to bottom; the edge rule, which
// puts every button's box at x = 0 with nothing outside it; folding and switching the panel;
// and the names and current state a screen reader hears.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ModuleId } from "./modules.ts";

const { ModuleBar } = await import("./ModuleBar.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

/** Renders the module bar with `initial` open, the way the shell holds it, and counts palette opens. */
function render(initial: ModuleId | null = "projects", extra: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const palette = { opened: 0 };
  const Harness = () => {
    const [open, setOpen] = useState<ModuleId | null>(initial);
    return createElement(ModuleBar, { openModule: open, onOpenModule: setOpen, panelId: "panel", onOpenPalette: () => palette.opened++, ...extra });
  };
  act(() => root.render(createElement(Harness)));
  mounted = { root, container };
  const nav = container.querySelector("nav") as HTMLElement;
  const buttons = () => [...nav.querySelectorAll("button")] as HTMLButtonElement[];
  const named = (name: string) => {
    const found = buttons().find((b) => b.getAttribute("aria-label") === name);
    assert.ok(found, `no module bar button named ${name}`);
    return found;
  };
  return { nav, buttons, named, palette };
}

const px = (value: string) => Number.parseFloat(value || "0") || 0;

test("the module bar is a labelled navigation landmark with the five modules, then the palette", () => {
  const { nav, buttons } = render();
  assert.equal(nav.getAttribute("aria-label"), "Module bar");
  assert.deepEqual(
    buttons().map((b) => b.getAttribute("aria-label")),
    ["Projects", "Source control", "Agents", "Workflows", "Project", "Command palette"],
  );
});

test("the module bar is 48 px wide and every button spans it from x = 0 with nothing outside the button", () => {
  const { nav, buttons } = render();
  const navStyle = getComputedStyle(nav);
  assert.equal(navStyle.width, "48px");
  for (const side of ["Left", "Right"] as const) {
    assert.equal(px(navStyle.getPropertyValue(`padding-${side.toLowerCase()}`)), 0, `bar padding-${side}`);
    assert.equal(px(navStyle.getPropertyValue(`border-${side.toLowerCase()}-width`)), 0, `bar border-${side}`);
  }
  for (const button of buttons()) {
    const style = getComputedStyle(button);
    const name = button.getAttribute("aria-label");
    assert.equal(style.width, "48px", `${name} width`);
    for (const prop of ["margin-left", "margin-right", "border-left-width", "border-right-width"]) {
      assert.equal(px(style.getPropertyValue(prop)), 0, `${name} ${prop}`);
    }
    // Everything between the bar and the button carries no inset either.
    for (let el = button.parentElement; el && el !== nav; el = el.parentElement) {
      const s = getComputedStyle(el);
      for (const prop of ["padding-left", "margin-left", "border-left-width"]) {
        assert.equal(px(s.getPropertyValue(prop)), 0, `${name} wrapper ${prop}`);
      }
    }
    // No target under 24 x 24 px.
    assert.ok(px(style.height) >= 24, `${name} height ${style.height}`);
  }
});

test("the open module's icon is exposed as current and controls the panel", () => {
  const { named } = render("agents");
  assert.equal(named("Agents").getAttribute("aria-current"), "true");
  assert.equal(named("Agents").getAttribute("aria-controls"), "panel");
  assert.equal(named("Projects").getAttribute("aria-current"), null);
  assert.equal(named("Projects").getAttribute("aria-controls"), "panel");
});

test("clicking the open module's icon folds the panel, and clicking it again opens it", () => {
  const { named } = render("projects");
  act(() => named("Projects").click());
  assert.equal(named("Projects").getAttribute("aria-current"), null);
  act(() => named("Projects").click());
  assert.equal(named("Projects").getAttribute("aria-current"), "true");
});

test("clicking another module's icon switches the panel to it", () => {
  const { named } = render("projects");
  act(() => named("Workflows").click());
  assert.equal(named("Workflows").getAttribute("aria-current"), "true");
  assert.equal(named("Projects").getAttribute("aria-current"), null);
});

test("the palette icon opens the command palette and leaves the panel as it was", () => {
  const { named, palette } = render("source-control");
  assert.equal(named("Command palette").getAttribute("aria-keyshortcuts"), "Control+Shift+P");
  act(() => named("Command palette").click());
  assert.equal(palette.opened, 1);
  assert.equal(named("Source control").getAttribute("aria-current"), "true");
});

test("the Agents icon shows the Waiting on you count and Source control the open pull request count", () => {
  const { named } = render("projects", { waitingCount: 3, openPrCount: 1 });
  const agents = named("Agents, 3 waiting on you");
  assert.equal(agents.querySelector("[data-badge]")?.textContent, "3");
  const source = named("Source control, 1 open pull request");
  assert.equal(source.querySelector("[data-badge]")?.textContent, "1");
});

test("a zero or unknown count shows no badge and leaves the plain module name", () => {
  const { named, nav } = render("projects", { waitingCount: 0, openPrCount: null });
  named("Agents");
  named("Source control");
  assert.equal(nav.querySelectorAll("[data-badge]").length, 0);
});

test("the spend ticker at the bottom shows today's spend and opens the spend window", () => {
  let opened = 0;
  const { buttons } = render("projects", { spendTodayUsd: 4.5, onOpenSpend: () => opened++ });
  const last = buttons()[buttons().length - 1];
  assert.equal(last.getAttribute("aria-label"), "Today's spend: $4.50");
  assert.equal(last.textContent, "$4.50");
  act(() => last.click());
  assert.equal(opened, 1);
});

test("the terminal status list sits directly under the Projects icon", () => {
  const { named } = render("projects", { renderTerminalList: () => createElement("ul", { "aria-label": "Terminals" }) });
  assert.equal(named("Projects").nextElementSibling?.getAttribute("aria-label"), "Terminals");
});
