/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { terminalKeyAction } from "./terminalKeys.ts";

function key(k: string, { ctrlKey = false, shiftKey = false, altKey = false, metaKey = false } = {}) {
  return { key: k, ctrlKey, shiftKey, altKey, metaKey };
}

test("Ctrl+A, Ctrl+B, Ctrl+K and Ctrl+X go to the shell", () => {
  for (const k of ["a", "b", "k", "x"]) {
    assert.equal(terminalKeyAction(key(k, { ctrlKey: true }), false), "shell", `Ctrl+${k}`);
    assert.equal(terminalKeyAction(key(k, { ctrlKey: true }), true), "shell", `Ctrl+${k} with a selection`);
  }
});

test("Ctrl+C copies when there is a selection and otherwise sends ^C", () => {
  assert.equal(terminalKeyAction(key("c", { ctrlKey: true }), true), "copy");
  assert.equal(terminalKeyAction(key("c", { ctrlKey: true }), false), "shell");
});

test("Ctrl+V pastes", () => {
  assert.equal(terminalKeyAction(key("v", { ctrlKey: true }), false), "paste");
  assert.equal(terminalKeyAction(key("v", { ctrlKey: true }), true), "paste");
});

test("Ctrl+Shift+C and Ctrl+Shift+V are explicit copy and paste", () => {
  // With Shift held the browser reports the upper-case letter.
  assert.equal(terminalKeyAction(key("C", { ctrlKey: true, shiftKey: true }), true), "copy");
  assert.equal(terminalKeyAction(key("C", { ctrlKey: true, shiftKey: true }), false), "copy", "never sends ^C");
  assert.equal(terminalKeyAction(key("V", { ctrlKey: true, shiftKey: true }), false), "paste");
});

test("Ctrl+F opens the pane's search", () => {
  assert.equal(terminalKeyAction(key("f", { ctrlKey: true }), false), "search");
});

test("plain typing and other modifiers go to the shell", () => {
  assert.equal(terminalKeyAction(key("c"), true), "shell");
  assert.equal(terminalKeyAction(key("v"), false), "shell");
  assert.equal(terminalKeyAction(key("C", { shiftKey: true }), true), "shell");
  assert.equal(terminalKeyAction(key("v", { altKey: true }), false), "shell");
  // AltGr on Windows reports Ctrl+Alt; a character typed with it is not a shortcut.
  assert.equal(terminalKeyAction(key("v", { ctrlKey: true, altKey: true }), false), "shell");
  assert.equal(terminalKeyAction(key("c", { metaKey: true }), true), "shell");
});
