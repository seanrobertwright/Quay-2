/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { opensCommandPalette, isTerminalTarget } from "./paletteKey.ts";

/** A stand-in for a DOM element; `insideXterm` says whether it sits inside an `.xterm` root. */
function element(insideXterm: boolean): EventTarget {
  return { closest: (selector: string) => (selector === ".xterm" && insideXterm ? {} : null) } as unknown as EventTarget;
}

const terminal = element(true);
const elsewhere = element(false);

function keydown(
  key: string,
  target: EventTarget | null,
  { ctrlKey = false, shiftKey = false, altKey = false, metaKey = false } = {}
) {
  return { key, target, ctrlKey, shiftKey, altKey, metaKey };
}

test("a key from inside an .xterm root counts as the terminal", () => {
  assert.equal(isTerminalTarget(terminal), true);
  assert.equal(isTerminalTarget(elsewhere), false);
  assert.equal(isTerminalTarget(null), false);
  assert.equal(isTerminalTarget({} as EventTarget), false, "a target that is not an element");
});

test("Ctrl+Shift+P opens the palette from anywhere", () => {
  for (const target of [terminal, elsewhere, null]) {
    assert.equal(opensCommandPalette(keydown("P", target, { ctrlKey: true, shiftKey: true })), true);
  }
});

test("Ctrl+K opens the palette outside a terminal and goes to the shell inside one", () => {
  assert.equal(opensCommandPalette(keydown("k", elsewhere, { ctrlKey: true })), true);
  assert.equal(opensCommandPalette(keydown("k", null, { ctrlKey: true })), true);
  assert.equal(opensCommandPalette(keydown("k", elsewhere, { metaKey: true })), true, "Cmd+K");
  assert.equal(opensCommandPalette(keydown("k", terminal, { ctrlKey: true })), false);
});

test("other keys do not open the palette", () => {
  assert.equal(opensCommandPalette(keydown("p", elsewhere, { ctrlKey: true })), false, "Ctrl+P");
  assert.equal(opensCommandPalette(keydown("k", elsewhere)), false, "plain K");
  assert.equal(opensCommandPalette(keydown("P", elsewhere, { shiftKey: true })), false, "Shift+P");
  assert.equal(opensCommandPalette(keydown("P", elsewhere, { ctrlKey: true, shiftKey: true, altKey: true })), false);
});
