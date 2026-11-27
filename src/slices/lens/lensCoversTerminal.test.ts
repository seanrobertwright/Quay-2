/// <reference types="node" />
// Ctrl+F and the search of a terminal a lens covers (#809), drawn as Quay's window draws them: the
// real stage with a real terminal, a lens in its positioned wrapper over the stage, as the diff lens
// and the run lens draw their shared frame, and beside them a field of the companion's, which does not
// handle Ctrl+F itself. Only Tauri's `invoke` is faked. The terminal's own focus runs on its real
// timers, so each check waits them out.
import "../../test-support/bundlerImports.ts";
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";

const { Stage } = await import("../stage/Stage.tsx");
const { Lens } = await import("./Lens.tsx");

const { setTimeout: later } = globalThis;
const noop = () => {};
const PROJECT = "E:/alpha";
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

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted;
    await act(async () => root.unmount());
    container.remove();
  }
  mounted = null;
});

/** Lets the page run for `ms` of real time: what was promised, its frames and its timers. */
const wait = (ms: number) => act(async () => void (await new Promise((done) => later(done, ms))));
/** Waits out a terminal's timed focus, whose last try runs half a second after it was asked. */
const settleFocus = () => wait(700);

/** Waits, for up to two seconds, until `holds`. */
async function until(holds: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !holds(); i += 1) await wait(20);
  assert.ok(holds(), what);
}

let setLensOpen: (open: boolean) => void = noop;

/** The stage with the terminal, a lens over it while one is open, and the companion's field. */
const Window = () => {
  const [lensOpen, setOpen] = useState(false);
  setLensOpen = setOpen;
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
        onSelectTerminal: noop,
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
      }),
      lensOpen
        ? createElement(Lens, {
            label: "Diff lens",
            title: "Files · pull request #7",
            terminalId: TERMINAL.id,
            onClose: () => setOpen(false),
            replyStrip: null,
            children: createElement("button", { type: "button" }, "src/app.ts"),
          })
        : null,
    ),
    createElement("aside", { "data-companion": "" }, createElement("input", { "aria-label": "Answer" })),
  );
};

/** Quay's window with the terminal on the stage and no lens open. */
async function draw(): Promise<HTMLElement> {
  fakeInvoke(async (cmd) => (cmd === "get_terminal_output" ? { data: "ready", last_seq: 1, rows: 24, cols: 80 } : null));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(Window)));
  await until(() => terminalKeys(container) !== null, "the terminal never drew");
  // The terminal focuses itself as it draws; that is over before the test moves the focus.
  await settleFocus();
  return container;
}

const terminalKeys = (container: HTMLElement) =>
  container.querySelector<HTMLTextAreaElement>('[data-pie-terminal="t1"] .xterm-helper-textarea');
const lens = (container: HTMLElement) => container.querySelector('section[aria-label="Diff lens"]');
const answer = (container: HTMLElement) => container.querySelector<HTMLInputElement>('[data-companion] input[aria-label="Answer"]')!;
const lensItem = (container: HTMLElement) =>
  [...lens(container)!.querySelectorAll("button")].find((b) => b.textContent === "src/app.ts")!;
/** Whether the terminal's "Find in terminal..." bar is open. */
const searchOpen = (container: HTMLElement) => container.querySelector('[data-pie-terminal="t1"] input') !== null;

/** What has the focus, by name, so a failed check says where it went. */
function focused(container: HTMLElement): string {
  const active = document.activeElement;
  if (active === null || active === document.body) return "nothing";
  if (active === terminalKeys(container)) return "the terminal";
  return active.getAttribute("aria-label") ?? active.textContent?.trim() ?? active.tagName;
}

/** Presses Ctrl+F where the focus is. */
const ctrlF = () =>
  act(async () => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
  });

async function openLens(container: HTMLElement): Promise<void> {
  await act(async () => setLensOpen(true));
  await until(() => lens(container) !== null, "the lens never opened");
}

for (const [where, focus, name] of [
  ["in the lens", (container: HTMLElement) => lensItem(container).focus(), "src/app.ts"],
  ["in the companion", (container: HTMLElement) => answer(container).focus(), "Answer"],
] as const) {
  test(`with a lens open and the focus ${where}, Ctrl+F leaves the covered terminal's search closed and the focus where it was`, async () => {
    const container = await draw();
    await openLens(container);
    await act(async () => focus(container));
    await ctrlF();
    await settleFocus();
    assert.equal(searchOpen(container), false, "the covered terminal's search bar stays closed");
    assert.equal(focused(container), name);
  });
}

test("with a lens open and the focus left in the covered terminal, Ctrl+F leaves its search closed", async () => {
  const container = await draw();
  await openLens(container);
  await act(async () => terminalKeys(container)!.focus());
  await ctrlF();
  await settleFocus();
  assert.equal(searchOpen(container), false, "the covered terminal's search bar stays closed");
});

test("a terminal search open before a lens opened stays open under it through Ctrl+F", async () => {
  const container = await draw();
  await act(async () => answer(container).focus());
  await ctrlF();
  await until(() => searchOpen(container), "Ctrl+F from the companion never opened the search");
  await openLens(container);
  await act(async () => lensItem(container).focus());
  await ctrlF();
  await settleFocus();
  assert.equal(searchOpen(container), true, "the search bar is still open");
});

test("with no lens open, Ctrl+F from the terminal and from a field that does not handle it toggles the terminal's search", async () => {
  const container = await draw();
  await act(async () => terminalKeys(container)!.focus());
  await ctrlF();
  await until(() => searchOpen(container), "Ctrl+F from the terminal never opened the search");

  await act(async () => answer(container).focus());
  await ctrlF();
  await until(() => !searchOpen(container), "Ctrl+F from the companion never closed the search");
  await ctrlF();
  await until(() => searchOpen(container), "Ctrl+F from the companion never opened the search");
});

test("a Ctrl+F that what has the focus already handled leaves the terminal's search closed", async () => {
  const container = await draw();
  const field = answer(container);
  // As Topos's find claims the key: it cancels it and lets it go on to the window.
  const claim = (e: KeyboardEvent) => e.preventDefault();
  field.addEventListener("keydown", claim);
  await act(async () => field.focus());
  await ctrlF();
  await settleFocus();
  field.removeEventListener("keydown", claim);
  assert.equal(searchOpen(container), false, "the terminal's search bar stays closed");
  assert.equal(focused(container), "Answer");
});
