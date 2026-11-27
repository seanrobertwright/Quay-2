/// <reference types="node" />
// The Session Inactive ribbon of an exited terminal (#816): the real `TerminalView`, with its real
// xterm terminal, rendered into happy-dom, with only Tauri's `invoke` and events faked. The ribbon
// takes its own row of the pane above the terminal, so it covers none of the terminal's rows.
import "../../test-support/bundlerImports.ts";
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "./types.ts";

const { TerminalView } = await import("./TerminalView.tsx");

const EXITED: TerminalInfo = {
  id: "t1",
  name: "notice",
  project_path: "C:/work/repo",
  run_kind: "powershell",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "exited",
  auto_approved_count: 0,
};

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fakeInvoke(async (command) =>
    command === "get_terminal_output" ? { data: "Could not start the CLI.", last_seq: 1, rows: 24, cols: 80 } : null,
  );
});
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  mock.timers.reset();
});

const settle = () =>
  act(async () => {
    await new Promise((done) => setImmediate(done));
    mock.timers.runAll();
  });

async function mountPane(terminal: TerminalInfo, onRelaunch?: () => void): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() =>
    root.render(createElement(TerminalView, { terminalId: terminal.id, isVisible: true, terminal, onRelaunch })),
  );
  await settle();
  const pane = container.querySelector<HTMLElement>("[data-terminal-pane]");
  assert.ok(pane, "the pane is drawn");
  return pane;
}

/** The ribbon's "Session Inactive" label in the pane, if it shows one. */
function inactiveLabel(pane: HTMLElement): HTMLSpanElement | undefined {
  return [...pane.querySelectorAll("span")].find((span) => span.textContent === "Session Inactive");
}

/** The ribbon's own box: the nearest element around its "Session Inactive" text that also holds its action. */
function ribbonOf(pane: HTMLElement): HTMLElement {
  const label = inactiveLabel(pane);
  assert.ok(label, "the pane shows Session Inactive");
  let box = label.parentElement;
  while (box && !box.textContent?.includes("Scrollback restored from disk")) box = box.parentElement;
  assert.ok(box?.parentElement, "the ribbon says the scrollback was restored");
  return box.parentElement;
}

test("an exited terminal's Session Inactive ribbon sits in the pane's column above the terminal, not over it", async () => {
  const pane = await mountPane(EXITED, () => {});
  const ribbon = ribbonOf(pane);
  const xterm = pane.querySelector(".xterm");
  assert.ok(xterm, "the terminal is drawn");

  // In flow: neither the ribbon nor anything between it and the pane is positioned out of the column.
  for (let el: HTMLElement | null = ribbon; el && el !== pane; el = el.parentElement) {
    assert.ok(!el.classList.contains("absolute"), `the ribbon is not inside an absolute layer (${el.className})`);
  }
  assert.ok(!ribbon.contains(xterm), "the ribbon does not hold the terminal");
  // Above the terminal: the ribbon comes before the terminal in the pane, and shares no box with it
  // but the pane's column.
  assert.ok(ribbon.compareDocumentPosition(xterm) & Node.DOCUMENT_POSITION_FOLLOWING, "the terminal comes after the ribbon");
  const viewport = [...pane.children].find((child) => child.contains(xterm));
  assert.ok(viewport && !viewport.contains(ribbon), "the ribbon is outside the terminal's viewport");
  assert.equal(ribbon.parentElement, pane, "the ribbon is a row of the pane's column");
});

test("the ribbon's relaunch button relaunches the terminal", async () => {
  let relaunched = 0;
  const pane = await mountPane(EXITED, () => (relaunched += 1));
  const button = [...ribbonOf(pane).querySelectorAll("button")].find((b) => b.textContent === "Relaunch");
  assert.ok(button, "the ribbon offers Relaunch");
  act(() => button.click());
  assert.equal(relaunched, 1);
});

test("a running terminal shows no Session Inactive ribbon", async () => {
  const pane = await mountPane({ ...EXITED, claude_status: "idle" });
  assert.equal(inactiveLabel(pane), undefined);
});
