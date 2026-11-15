/// <reference types="node" />
// Component tests for the stage tab bar (#634): a tab per terminal of the active project, one click
// to show one, the layout switchers and Zoom on its right, and nothing else on it.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { StageLayout, TerminalInfo } from "../terminal/types.ts";

const { StageTabBar, STAGE_TAB_BAR_HEIGHT } = await import("./StageTabBar.tsx");

const terminal = (id: string, name: string): TerminalInfo => ({
  id,
  name,
  project_path: "C:/work/repo",
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "idle",
  auto_approved_count: 0,
});
const TERMINALS = [terminal("a", "planner"), terminal("b", "coder"), terminal("c", "pwsh")];

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

function render({ layout = "single" as StageLayout, zoomedFromLayout = null as StageLayout | null, currentId = "a" } = {}) {
  const calls: string[] = [];
  const log = (name: string) => () => void calls.push(name);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(StageTabBar, {
        terminals: TERMINALS,
        currentTerminalId: currentId,
        layout,
        zoomedFromLayout,
        onSelectTerminal: (id: string) => void calls.push(`select ${id}`),
        onNewTerminal: log("new"),
        onUnsplit: log("single"),
        onSplitHorizontal: log("split-horizontal"),
        onSplitVertical: log("split-vertical"),
        onSplitGrid: log("grid"),
        onToggleZoom: log("zoom"),
      }),
    ),
  );
  mounted = { root, container };
  const bar = container.firstElementChild as HTMLElement;
  const tabs = () => [...bar.querySelectorAll('[aria-label="Stage tabs"] button[data-terminal-id]')] as HTMLButtonElement[];
  const radios = () => [...bar.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
  const named = (name: string) => {
    const found = ([...bar.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => b.getAttribute("aria-label") === name);
    assert.ok(found, `no button named ${name}`);
    return found;
  };
  return { bar, calls, tabs, radios, named };
}

test("the stage tab bar is 34 px tall", () => {
  const { bar } = render();
  assert.equal(STAGE_TAB_BAR_HEIGHT, 34);
  assert.equal(getComputedStyle(bar).height, "34px");
});

test("each terminal has a tab named for it, and the shown terminal's tab is current", () => {
  const { tabs } = render({ currentId: "b" });
  assert.deepEqual(tabs().map((t) => t.getAttribute("aria-label")), ["planner", "coder", "pwsh"]);
  assert.deepEqual(tabs().map((t) => t.getAttribute("aria-current")), [null, "true", null]);
});

test("one click on a tab shows its terminal", () => {
  const { tabs, calls } = render();
  act(() => tabs()[2].click());
  assert.deepEqual(calls, ["select c"]);
});

test("no element claims role=tab, which would promise the tab keyboard pattern", () => {
  const { bar } = render();
  assert.equal(bar.querySelectorAll('[role="tab"], [role="tablist"]').length, 0);
});

test("the bar holds only the tabs, New terminal, the layout switchers and Zoom", () => {
  const { bar } = render({ layout: "grid" });
  const names = ([...bar.querySelectorAll("button")] as HTMLButtonElement[]).map((b) => b.getAttribute("aria-label"));
  assert.deepEqual(names, ["planner", "coder", "pwsh", "New terminal", "Single", "Split horizontal", "Split vertical", "2 x 2 grid", "Zoom pane"]);
});

test("the layout switchers are one radio group, checked on the current layout", () => {
  const { bar, radios } = render({ layout: "split-horizontal" });
  assert.equal(bar.querySelector('[role="radiogroup"]')?.getAttribute("aria-label"), "Layout");
  assert.deepEqual(radios().map((r) => r.getAttribute("aria-checked")), ["false", "true", "false", "false"]);
  // Only the checked radio is in the tab order; the arrow keys move within the group.
  assert.deepEqual(radios().map((r) => r.tabIndex), [-1, 0, -1, -1]);
});

test("each layout switcher runs the same action as its chord", () => {
  const { radios, calls } = render();
  for (const radio of radios()) act(() => radio.click());
  assert.deepEqual(calls, ["single", "split-horizontal", "split-vertical", "grid"]);
});

test("the arrow keys move focus between layouts, wrapping, without switching the layout", () => {
  const { radios, calls } = render({ layout: "split-horizontal" });
  const key = (el: HTMLElement, k: string) =>
    act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
  key(radios()[1], "ArrowRight");
  assert.equal(document.activeElement, radios()[2]);
  key(radios()[2], "ArrowLeft");
  assert.equal(document.activeElement, radios()[1]);
  key(radios()[0], "ArrowLeft");
  assert.equal(document.activeElement, radios()[3]);
  assert.deepEqual(calls, []);
});

test("while a pane is zoomed, the layout it came from stays checked", () => {
  const { radios, named } = render({ layout: "single", zoomedFromLayout: "grid" });
  assert.deepEqual(radios().map((r) => r.getAttribute("aria-checked")), ["false", "false", "false", "true"]);
  assert.equal(named("Zoom pane").getAttribute("aria-pressed"), "true");
});

test("Zoom is a toggle that shows whether the pane is zoomed and runs the zoom action", () => {
  const off = render();
  assert.equal(off.named("Zoom pane").getAttribute("aria-pressed"), "false");
  act(() => off.named("Zoom pane").click());
  assert.deepEqual(off.calls, ["zoom"]);
  act(() => mounted!.root.unmount());
  mounted!.container.remove();
  mounted = null;
  const on = render({ layout: "single", zoomedFromLayout: "split-horizontal" });
  assert.equal(on.named("Zoom pane").getAttribute("aria-pressed"), "true");
});
