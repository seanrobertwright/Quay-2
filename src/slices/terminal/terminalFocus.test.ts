/// <reference types="node" />
// When a terminal may not take the focus (#715): while the operator types outside its pane, such as
// into an agent's question in the companion.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { focusXterm, isTypingOutside } from "./terminalFocus.ts";

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

/** The terminal in the first pane, as xterm gives it. */
const xterm = (pane: HTMLElement) => {
  const textarea = pane.querySelector<HTMLTextAreaElement>("#own")!;
  return { element: textarea.parentElement!, textarea, focus: () => textarea.focus() };
};

test("a terminal that focuses itself leaves the focus in a field outside its pane", () => {
  const term = xterm(draw());
  document.getElementById("box")!.focus();
  focusXterm(term);
  assert.equal(document.activeElement?.id, "box");
});

test("a terminal that focuses itself takes the focus from a button", () => {
  const term = xterm(draw());
  document.getElementById("send")!.focus();
  focusXterm(term);
  assert.equal(document.activeElement?.id, "own");
});

test("a surface in the stage tab in front keeps the focus, whatever in it has it", () => {
  document.body.innerHTML = `
    <div data-terminal-pane id="pane"><textarea id="own" class="xterm-helper-textarea"></textarea></div>
    <div data-stage-tool-panel="surface"><section id="frame" data-surface="review_1" tabindex="-1"><button id="approve">Approve</button></section></div>
    <div data-stage-tool-panel="tool"><button id="tool">Run</button></div>`;
  const term = xterm(document.getElementById("pane")!);
  for (const id of ["frame", "approve"]) {
    document.getElementById(id)!.focus();
    focusXterm(term);
    assert.equal(document.activeElement?.id, id);
  }
  document.getElementById("tool")!.focus();
  focusXterm(term);
  assert.equal(document.activeElement?.id, "own", "any other stage tab's does not");
});
