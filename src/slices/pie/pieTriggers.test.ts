/// <reference types="node" />
// Which presses open the pie on each surface, from the spec's opening table: plain right-click
// only on the companion, empty stage and module bar; middle-click and Alt+Right-click everywhere
// else that has a pie; the terminal's mouse reporting keeps middle-click, so Shift+Middle-click
// opens the pie there; the Praxis canvas keeps middle-click for pan; text inputs never.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { opensPie, piePlaceAt, type PieRules } from "./pieTriggers.ts";

const RIGHT = { button: 2, altKey: false, shiftKey: false };
const ALT_RIGHT = { ...RIGHT, altKey: true };
const SHIFT_RIGHT = { ...RIGHT, shiftKey: true };
const MIDDLE = { button: 1, altKey: false, shiftKey: false };
const SHIFT_MIDDLE = { ...MIDDLE, shiftKey: true };
const LEFT = { button: 0, altKey: false, shiftKey: false };

/** Which of the six presses open the pie under `rules`. */
function opening(rules: PieRules, mouseReporting = false) {
  const presses = { RIGHT, ALT_RIGHT, SHIFT_RIGHT, MIDDLE, SHIFT_MIDDLE, LEFT };
  return Object.entries(presses)
    .filter(([, press]) => opensPie(press, rules, mouseReporting))
    .map(([name]) => name);
}

test("companion, empty stage and module bar: right-click, middle-click and Alt+Right-click", () => {
  assert.deepEqual(opening("pie"), ["RIGHT", "ALT_RIGHT", "MIDDLE", "SHIFT_MIDDLE"]);
});

test("terminal body: middle-click and Alt+Right-click; plain right-click stays the terminal's", () => {
  assert.deepEqual(opening("terminal"), ["ALT_RIGHT", "MIDDLE", "SHIFT_MIDDLE"]);
});

test("terminal body with mouse reporting on: the program keeps middle-click, Shift+Middle-click and Alt+Right-click open the pie", () => {
  assert.deepEqual(opening("terminal", true), ["ALT_RIGHT", "SHIFT_MIDDLE"]);
});

test("list-menu surfaces and anywhere else: middle-click and Alt+Right-click; right-click keeps the list menu", () => {
  assert.deepEqual(opening("list"), ["ALT_RIGHT", "MIDDLE", "SHIFT_MIDDLE"]);
  assert.deepEqual(opening("elsewhere"), ["ALT_RIGHT", "MIDDLE", "SHIFT_MIDDLE"]);
});

test("Praxis canvas: only Alt+Right-click, so middle-click keeps pan", () => {
  assert.deepEqual(opening("praxis-canvas"), ["ALT_RIGHT"]);
});

test("text inputs never open the pie", () => {
  assert.deepEqual(opening("text-input"), []);
});

afterEach(() => {
  document.body.innerHTML = "";
});

/** The place under the element matching `selector` in `html`. */
function placeOf(html: string, selector: string) {
  document.body.innerHTML = html;
  const el = document.querySelector(selector);
  assert.ok(el, selector);
  return piePlaceAt(el);
}

test("the terminal body is a terminal surface acting on its pane's terminal, with mouse reporting read from xterm", () => {
  const pane = (cls: string) => `<div data-pie-terminal="t1"><div class="${cls}"><textarea class="xterm-helper-textarea"></textarea><div class="screen"></div></div></div>`;
  assert.deepEqual(placeOf(pane("xterm"), ".screen"), { rules: "terminal", mouseReporting: false, target: { surface: "terminal", terminalId: "t1" } });
  assert.deepEqual(placeOf(pane("xterm enable-mouse-events"), "textarea"), {
    rules: "terminal",
    mouseReporting: true,
    target: { surface: "terminal", terminalId: "t1" },
  });
});

test("a pane header keeps its list menu and acts on its terminal", () => {
  const html = `<div data-pie-terminal="t1"><div data-pie-surface="list"><span class="name">claude-1</span></div></div>`;
  assert.deepEqual(placeOf(html, ".name"), { rules: "list", mouseReporting: false, target: { surface: "terminal", terminalId: "t1" } });
});

test("a Projects row acts on its terminal or folder; the module bar is a pie surface", () => {
  const panel = `<nav data-pie-target="panel">
      <div data-pie-surface="list" data-pie-row data-pie-terminal="t2" data-pie-folder="C:\\r"><span class="t">claude</span></div>
      <div data-pie-surface="list" data-pie-row data-pie-folder="C:\\p"><span class="p">repo</span></div>
      <div class="blank"></div>
    </nav>
    <aside data-pie-surface="pie" data-pie-target="panel"><button class="icon">Projects</button></aside>`;
  assert.deepEqual(placeOf(panel, ".t"), {
    rules: "list",
    mouseReporting: false,
    target: { surface: "panel", row: { kind: "terminal", terminalId: "t2", folder: "C:\\r" } },
  });
  assert.deepEqual(placeOf(panel, ".p").target, { surface: "panel", row: { kind: "folder", folder: "C:\\p" } });
  assert.deepEqual(placeOf(panel, ".blank"), { rules: "elsewhere", mouseReporting: false, target: { surface: "panel", row: null } });
  assert.deepEqual(placeOf(panel, ".icon"), { rules: "pie", mouseReporting: false, target: { surface: "panel", row: null } });
});

test("a text input wins over the surface around it; the companion and the empty stage are pie surfaces", () => {
  const html = `<section data-pie-surface="pie" data-pie-target="companion"><input class="i"><p class="c">PR</p></section>
    <div data-pie-surface="pie" data-pie-target="empty-stage"><p class="e">No terminal</p></div>
    <div data-pie-surface="praxis-canvas"><div class="n">node</div></div>
    <div class="x">elsewhere</div>`;
  assert.equal(placeOf(html, ".i").rules, "text-input");
  assert.deepEqual(placeOf(html, ".c"), { rules: "pie", mouseReporting: false, target: { surface: "companion" } });
  assert.deepEqual(placeOf(html, ".e").target, { surface: "empty-stage" });
  assert.deepEqual(placeOf(html, ".n"), { rules: "praxis-canvas", mouseReporting: false, target: { surface: "other" } });
  assert.deepEqual(placeOf(html, ".x"), { rules: "elsewhere", mouseReporting: false, target: { surface: "other" } });
});
