/// <reference types="node" />
// Where the keyboard focus goes as the Topos lens closes (#793), drawn as Quay's window draws it: the
// real stage with a real terminal, the companion's Topos view with a field of the companion's beside
// it, the Topos lens over the stage and the real Topos in its own layer, all on the one overlay stack.
// Topos is drawn once and moves between the lens and the companion as the lens opens and closes, so
// whatever in it had the focus keeps it unless the lens's close hands it on. Only Tauri's `invoke` is
// faked. The terminal's own focus runs on its real timers, so each check waits them out.
import "../../test-support/bundlerImports.ts";
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";
import type { ToposTarget } from "../git/topos/Topos.tsx";

const { Stage } = await import("../stage/Stage.tsx");
const { useToposDock, ToposLens, ToposLayer, ToposViewSlot } = await import("./ToposDock.tsx");
const { Topos } = await import("../git/topos/Topos.tsx");

const { setTimeout: later } = globalThis;
const noop = () => {};
const PROJECT = "E:/alpha";
const OWN: ToposTarget = { path: PROJECT, name: "Alpha", repoPath: PROJECT };
const TERMINAL: TerminalInfo = {
  id: "t1",
  name: "fix-75",
  project_path: PROJECT,
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "idle",
  auto_approved_count: 0,
};
const NO_OPERATION = { kind: "none", leftLabel: null, rightLabel: null, message: null, conflicts: [], conflictsTotal: 0 };

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted;
    await act(async () => root.unmount());
    container.remove();
  }
  mounted = null;
});

/** Rust for the terminal and for Topos: git's version and operation answer, and what else Topos reads fails. */
function startRust(): void {
  const answers: Record<string, () => unknown> = {
    get_terminal_output: () => ({ data: "ready", last_seq: 1, rows: 24, cols: 80 }),
    git_version_check: () => ({ status: "ok" }),
    git_operation_state: () => NO_OPERATION,
  };
  fakeInvoke(async (cmd) => {
    if (Object.prototype.hasOwnProperty.call(answers, cmd)) return answers[cmd]();
    if (cmd.startsWith("git_") || cmd.startsWith("topos_")) throw new Error(`${cmd} is not faked`);
    return null;
  });
}

/** Lets the page run for `ms` of real time: what was promised, its frames and its timers. */
const wait = (ms: number) => act(async () => void (await new Promise((done) => later(done, ms))));
/** Waits out a terminal's timed focus, whose last try runs half a second after it was asked. */
const settleFocus = () => wait(700);

/** Waits, for up to two seconds, until `holds`. */
async function until(holds: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !holds(); i += 1) await wait(20);
  assert.ok(holds(), what);
}

/** The stage with the terminal and a Swarm tab, the companion's Topos view, the Topos lens and Topos, wired as the app wires them. */
const Window = () => {
  const [frontId, setFrontId] = useState<string | null>(null);
  // Each open of the lens moves the focus into Topos, as the app's does.
  const [focusKey, setFocusKey] = useState(0);
  const dock = useToposDock(TERMINAL.id, () => setFocusKey((n) => n + 1));
  return createElement(
    "div",
    null,
    createElement(
      "div",
      { "data-stage-wrapper": "" },
      createElement(Stage, {
        terminals: [TERMINAL],
        activeProject: PROJECT,
        activeTerminalId: TERMINAL.id,
        primaryTerminalId: TERMINAL.id,
        secondaryTerminalId: null,
        gridTerminalIds: [TERMINAL.id, null, null, null],
        layout: "single",
        focusedPane: "primary",
        splitRatio: 50,
        zoomedFromLayout: null,
        onSelectTerminal: () => setFrontId(null),
        onSelectPane: noop,
        onSwitchPaneTerminal: noop,
        onSetLayout: noop,
        onSetSplitRatio: noop,
        onToggleZoom: noop,
        onUnsplit: noop,
        onSplitHorizontal: noop,
        onSplitVertical: noop,
        onSplitGrid: noop,
        onNewTerminal: noop,
        tools: [{ id: "Swarm", label: "Swarm", icon: null, content: createElement("p", null, "The swarm") }],
        frontToolId: frontId,
        onSelectTool: setFrontId,
        onCloseTool: () => setFrontId(null),
      }),
      dock.wide ? createElement(ToposLens, { dock, terminalId: TERMINAL.id, title: "Topos · Alpha", replyStrip: null }) : null,
    ),
    createElement(
      "aside",
      { "data-companion": "" },
      // The companion's Wide toggle, and a field of its own, such as an agent's question.
      createElement(
        "button",
        { type: "button", "aria-pressed": dock.companion.wide, onClick: dock.companion.wide ? dock.companion.closeWide : dock.companion.openWide },
        "Wide",
      ),
      createElement("input", { "aria-label": "Answer" }),
      createElement(ToposViewSlot, { topos: dock.companion }),
    ),
    createElement(ToposLayer, {
      dock,
      children: createElement(Topos, {
        isOpen: dock.placement !== null,
        wide: dock.placement === "lens",
        focusKey,
        project: OWN,
        terminals: [TERMINAL],
      }),
    }),
  );
};

