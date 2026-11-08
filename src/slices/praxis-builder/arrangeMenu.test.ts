/// <reference types="node" />
// Component tests for the toolbar's Arrange button on the shared context menu (#507): the real
// button rendered into happy-dom through the shared DOM test support. The menu opens under the
// button with their right edges lined up, the button toggles it, and Escape gives the button
// focus back.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ArrangeAction } from "./arrange.ts";

const { ArrangeMenuButton } = await import("./ArrangeMenu.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

function renderButton(chosen: ArrangeAction[]): HTMLButtonElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() => root.render(createElement(ArrangeMenuButton, { selectedCount: 2, onChoose: (a: ArrangeAction) => chosen.push(a) })));
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Arrange"]');
  assert.ok(button);
  // happy-dom lays nothing out: the button sits near the window's right edge.
  button.getBoundingClientRect = () =>
    ({ left: 700, top: 10, right: 724, bottom: 34, width: 24, height: 24, x: 700, y: 10, toJSON: () => ({}) }) as DOMRect;
  return button;
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');

test("the Arrange button opens its menu under it, toggles it, and Escape gives the button focus back", () => {
  const button = renderButton([]);
  act(() => button.click());
  assert.equal(menu()?.getAttribute("aria-label"), "Arrange");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(button.getAttribute("aria-controls"), menu()?.id);
  // The menu measures 0 wide here, so its right edge at the button's is its left there too.
  assert.deepEqual([menu()?.style.left, menu()?.style.top], ["724px", "38px"]);
  assert.equal(document.activeElement?.textContent?.startsWith("Auto-arrange"), true);
  act(() => button.click());
  assert.equal(menu(), null);
  act(() => button.click());
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  assert.equal(menu(), null);
  assert.equal(document.activeElement, button);
});

test("choosing an item runs its layout command and gives the button focus back", () => {
  const chosen: ArrangeAction[] = [];
  const button = renderButton(chosen);
  act(() => button.click());
  const align = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.startsWith("Align left"));
  assert.ok(align, "no Align left item");
  act(() => align.click());
  assert.deepEqual(chosen, [{ type: "align", mode: "left" }]);
  assert.equal(menu(), null);
  assert.equal(document.activeElement, button);
});
