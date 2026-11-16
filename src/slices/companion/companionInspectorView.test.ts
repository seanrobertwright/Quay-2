/// <reference types="node" />
// The companion's Inspector view (#646): while the Praxis Builder stage tab is in front, the
// companion shows the Inspector for the builder to draw into, and once the tab leaves, the view it
// showed before comes back.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo as terminal } from "./fixtures/companionFixtures.ts";
import type { CompanionActivity } from "./ActivityView.tsx";

const { Companion, COMPANION_VIEWS } = await import("./Companion.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

const projects = [{ path: "E:/alpha", name: "Alpha", terminal_ids: [] }];
const worktrees = { "E:/alpha": [{ path: "E:/alpha", head: "a1", branch: "main", is_main: true, is_bare: false, is_locked: false }] };
const activity: CompanionActivity = { events: [], messages: [], waiting: [], answer: async () => {} };

/** The element the companion last handed the builder to draw its inspector into. */
let slot: HTMLElement | null = null;
const inspector = { slot: (el: HTMLElement | null) => void (slot = el) };

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  mounted = { root: createRoot(container), container };
  return container;
}

function render(selected: TerminalInfo | null, withInspector: boolean) {
  const container = mounted?.container ?? mount();
  act(() =>
    mounted!.root.render(
      createElement(Companion, {
        selectedTerminal: selected,
        projects,
        projectWorktrees: worktrees,
        views: COMPANION_VIEWS,
        prefs: companionPrefs(memoryStorage()),
        activity,
        inspector: withInspector ? inspector : null,
      }),
    ),
  );
  return container;
}

const shownView = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-companion-view]")?.dataset.companionView;
const switchNames = (container: HTMLElement) => [...container.querySelectorAll('[role="radio"]')].map((r) => r.textContent);
const pick = (container: HTMLElement, name: string) => {
  const radio = [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent === name);
  assert.ok(radio, `the view switch lists ${name}`);
  act(() => radio.click());
};

test("while the builder is in front, the companion shows the Inspector and hands the builder its slot", () => {
  slot = null;
  const container = render(terminal("t1", "E:/alpha"), true);
  assert.equal(shownView(container), "inspector");
  assert.ok(switchNames(container).includes("Inspector"));
  assert.ok(slot !== null && container.contains(slot), "the slot is in the Inspector view");
});

test("the Inspector is offered only while the builder is in front", () => {
  const container = render(terminal("t1", "E:/alpha"), false);
  assert.ok(!switchNames(container).includes("Inspector"));
  assert.notEqual(shownView(container), "inspector");
});

test("once the builder leaves, the view the companion showed before comes back", () => {
  const selected = terminal("t1", "E:/alpha");
  const container = render(selected, false);
  pick(container, "Activity");
  assert.equal(shownView(container), "activity");

  render(selected, true);
  assert.equal(shownView(container), "inspector");
  render(selected, false);
  assert.equal(shownView(container), "activity");
  assert.equal(slot, null, "the slot is taken back");
});

test("with no terminal selected, the Inspector still shows while the builder is in front", () => {
  slot = null;
  const container = render(null, true);
  assert.equal(shownView(container), "inspector");
  assert.ok(slot !== null && container.contains(slot));
});
