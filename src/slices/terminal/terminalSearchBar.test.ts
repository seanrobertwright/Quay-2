/// <reference types="node" />
// Component tests for the terminal's search bar (#821): the real `TerminalSearchBar` rendered into
// happy-dom. They check what assistive tech reads from the bar: the field's name, each button's
// name, each toggle's pressed state, the Alt shortcuts the toggles' titles promise, and the live
// match count.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { TerminalSearchBar } = await import("./TerminalSearchBar.tsx");

type Options = { caseSensitive: boolean; regex: boolean; wholeWord: boolean };

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

function render(props: { searchResult?: { index: number; count: number }; finds?: Options[] } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  const finds = props.finds ?? [];
  const element = (searchResult?: { index: number; count: number }) =>
    createElement(TerminalSearchBar, {
      isOpen: true,
      searchResult,
      onFindNext: (_query: string, options: Options) => finds.push(options),
      onFindPrevious: () => {},
      onClear: () => {},
      onClose: () => {},
      onGetScrollback: () => "",
    });
  act(() => root.render(element(props.searchResult)));
  return { rerender: (searchResult?: { index: number; count: number }) => act(() => root.render(element(searchResult))) };
}

const field = () => document.querySelector<HTMLInputElement>("input")!;

test("the search field has a name of its own, not only a placeholder", () => {
  render();
  assert.equal(field().getAttribute("aria-label"), "Find in terminal");
});

test("every button in the bar has a name a screen reader reads, and the whole-word glyph is not read", () => {
  render();
  const names = [...document.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
  assert.deepEqual(names, [
    "Match case",
    "Use regular expression",
    "Match whole word",
    "Previous match",
    "Next match",
    "Copy scrollback",
    "Export scrollback as a log file",
    "Close search",
  ]);
  const wholeWord = document.querySelector('button[aria-label="Match whole word"]')!;
  assert.equal(wholeWord.querySelector('[aria-hidden="true"]')?.textContent, String.raw`\b`);
});

const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const pressed = () => ["Match case", "Use regular expression", "Match whole word"].map((name) => button(name).getAttribute("aria-pressed"));

test("each toggle reports whether it is on, and clicking it flips that", () => {
  render();
  assert.deepEqual(pressed(), ["false", "false", "false"]);
  act(() => button("Match case").click());
  assert.deepEqual(pressed(), ["true", "false", "false"]);
  act(() => button("Use regular expression").click());
  act(() => button("Match whole word").click());
  assert.deepEqual(pressed(), ["true", "true", "true"]);
  act(() => button("Match case").click());
  assert.deepEqual(pressed(), ["false", "true", "true"]);
});

function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

test("Alt+C, Alt+R and Alt+W in the field turn on the toggles their titles name, and the keys go no further", () => {
  render();
  assert.match(button("Match case").title, /Alt\+C/);
  assert.match(button("Use regular expression").title, /Alt\+R/);
  assert.match(button("Match whole word").title, /Alt\+W/);
  assert.equal(press(field(), "c", { altKey: true }).defaultPrevented, true);
  assert.deepEqual(pressed(), ["true", "false", "false"]);
  press(field(), "R", { altKey: true });
  assert.deepEqual(pressed(), ["true", "true", "false"]);
  press(field(), "w", { altKey: true });
  assert.deepEqual(pressed(), ["true", "true", "true"]);
  press(field(), "c", { altKey: true });
  assert.deepEqual(pressed(), ["false", "true", "true"]);
});

test("the Alt shortcuts work while a button in the bar has focus", () => {
  render();
  press(button("Next match"), "w", { altKey: true });
  assert.deepEqual(pressed(), ["false", "false", "true"]);
});

test("C, R and W without Alt, or with Ctrl or Meta as well, toggle nothing", () => {
  render();
  for (const key of ["c", "r", "w"]) {
    assert.equal(press(field(), key).defaultPrevented, false);
    press(field(), key, { altKey: true, ctrlKey: true });
    press(field(), key, { altKey: true, metaKey: true });
  }
  assert.deepEqual(pressed(), ["false", "false", "false"]);
});

function type(text: string) {
  const input = field();
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const status = () => document.querySelector('[role="status"]');

test("the match count sits in a polite live region that says the count in words", () => {
  const bar = render({ searchResult: { index: 2, count: 12 } });
  type("err");
  const region = status();
  assert.ok(region, "the counter is in a status region");
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.getAttribute("aria-atomic"), "true");
  assert.match(region.textContent ?? "", /3\/12/);
  assert.match(region.textContent ?? "", /3 of 12 matches/);
  bar.rerender({ index: 0, count: 1 });
  assert.match(status()?.textContent ?? "", /1 of 1 match$/);
  bar.rerender({ index: -1, count: 0 });
  assert.match(status()?.textContent ?? "", /No matches/);
});

test("the live region says nothing while the field is empty", () => {
  render({ searchResult: { index: 0, count: 4 } });
  assert.equal(status()?.textContent ?? "", "");
});
