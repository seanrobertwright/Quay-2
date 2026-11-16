/// <reference types="node" />
// The shell look stylesheet's own contract (#652), for the live parts a component test cannot
// render under `node --test` (the terminal pane, whose xterm does not load here) and for the
// focus ring every control shares: each takes the pie palette's accent, with a soft glow.
import "../../test-support/dom.ts";
import { installShellLook } from "../../test-support/shellLook.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

afterEach(() => {
  document.body.innerHTML = "";
});

/** An element in the document with `attrs`, as a component would render it. */
function part(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

test("the selected terminal's pane border is the accent, with a soft inner glow", () => {
  installShellLook("tron");
  const pane = getComputedStyle(part("div", { "data-neon": "pane" }));
  assert.equal(pane.borderColor, "#18e0ff");
  assert.equal(pane.boxShadow, "inset 0 0 14px rgba(24, 224, 255, 0.22)");
});

test("the selected terminal's pane title is lit in the accent", () => {
  installShellLook("ice");
  const title = getComputedStyle(part("span", { "data-neon": "title" }));
  assert.equal(title.color, "#dfe9ff");
  assert.match(title.textShadow, /^0 0 [1-6]px rgba\(223, 233, 255, 0\.\d+\)$/, "a soft glow in the accent");
});

test("the focus ring is the accent, with a soft glow, and follows a palette change", () => {
  installShellLook("sunset");
  const button = part("button");
  button.focus();
  assert.equal(getComputedStyle(button).outline, "#ff3d81 solid 2px");
  assert.match(getComputedStyle(button).boxShadow, /^0 0 [1-4]px #ff3d81/);
  installShellLook("acid");
  assert.equal(getComputedStyle(button).outlineColor, "#b6ff1a");
});