/** Quay's window with Topos showing in the companion and the terminal on the stage. */
async function draw(): Promise<HTMLElement> {
  startRust();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(Window)));
  await until(() => terminalKeys(container) !== null, "the terminal never drew");
  await until(() => graphList(container) !== null, "Topos never drew its graph");
  // The terminal focuses itself as it draws; that is over before the test moves the focus.
  await settleFocus();
  return container;
}

const terminalKeys = (container: HTMLElement) =>
  container.querySelector<HTMLTextAreaElement>('[data-pie-terminal="t1"] .xterm-helper-textarea');
const lens = (container: HTMLElement) => container.querySelector('section[aria-label="Topos lens"]');
const layer = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-topos-layer]")!;
const graphList = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-topos-layer] [role="listbox"][aria-label="Commits"]');
const findField = (container: HTMLElement) => layer(container).querySelector<HTMLInputElement>('[role="search"] input[type="search"]');
const button = (within: Element, name: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name);

/** What has the focus, by name, so a failed check says where it went. */
function focused(container: HTMLElement): string {
  const active = document.activeElement;
  if (active === null || active === document.body) return "nothing";
  if (active === terminalKeys(container)) return "the terminal";
  if (active === findField(container)) return `Topos's find field, over the ${layer(container).dataset.placement}`;
  const where = layer(container).contains(active) ? `in Topos, over the ${layer(container).dataset.placement}` : "outside Topos";
  return `${active.getAttribute("aria-label") ?? active.textContent?.trim().slice(0, 40) ?? active.tagName}, ${where}`;
}

/** Presses `key`, with Ctrl when `ctrl`, where the focus is. */
const press = (key: string, ctrl = false) =>
  act(async () => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: ctrl, bubbles: true, cancelable: true }));
  });

/** Opens Topos's find with Ctrl+F from inside Topos, and waits for its field to take the focus. */
async function openFind(container: HTMLElement): Promise<void> {
  await act(async () => graphList(container)!.focus());
  // Topos takes the key first; past it, the terminal's own Ctrl+F on the window would open the terminal's search too.
  const stop = (e: Event) => e.stopPropagation();
  layer(container).addEventListener("keydown", stop);
  await press("f", true);
  layer(container).removeEventListener("keydown", stop);
  await until(() => document.activeElement === findField(container), "the find never took the focus");
}

const wideToggle = (container: HTMLElement) => button(container.querySelector("[data-companion]")!, "Wide")!;

/**
 * Opens the Topos lens with the companion's Wide toggle, and waits for it. A pointer takes the focus
 * to the toggle first; from the keyboard, such as from the palette, the focus stays where it was
 * until Topos takes it.
 */
