/// <reference types="node" />
// Component tests for the shared context menu (#507): the real `ContextMenu` and
// `useContextMenu` rendered into happy-dom through the shared DOM test support. They check what
// a user observes: which item has focus, where the menu sits, when it closes, and what Escape
// closes first.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useState, type FC, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { ContextMenu } = await import("./ContextMenu.tsx");
const { useOverlay } = await import("./useOverlay.ts");
const { useContextMenu } = await import("./useContextMenu.ts");
type Item = import("./ContextMenu.tsx").ContextMenuItem;

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  document.body.innerHTML = "";
});

function render(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() => root.render(element));
  return container;
}

/** Items named `names`, all enabled, in one group, recording each choice in `chosen`. */
function items(names: string[], chosen: string[] = []): Item[] {
  return names.map((name) => ({ name, enabled: true, group: "one", onChoose: () => chosen.push(name) }));
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const focusedName = () => document.activeElement?.textContent ?? null;
function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

test("focus starts on the first item, and the arrows, Home and End move it with wrap", () => {
  render(createElement(ContextMenu, { label: "Node", items: items(["Cut", "Copy", "Paste"]), at: { x: 10, y: 10 }, onClose: () => {} }));
  assert.equal(menu()?.getAttribute("aria-label"), "Node");
  assert.equal(focusedName(), "Cut");
  press("ArrowDown");
  assert.equal(focusedName(), "Copy");
  press("End");
  assert.equal(focusedName(), "Paste");
  press("ArrowDown");
  assert.equal(focusedName(), "Cut");
  press("ArrowUp");
  assert.equal(focusedName(), "Paste");
  press("Home");
  assert.equal(focusedName(), "Cut");
});

test("the menu renders in the document body, outside the element that opened it", () => {
  const container = render(createElement(ContextMenu, { label: "Node", items: items(["Cut"]), at: { x: 10, y: 10 }, onClose: () => {} }));
  assert.equal(menu()?.parentElement, document.body);
  assert.equal(container.contains(menu()), false);
});

test("Tab and Escape close the menu and ask for focus back", () => {
  const closes: boolean[] = [];
  render(createElement(ContextMenu, { label: "Node", items: items(["Cut", "Copy"]), at: { x: 10, y: 10 }, onClose: (r: boolean) => closes.push(r) }));
  press("Tab");
  press("Escape");
  assert.deepEqual(closes, [true, true]);
});

test("choosing an enabled item closes the menu, then runs it; a disabled one does neither", () => {
  const chosen: string[] = [];
  const closes: boolean[] = [];
  const list: Item[] = [
    { name: "Paste", enabled: false, group: "clipboard", hint: "Nothing copied", onChoose: () => chosen.push("Paste") },
    { name: "Align left", enabled: true, group: "align", onChoose: () => chosen.push("Align left") },
  ];
  render(createElement(ContextMenu, { label: "Canvas", items: list, at: { x: 10, y: 10 }, onClose: (r: boolean) => closes.push(r) }));
  const [paste, align] = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.equal(paste.getAttribute("aria-disabled"), "true");
  assert.match(paste.textContent ?? "", /Nothing copied/);
  assert.equal(document.querySelectorAll('[role="separator"]').length, 1);
  act(() => paste.click());
  assert.deepEqual([chosen, closes], [[], []]);
  act(() => align.click());
  assert.deepEqual([chosen, closes], [["Align left"], [true]]);
});

/**
 * Gives the window and every menu a size for the test: happy-dom lays nothing out, so the menu
 * measures 0 by 0 otherwise. Returns a function that puts the sizes back.
 */
function withSizes(viewport: { width: number; height: number }, menuSize: { width: number; height: number }): () => void {
  const win = window as unknown as { innerWidth: number; innerHeight: number };
  const before = { width: win.innerWidth, height: win.innerHeight };
  const set = (w: number, h: number) => {
    Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
  };
  set(viewport.width, viewport.height);
  const proto = HTMLElement.prototype;
  const original = {
    width: Object.getOwnPropertyDescriptor(proto, "offsetWidth"),
    height: Object.getOwnPropertyDescriptor(proto, "offsetHeight"),
  };
  const size = (el: HTMLElement, key: "width" | "height") => (el.getAttribute("role") === "menu" ? menuSize[key] : 0);
  Object.defineProperty(proto, "offsetWidth", { get(this: HTMLElement) { return size(this, "width"); }, configurable: true });
  Object.defineProperty(proto, "offsetHeight", { get(this: HTMLElement) { return size(this, "height"); }, configurable: true });
  return () => {
    set(before.width, before.height);
    for (const [key, d] of [["offsetWidth", original.width], ["offsetHeight", original.height]] as const) {
      if (d) Object.defineProperty(proto, key, d);
      else delete (proto as unknown as Record<string, unknown>)[key];
    }
  };
}

const placeOf = () => ({ x: parseFloat(menu()?.style.left ?? "NaN"), y: parseFloat(menu()?.style.top ?? "NaN") });

test("a menu with room opens at the point; near the right or bottom edge it flips to stay inside", () => {
  const restore = withSizes({ width: 800, height: 600 }, { width: 200, height: 150 });
  try {
    render(createElement(ContextMenu, { label: "Node", items: items(["Cut"]), at: { x: 100, y: 120 }, onClose: () => {} }));
    assert.deepEqual(placeOf(), { x: 100, y: 120 });
    act(() => mounted?.root.render(createElement(ContextMenu, { label: "Node", items: items(["Cut"]), at: { x: 750, y: 560 }, onClose: () => {} })));
    assert.deepEqual(placeOf(), { x: 550, y: 410 });
  } finally {
    restore();
  }
});

test("a menu with room neither side of the point is clamped inside the window", () => {
  const restore = withSizes({ width: 300, height: 400 }, { width: 250, height: 350 });
  try {
    render(createElement(ContextMenu, { label: "Node", items: items(["Cut"]), at: { x: 150, y: 200 }, onClose: () => {} }));
    assert.deepEqual(placeOf(), { x: 50, y: 50 });
  } finally {
    restore();
  }
});

test("a press outside closes the menu, leaving focus where the press puts it; a press inside does not", () => {
  const closes: boolean[] = [];
  render(createElement(ContextMenu, { label: "Node", items: items(["Cut"]), at: { x: 10, y: 10 }, onClose: (r: boolean) => closes.push(r) }));
  const pointerDown = (el: Element) => act(() => {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  });
  pointerDown(menu()!.querySelector('[role="menuitem"]')!);
  assert.deepEqual(closes, []);
  const outside = document.createElement("div");
  document.body.append(outside);
  pointerDown(outside);
  assert.deepEqual(closes, [false]);
});

test("a scroll, a window resize or the window losing focus closes the menu and asks for focus back", () => {
  for (const fire of [
    () => document.body.dispatchEvent(new Event("scroll")),
    () => window.dispatchEvent(new Event("resize")),
    () => window.dispatchEvent(new Event("blur")),
  ]) {
    const closes: boolean[] = [];
    render(createElement(ContextMenu, { label: "Node", items: items(["Cut"]), at: { x: 10, y: 10 }, onClose: (r: boolean) => closes.push(r) }));
    act(fire);
    assert.deepEqual(closes, [true]);
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;
  }
});

test("a scroll inside the menu, or focus moving between its items, leaves it open", () => {
  const closes: boolean[] = [];
  render(createElement(ContextMenu, { label: "Node", items: items(["Cut", "Copy"]), at: { x: 10, y: 10 }, onClose: (r: boolean) => closes.push(r) }));
  act(() => {
    menu()!.dispatchEvent(new Event("scroll"));
  });
  press("ArrowDown");
  assert.deepEqual(closes, []);
});

/** A modal overlay, such as the command palette, whose button opens a menu. Logs what closes. */
const OverlayWithMenu: FC<{ log: string[]; chosen?: string[] }> = ({ log, chosen = [] }) => {
  const [overlayOpen, setOverlayOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const { backdropProps, panelProps } = useOverlay({
    isOpen: overlayOpen,
    onClose: () => {
      log.push("overlay");
      setOverlayOpen(false);
    },
  });
  if (!overlayOpen) return null;
  return createElement(
    "div",
    { className: "fixed inset-0", ...backdropProps },
    createElement(
      "div",
      panelProps,
      createElement("button", { type: "button", onClick: () => setMenuOpen(true) }, "Open menu"),
      menuOpen &&
        createElement(ContextMenu, {
          label: "Row",
          items: items(["Rename"], chosen),
          at: { x: 10, y: 10 },
          onClose: () => {
            log.push("menu");
            setMenuOpen(false);
          },
        })
    )
  );
};

test("Escape closes an open menu before the overlay behind it, then the overlay", () => {
  const log: string[] = [];
  render(createElement(OverlayWithMenu, { log }));
  act(() => document.querySelector<HTMLElement>("button")?.click());
  assert.equal(focusedName(), "Rename");
  press("Escape");
  assert.deepEqual(log, ["menu"]);
  assert.equal(menu(), null);
  press("Escape");
  assert.deepEqual(log, ["menu", "overlay"]);
});

test("choosing an item of a menu opened in an overlay runs it and leaves the overlay open", () => {
  // The menu renders outside the overlay's panel, so a press on it must not count as a press on
  // the backdrop outside the panel.
  const log: string[] = [];
  const chosen: string[] = [];
  render(createElement(OverlayWithMenu, { log, chosen }));
  act(() => document.querySelector<HTMLElement>("button")?.click());
  const rename = document.querySelector<HTMLElement>('[role="menuitem"]')!;
  act(() => {
    rename.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    rename.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    rename.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    rename.click();
  });
  assert.deepEqual([chosen, log], [["Rename"], ["menu"]]);
  assert.notEqual(document.querySelector('[role="dialog"]'), null);
});

test("an item with a checked state is a checkbox item announcing it, and the keys still reach it", () => {
  const list: Item[] = [
    { name: "Rename…", enabled: true, group: "session", onChoose: () => {} },
    { name: "Ask before tool calls", enabled: true, group: "session", checked: true, onChoose: () => {} },
    { name: "Show hidden", enabled: true, group: "view", checked: false, onChoose: () => {} },
  ];
  render(createElement(ContextMenu, { label: "Terminal", items: list, at: { x: 10, y: 10 }, onClose: () => {} }));
  const checkboxes = [...document.querySelectorAll('[role="menuitemcheckbox"]')];
  assert.deepEqual(
    checkboxes.map((el) => [el.textContent, el.getAttribute("aria-checked")]),
    [["Ask before tool calls", "true"], ["Show hidden", "false"]]
  );
  assert.equal(document.querySelector('[role="menuitem"]')?.hasAttribute("aria-checked"), false);
  press("End");
  assert.equal(focusedName(), "Show hidden");
  press("ArrowDown");
  assert.equal(focusedName(), "Rename…");
});

/** A focusable row with a menu, as a Rail row would have, built on `useContextMenu`. */
const RowWithMenu: FC<{ name: string; opened: string[] }> = ({ name, opened }) => {
  const menu = useContextMenu<string>();
  return createElement(
    "div",
    null,
    createElement(
      "div",
      { className: "row", tabIndex: 0, onContextMenu: (e: ReactMouseEvent<HTMLElement>) => menu.onContextMenu(e, name), onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => menu.onKeyDown(e, name) },
      name
    ),
    createElement("button", { type: "button" }, "Elsewhere"),
    menu.open &&
      createElement(ContextMenu, {
        label: menu.open.target,
        items: items(["Rename", "Close"], opened),
        at: menu.open.at,
        onClose: menu.close,
      })
  );
};

const row = () => document.querySelector<HTMLElement>(".row")!;
/** Gives the row a place in the window, which happy-dom doesn't lay out. */
function placeRow(box: { left: number; top: number; width: number; height: number }) {
  row().getBoundingClientRect = () =>
    ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box }) as DOMRect;
}

