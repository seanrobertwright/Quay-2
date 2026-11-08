/// <reference types="node" />
// Component tests for the global right-click policy (#507): with it installed on the document,
// a right-click shows no native menu except in a text field, and in a dev build Shift+right-click
// outside the terminal body lets the native menu through. They run in happy-dom through the
// shared DOM test support; whether the native menu shows is whether the event's default is
// prevented.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { installContextMenuPolicy } from "./contextMenuPolicy.ts";

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.innerHTML = "";
});

/** Puts `html` in the page and returns the element matching `selector` in it. */
function place(html: string, selector: string): Element {
  document.body.innerHTML = html;
  const el = document.querySelector(selector);
  assert.ok(el, `no ${selector} in the page`);
  return el;
}

/** Right-clicks `el` and says whether the native menu would show. */
function rightClick(el: Element, init: { shiftKey?: boolean } = {}): boolean {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, ...init });
  el.dispatchEvent(e);
  return !e.defaultPrevented;
}

test("a right-click on plain content shows no native menu", () => {
  uninstall = installContextMenuPolicy(document, { dev: false });
  assert.equal(rightClick(place('<nav><div class="row">Project</div></nav>', ".row")), false);
});

test("a right-click in a text field keeps the native menu, for Cut, Copy and Paste", () => {
  uninstall = installContextMenuPolicy(document, { dev: false });
  assert.equal(rightClick(place('<input type="text" placeholder="Search commands">', "input")), true);
  assert.equal(rightClick(place("<input>", "input")), true);
  assert.equal(rightClick(place("<textarea></textarea>", "textarea")), true);
  assert.equal(rightClick(place('<div contenteditable="true"><p>line</p></div>', "p")), true);
});

/** A terminal body as xterm draws it: its root, the screen, and the hidden textarea that takes keys. */
const TERMINAL =
  '<div class="xterm"><div class="xterm-screen"><canvas></canvas></div>' +
  '<div class="xterm-helper-textarea-wrap"><textarea class="xterm-helper-textarea"></textarea></div></div>';

test("the terminal body's hidden textarea does not count as a text field", () => {
  uninstall = installContextMenuPolicy(document, { dev: false });
  assert.equal(rightClick(place(TERMINAL, "textarea.xterm-helper-textarea")), false);
  assert.equal(rightClick(place(TERMINAL, ".xterm-screen")), false);
});

test("an input that takes no text, such as a checkbox, shows no native menu", () => {
  uninstall = installContextMenuPolicy(document, { dev: false });
  assert.equal(rightClick(place('<input type="checkbox">', "input")), false);
  assert.equal(rightClick(place('<input type="range">', "input")), false);
  assert.equal(rightClick(place('<input type="button" value="Go">', "input")), false);
  assert.equal(rightClick(place('<div contenteditable="false"><span>x</span></div>', "span")), false);
});

test("in a dev build, Shift+right-click outside the terminal body shows the native menu, for Inspect", () => {
  uninstall = installContextMenuPolicy(document, { dev: true });
  assert.equal(rightClick(place('<div class="row">Project</div>', ".row"), { shiftKey: true }), true);
  assert.equal(rightClick(place('<div class="row">Project</div>', ".row")), false);
});

test("in a dev build, Shift+right-click in the terminal body still shows no native menu", () => {
  uninstall = installContextMenuPolicy(document, { dev: true });
  assert.equal(rightClick(place(TERMINAL, ".xterm-screen"), { shiftKey: true }), false);
  assert.equal(rightClick(place(TERMINAL, "textarea.xterm-helper-textarea"), { shiftKey: true }), false);
});

test("a release build never lets Shift+right-click through", () => {
  uninstall = installContextMenuPolicy(document, { dev: false });
  assert.equal(rightClick(place('<div class="row">Project</div>', ".row"), { shiftKey: true }), false);
});
