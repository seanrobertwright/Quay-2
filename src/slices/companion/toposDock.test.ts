/// <reference types="node" />
// Component tests for Topos in the companion (#643): the Topos view, its Wide toggle that opens the
// Topos lens over the terminal, how the lens closes, and Topos keeping its state across close and
// reopen. Topos itself stands in as a counter, so the tests see whether its state survives.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo } from "./fixtures/companionFixtures.ts";
import type { CompanionShowRequest } from "./Companion.tsx";

const { Companion, COMPANION_VIEWS } = await import("./Companion.tsx");
const { useToposDock, ToposLens, ToposLayer } = await import("./ToposDock.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
});

const projects = [{ path: "E:/alpha", name: "Alpha", terminal_ids: [] }];
const worktrees = {
  "E:/alpha": [{ path: "E:/alpha", head: "a1", branch: "main", is_main: true, is_bare: false, is_locked: false }],
};

/** Topos's stand-in: a counter whose count is the state Topos must keep. */
const Counter = () => {
  const [count, setCount] = useState(0);
  return createElement("button", { type: "button", "data-counter": "", onClick: () => setCount((n) => n + 1) }, `Clicked ${count}`);
};

/** The companion, the stage with the Topos lens over it when open, and Topos's layer, as the app wires them. */
const Shell = ({ terminal, showRequest }: { terminal: TerminalInfo | null; showRequest: CompanionShowRequest | null }) => {
  const dock = useToposDock(terminal?.id ?? null);
  const stage: ReactNode =
    dock.wide && terminal
      ? createElement(ToposLens, { dock, terminalId: terminal.id, title: "Topos · Alpha", replyStrip: null })
      : null;
  return createElement(
    "div",
    null,
    createElement("div", { "data-stage": "" }, stage),
    createElement(Companion, {
      selectedTerminal: terminal,
      projects,
      projectWorktrees: worktrees,
      views: COMPANION_VIEWS,
      prefs: companionPrefs(memoryStorage()),
      topos: dock.companion,
      showRequest,
    }),
    createElement(ToposLayer, { dock, children: createElement(Counter) }),
  );
};

function render(terminal: TerminalInfo | null = terminalInfo("a", "E:/alpha")) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let seq = 0;
  const show = (request: CompanionShowRequest | null) => act(() => root.render(createElement(Shell, { terminal, showRequest: request })));
  show(null);
  mounted = { root, container };
  return {
    container,
    /** Asks the companion to show `view`, as chord `c` and the palette do. */
    request: (view: CompanionShowRequest["view"]) => show({ terminalId: terminal?.id ?? "", view, seq: ++seq }),
    layer: () => container.querySelector<HTMLElement>("[data-topos-layer]")!,
    counter: () => container.querySelector<HTMLButtonElement>("[data-counter]")!,
    viewButton: (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] [role="radio"]')].find((b) => b.textContent === label),
    wide: () => [...container.querySelectorAll<HTMLButtonElement>("aside button")].find((b) => b.textContent === "Wide"),
    lens: () => container.querySelector<HTMLElement>('[data-stage] section[aria-label="Topos lens"]'),
  };
}

test("Topos is a companion view: picking it shows Topos in the companion, and another view hides it", () => {
  const ui = render();
  assert.ok(ui.viewButton("Topos"), "the view switch lists Topos");
  assert.equal(ui.layer().hidden, true, "Topos is hidden until its view shows");
  act(() => ui.viewButton("Topos")!.click());
  assert.equal(ui.container.querySelector("section[data-companion-view]")?.getAttribute("aria-label"), "Topos");
  assert.equal(ui.layer().hidden, false);
  assert.equal(ui.layer().dataset.placement, "companion");
  act(() => ui.viewButton("Repository")!.click());
  assert.equal(ui.layer().hidden, true);
});

/** A stand-in for terminal `id`'s pane: a textarea that takes focus when the pane is asked to. */
function terminalPane(id: string) {
  const textarea = document.createElement("textarea");
  document.body.append(textarea);
  const listener = (e: Event) => {
    if ((e as CustomEvent<{ terminalId?: string }>).detail?.terminalId === id) textarea.focus();
  };
  window.addEventListener("quay:focus-terminal", listener);
  return {
    textarea,
    remove: () => {
      window.removeEventListener("quay:focus-terminal", listener);
      textarea.remove();
    },
  };
}

const escapeFrom = (el: Element) =>
  act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));

for (const [how, close] of [
  ["its close button", (ui: ReturnType<typeof render>) => [...ui.lens()!.querySelectorAll("button")].find((b) => b.textContent === "Close lens")!.click()],
  ["the Wide toggle", (ui: ReturnType<typeof render>) => ui.wide()!.click()],
  // Escape from inside Topos, which draws in its own layer beside the lens frame.
  ["Escape", (ui: ReturnType<typeof render>) => escapeFrom(ui.counter())],
] as const) {
  test(`Wide opens the Topos lens with Topos in it; closing it with ${how} puts Topos back and focuses the terminal`, () => {
    const pane = terminalPane("a");
    try {
      const ui = render();
      ui.request("topos");
      assert.equal(ui.wide()?.getAttribute("aria-pressed"), "false");
      act(() => ui.wide()!.click());
      assert.ok(ui.lens(), "the Topos lens is open over the stage");
      assert.equal(ui.wide()?.getAttribute("aria-pressed"), "true");
      assert.equal(ui.layer().dataset.placement, "lens");
      assert.equal(ui.layer().hidden, false);
      act(() => void close(ui));
      assert.equal(ui.lens(), null, "the lens closed");
      assert.equal(ui.layer().dataset.placement, "companion");
      assert.ok(document.activeElement === pane.textarea, "focus is back on the terminal");
    } finally {
      pane.remove();
    }
  });
}

test("Topos keeps its state across close and reopen, in the companion and through the lens", () => {
  const ui = render();
  ui.request("topos");
  const topos = ui.counter();
  act(() => topos.click());
  act(() => topos.click());
  act(() => ui.viewButton("Repository")!.click());
  assert.equal(ui.layer().hidden, true);
  ui.request("topos");
  act(() => ui.wide()!.click());
  act(() => ui.wide()!.click());
  assert.equal(ui.layer().hidden, false);
  assert.ok(ui.counter() === topos, "the same Topos, never remounted");
  assert.equal(ui.counter().textContent, "Clicked 2");
});

test("selecting another terminal closes the Topos lens", () => {
  const ui = render();
  ui.request("topos");
  act(() => ui.wide()!.click());
  assert.ok(ui.lens());
  act(() =>
    mounted!.root.render(createElement(Shell, { terminal: terminalInfo("b", "E:/alpha"), showRequest: null })),
  );
  assert.equal(ui.lens(), null);
});