test("a right-click opens the surface's menu at the pointer, and stops there", () => {
  render(createElement(RowWithMenu, { name: "build", opened: [] }));
  const reachedDocument: boolean[] = [];
  const listen = (e: Event) => reachedDocument.push(e.defaultPrevented);
  document.addEventListener("contextmenu", listen);
  try {
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 80 });
    act(() => {
      row().dispatchEvent(e);
    });
    assert.equal(e.defaultPrevented, true);
    assert.deepEqual(reachedDocument, []);
  } finally {
    document.removeEventListener("contextmenu", listen);
  }
  assert.equal(menu()?.getAttribute("aria-label"), "build");
  assert.deepEqual(placeOf(), { x: 120, y: 80 });
  assert.equal(focusedName(), "Rename");
});

test("Shift+F10 on a focused row opens its menu at the row's lower left corner; Escape gives the row focus back", () => {
  render(createElement(RowWithMenu, { name: "build", opened: [] }));
  placeRow({ left: 40, top: 50, width: 200, height: 24 });
  act(() => row().focus());
  press("F10", { shiftKey: true });
  assert.equal(menu()?.getAttribute("aria-label"), "build");
  assert.deepEqual(placeOf(), { x: 40, y: 74 });
  assert.equal(focusedName(), "Rename");
  press("Escape");
  assert.equal(menu(), null);
  assert.equal(document.activeElement, row());
});