async function openLens(container: HTMLElement, from: "pointer" | "keyboard" = "pointer"): Promise<void> {
  if (from === "pointer") await act(async () => wideToggle(container).focus());
  await act(async () => wideToggle(container).click());
  await until(() => lens(container) !== null && layer(container).dataset.placement === "lens", "the lens never opened");
}

const closeLensButton = (container: HTMLElement) => button(lens(container)!, "Close lens")!;

for (const [how, close] of [
  ["Escape", () => press("Escape")],
  // As the keyboard presses it: the focus stays where it was until the lens has closed.
  ["Close lens", (container: HTMLElement) => act(async () => closeLensButton(container).click())],
] as const) {
  test(`with the focus in Topos's find field, closing the Topos lens with ${how} puts the focus on the terminal`, async () => {
    const container = await draw();
    // The find opened in the companion stays open as the lens opens from the keyboard over it.
    await openFind(container);
    await openLens(container, "keyboard");
    await act(async () => findField(container)!.focus());
    assert.equal(focused(container), "Topos's find field, over the lens");

    await close(container);
    await settleFocus();
    assert.equal(lens(container) !== null, false, `${how} closes the lens`);
    assert.equal(findField(container) !== null, true, "the find is still open, over the companion");
    assert.equal(focused(container), "the terminal");
  });
}

test("with Topos's find open in the lens, Close lens pressed as a pointer does puts the focus on the terminal", async () => {
  const container = await draw();
  await openLens(container);
  await openFind(container);
  // A press on the button takes the focus to it first.
  await act(async () => closeLensButton(container).focus());
  await act(async () => closeLensButton(container).click());
  await settleFocus();
  assert.equal(lens(container) !== null, false, "Close lens closes the lens");
  assert.equal(findField(container) !== null, true, "the find is still open, over the companion");
  assert.equal(focused(container), "the terminal");
});

test("with Topos's find open in the lens, Escape clears the find, and the next Escape closes the lens and puts the focus on the terminal", async () => {
  const container = await draw();
  await openLens(container);
  await openFind(container);

  await press("Escape");
  await settleFocus();
  assert.deepEqual([findField(container) !== null, lens(container) !== null], [false, true], "the first Escape clears the find");
  await press("Escape");
  await settleFocus();
  assert.equal(lens(container) !== null, false, "the second Escape closes the lens");
  assert.equal(focused(container), "the terminal");
});

test("with Topos's find open in the lens, closing the lens with the companion's Wide toggle puts the focus on the terminal", async () => {
  const container = await draw();
  await openLens(container);
  await openFind(container);
  await act(async () => wideToggle(container).focus());
  await act(async () => wideToggle(container).click());
  await settleFocus();
  assert.equal(lens(container) !== null, false, "Wide closes the lens");
  assert.equal(findField(container) !== null, true, "the find is still open, over the companion");
  assert.equal(focused(container), "the terminal");
});

test("with a stage tab over the terminal, closing the Topos lens from Topos's find field gives the focus back to the Wide toggle that opened it", async () => {
  const container = await draw();
  await act(async () => button(container, "Swarm")!.click());
  await until(() => container.querySelector('[data-pie-terminal="t1"]')?.closest("[inert]") != null, "the Swarm tab never covered the terminal");
  await openLens(container);
  await openFind(container);

  await act(async () => closeLensButton(container).click());
  await settleFocus();
  assert.equal(lens(container) !== null, false, "Close lens closes the lens");
  assert.equal(focused(container), "Wide, outside Topos");
});

test("Escape in a field of the companion's closes the Topos lens and leaves the focus in that field", async () => {
  const container = await draw();
  await openLens(container);
  const answer = container.querySelector<HTMLInputElement>('[data-companion] input[aria-label="Answer"]')!;
  await act(async () => answer.focus());

  await press("Escape");
  await settleFocus();
  assert.equal(lens(container) !== null, false, "Escape closes the lens");
  assert.equal(focused(container), "Answer, outside Topos");
});
