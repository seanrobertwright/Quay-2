/// <reference types="node" />
// When a terminal may not take the focus (#715): while the operator types outside its pane, such as
// into an agent's question in the companion.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { isTypingOutside } from "./terminalFocus.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Two panes with a terminal each, and the fields of a question beside them. */
function draw(): HTMLElement {
  document.body.innerHTML = `
    <div data-terminal-pane id="pane"><input id="search" /><textarea id="own" class="xterm-helper-textarea"></textarea></div>
    <div data-terminal-pane><textarea id="other" class="xterm-helper-textarea"></textarea></div>
    <section><input id="line" /><input id="radio" type="radio" /><textarea id="box"></textarea><select id="choice"></select>
      <div id="rich" contenteditable="true" tabindex="0"></div><button id="send">Send</button></section>`;
  return document.getElementById("pane")!;
}

const typingIn = (id: string | null) => {
  const pane = draw();
  if (id) document.getElementById(id)!.focus();
  assert.equal(document.activeElement?.id ?? "", id ?? "", "the focus is where the test put it");
  return isTypingOutside(pane);
};

test("a field outside the pane keeps the focus", () => {
  for (const id of ["line", "radio", "box", "choice", "rich"]) assert.equal(typingIn(id), true, id);
});

test("the pane's own fields, another terminal and a button do not", () => {
  for (const id of ["search", "own", "other", "send", null]) assert.equal(typingIn(id), false, String(id));
});
