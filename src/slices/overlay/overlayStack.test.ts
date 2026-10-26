/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOverlayStack, isDismissKey, type DismissKeyEvent } from "./overlayStack.ts";

/** A stand-in for a DOM node, named so a test can say which surface it sits in. */
function node(name: string): EventTarget {
  return { name } as unknown as EventTarget;
}

const terminal = node("terminal");
const otherModal = node("other modal");

/** Nothing outside the stack is another surface unless a test says so. */
const noOtherSurface = () => false;
const isOtherModal = (target: EventTarget | null) => target === otherModal;

function keydown(key: string, target: EventTarget | null, mods: Partial<DismissKeyEvent> = {}): DismissKeyEvent {
  return { key, target, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}

/** An overlay that records its closes and owns the targets it is given. */
function overlay(...inside: EventTarget[]) {
  const record = { closes: 0 };
  return {
    record,
    overlay: {
      close: () => {
        record.closes += 1;
      },
      contains: (target: EventTarget | null) => target !== null && inside.includes(target),
    },
  };
}

test("only a plain Escape dismisses", () => {
  assert.equal(isDismissKey(keydown("Escape", null)), true);
  assert.equal(isDismissKey(keydown("Esc", null)), false);
  assert.equal(isDismissKey(keydown("Enter", null)), false);
  for (const mod of ["ctrlKey", "shiftKey", "altKey", "metaKey", "isComposing", "repeat"] as const) {
    assert.equal(isDismissKey(keydown("Escape", null, { [mod]: true })), false, mod);
  }
});

test("Escape with nothing open is left alone", () => {
  const stack = createOverlayStack();
  assert.equal(stack.isOpen(), false);
  assert.equal(stack.handleDismissKey(keydown("Escape", terminal), noOtherSurface), false);
});

test("Escape from a focused terminal closes the open overlay", () => {
  const stack = createOverlayStack();
  const drawer = overlay(node("drawer search"));
  stack.open(drawer.overlay);

  assert.equal(stack.handleDismissKey(keydown("Escape", terminal), noOtherSurface), true);
  assert.equal(drawer.record.closes, 1);
});

test("Escape from anywhere inside the overlay closes it", () => {
  const stack = createOverlayStack();
  const input = node("palette input");
  const result = node("palette result");
  const palette = overlay(input, result);
  stack.open(palette.overlay);

  assert.equal(stack.handleDismissKey(keydown("Escape", input), noOtherSurface), true);
  assert.equal(stack.handleDismissKey(keydown("Escape", result), noOtherSurface), true);
  assert.equal(palette.record.closes, 2);
});

test("other keys pass through", () => {
  const stack = createOverlayStack();
  const drawer = overlay();
  stack.open(drawer.overlay);

  assert.equal(stack.handleDismissKey(keydown("a", terminal), noOtherSurface), false);
  assert.equal(stack.handleDismissKey(keydown("Escape", terminal, { shiftKey: true }), noOtherSurface), false);
  assert.equal(drawer.record.closes, 0);
});

test("stacked overlays close topmost first, one per Escape", () => {
  const stack = createOverlayStack();
  const drawerInput = node("drawer input");
  const drawer = overlay(drawerInput);
  const palette = overlay(node("palette input"));
  const removeDrawer = stack.open(drawer.overlay);
  const removePalette = stack.open(palette.overlay);

  // Even with focus left behind in the drawer, the palette on top goes first.
  assert.equal(stack.handleDismissKey(keydown("Escape", drawerInput), noOtherSurface), true);
  assert.deepEqual([palette.record.closes, drawer.record.closes], [1, 0]);

  removePalette();
  assert.equal(stack.handleDismissKey(keydown("Escape", drawerInput), noOtherSurface), true);
  assert.deepEqual([palette.record.closes, drawer.record.closes], [1, 1]);

  removeDrawer();
  assert.equal(stack.isOpen(), false);
  assert.equal(stack.handleDismissKey(keydown("Escape", drawerInput), noOtherSurface), false);
});

test("an overlay removed from the middle leaves the rest in order", () => {
  const stack = createOverlayStack();
  const a = overlay();
  const b = overlay();
  const c = overlay();
  stack.open(a.overlay);
  const removeB = stack.open(b.overlay);
  const removeC = stack.open(c.overlay);

  removeB();
  removeB(); // removing twice is harmless
  stack.handleDismissKey(keydown("Escape", terminal), noOtherSurface);
  removeC();
  stack.handleDismissKey(keydown("Escape", terminal), noOtherSurface);
  assert.deepEqual([a.record.closes, b.record.closes, c.record.closes], [1, 0, 1]);
});

test("Escape inside a modal the stack doesn't know is left to that modal", () => {
  const stack = createOverlayStack();
  const drawer = overlay();
  stack.open(drawer.overlay);

  assert.equal(stack.handleDismissKey(keydown("Escape", otherModal), isOtherModal), false);
  assert.equal(drawer.record.closes, 0);
  assert.equal(stack.handleDismissKey(keydown("Escape", terminal), isOtherModal), true);
  assert.equal(drawer.record.closes, 1);
});