test("the Menu key opens the menu too, and the contextmenu event that can follow it leaves the menu where it is", () => {
  render(createElement(RowWithMenu, { name: "build", opened: [] }));
  placeRow({ left: 40, top: 50, width: 200, height: 24 });
  act(() => row().focus());
  press("ContextMenu");
  assert.deepEqual(placeOf(), { x: 40, y: 74 });
  act(() => {
    row().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 140, clientY: 62 }));
  });
  assert.deepEqual(placeOf(), { x: 40, y: 74 });
  press("Escape");
  assert.equal(document.activeElement, row());
});

test("F10 without Shift, and other keys on the row, open nothing", () => {
  render(createElement(RowWithMenu, { name: "build", opened: [] }));
  act(() => row().focus());
  press("F10");
  press("Enter");
  press("F10", { shiftKey: true, ctrlKey: true });
  assert.equal(menu(), null);
});

test("a right-click on the open menu shows no native menu and doesn't reach the surface it opened from", () => {
  const surfaceHeard: string[] = [];
  render(
    createElement(
      "div",
      { onContextMenu: () => surfaceHeard.push("contextmenu") },
      createElement(ContextMenu, { label: "Node", items: items(["Cut"]), at: { x: 10, y: 10 }, onClose: () => {} })
    )
  );
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  act(() => {
    menu()!.querySelector('[role="menuitem"]')!.dispatchEvent(e);
  });
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(surfaceHeard, []);
});

test("a menu aligned to its end has its top right corner at the point, and flips right when the left edge is near", () => {
  const restore = withSizes({ width: 800, height: 600 }, { width: 200, height: 150 });
  try {
    render(createElement(ContextMenu, { label: "Arrange", items: items(["Auto-arrange"]), at: { x: 400, y: 40 }, align: "end", onClose: () => {} }));
    assert.deepEqual(placeOf(), { x: 200, y: 40 });
    act(() => mounted?.root.render(createElement(ContextMenu, { label: "Arrange", items: items(["Auto-arrange"]), at: { x: 120, y: 40 }, align: "end", onClose: () => {} })));
    assert.deepEqual(placeOf(), { x: 120, y: 40 });
  } finally {
    restore();
  }
});
