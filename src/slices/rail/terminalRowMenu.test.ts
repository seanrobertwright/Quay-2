/// <reference types="node" />
// The terminal menu on a Rail row (#508): the real `TerminalRow` rendered into happy-dom, with
// only Tauri's `invoke` (event listening and the opener plugin) and the clipboard faked. They
// check what a user observes: that the menu opens without changing the selection, where it
// opens, where focus goes, and what choosing an item does.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { TerminalRow } = await import("./TerminalRow.tsx");
const { onTerminalRequest } = await import("../terminal/terminalRequests.ts");
// The row listens for A2A events. `listen` and its unlisten reach these Tauri internals as well
// as `invoke`, so they get stand-ins that do nothing.
const tauriWindow = window as unknown as { __TAURI_INTERNALS__: object; __TAURI_EVENT_PLUGIN_INTERNALS__?: object };
Object.assign(tauriWindow.__TAURI_INTERNALS__, { transformCallback: () => 1 });
tauriWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
type Terminal = import("../terminal/types.ts").TerminalInfo;

const TERMINAL: Terminal = {
  id: "t1",
  name: "claude-1",
  project_path: "C:\\src\\repo",
  run_kind: "claude",
  permission_mode: "skip",
  live_mode: "skip",
  claude_status: "working",
  auto_approved_count: 0,
};

let invoked: { cmd: string; args: Record<string, unknown> }[] = [];
let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  invoked = [];
  fakeInvoke(async (cmd, args) => {
    invoked.push({ cmd, args });
    return cmd === "plugin:event|listen" ? 1 : null;
  });
});
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  document.body.innerHTML = "";
});

/** What the row's handlers were asked to do, in order. */
let calls: string[] = [];

function renderRow(terminal: Terminal = TERMINAL) {
  calls = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() =>
    root.render(
      createElement(TerminalRow, {
        index: 1,
        terminal,
        isActive: false,
        onSelect: () => calls.push("select"),
        onClose: () => calls.push("close"),
        onRename: (id: string, name: string) => calls.push(`rename ${id} ${name}`),
        onRelaunch: (id: string) => calls.push(`relaunch ${id}`),
        onToggleAsk: (id: string) => calls.push(`toggleAsk ${id}`),
      })
    )
  );
  return container.querySelector<HTMLElement>('[role="button"]')!;
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');

function rightClick(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
  });
}

test("right-clicking a terminal's Rail row opens the menu named for it, and leaves the selection alone", () => {
  const row = renderRow();
  rightClick(row);
  assert.equal(menu()?.getAttribute("aria-label"), "Terminal claude-1");
  assert.deepEqual(calls, []);
});

function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

test("Shift+F10 or the Menu key on the focused row opens the menu at its lower left corner, and Escape gives focus back", () => {
  const row = renderRow();
  row.getBoundingClientRect = () => ({ left: 12, top: 30, right: 200, bottom: 64, width: 188, height: 34, x: 12, y: 30, toJSON: () => ({}) });
  for (const keys of [{ key: "F10", shiftKey: true }, { key: "ContextMenu" }]) {
    row.focus();
    press(keys.key, keys);
    assert.equal(menu()?.getAttribute("aria-label"), "Terminal claude-1", keys.key);
    assert.deepEqual([menu()?.style.left, menu()?.style.top], ["12px", "64px"], keys.key);
    assert.equal(document.activeElement?.textContent, "Rename…", "focus starts on the first item");
    press("Escape");
    assert.equal(menu(), null);
    assert.equal(document.activeElement, row, keys.key);
  }
  assert.deepEqual(calls, []);
});

/** Opens the row's menu and chooses the item named `name`. */
function choose(row: HTMLElement, name: string) {
  rightClick(row);
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) => el.textContent?.startsWith(name));
  assert.ok(item, `no item ${name}`);
  act(() => item.click());
}

test("each item runs the row's own action, and choosing one closes the menu", () => {
  const row = renderRow({ ...TERMINAL, claude_status: "exited" });
  choose(row, "Relaunch agent");
  assert.equal(menu(), null);
  choose(row, "Ask before tool calls");
  choose(row, "Show in focused pane");
  choose(row, "Close terminal");
  assert.deepEqual(calls, ["relaunch t1", "toggleAsk t1", "select", "close"]);
});

test("a disabled item says why and does nothing", () => {
  const row = renderRow();
  rightClick(row);
  const relaunch = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.startsWith("Relaunch agent"));
  assert.equal(relaunch?.getAttribute("aria-disabled"), "true");
  assert.equal(relaunch?.textContent, "Relaunch agentStill running");
  act(() => relaunch?.click());
  assert.deepEqual(calls, []);
});

test("Rename… opens the row's rename box, and Enter saves the new name", () => {
  const row = renderRow();
  choose(row, "Rename…");
  const input = row.querySelector<HTMLInputElement>("input");
  assert.ok(input, "the rename box shows");
  assert.equal(input.value, "claude-1");
  assert.equal(document.activeElement, input);
  act(() => {
    // React tracks a controlled input's value through the native setter.
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, "lead");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  press("Enter");
  assert.deepEqual(calls, ["rename t1 lead"]);
  assert.equal(row.querySelector("input"), null, "the box closes");
});

test("Copy working directory writes the terminal's folder to the clipboard", async () => {
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void written.push(text) }, configurable: true });
  const row = renderRow();
  choose(row, "Copy working directory");
  await act(async () => {});
  assert.deepEqual(written, [TERMINAL.project_path]);
});

test("Open folder in Explorer opens the terminal's folder through the opener plugin", async () => {
  const row = renderRow();
  choose(row, "Open folder in Explorer");
  await act(async () => {});
  assert.deepEqual(
    invoked.filter((c) => c.cmd.startsWith("plugin:opener")),
    [{ cmd: "plugin:opener|reveal_item_in_dir", args: { paths: [TERMINAL.project_path] } }]
  );
});

test("Redraw and Find… ask the terminal's own pane, and Find shows the terminal first", () => {
  const heard: string[] = [];
  const stop = [onTerminalRequest("t1", (r) => heard.push(r)), onTerminalRequest("t2", (r) => heard.push(`t2 ${r}`))];
  try {
    const row = renderRow();
    choose(row, "Redraw");
    choose(row, "Find…");
    assert.deepEqual(heard, ["redraw", "find"]);
    assert.deepEqual(calls, ["select"]);
  } finally {
    stop.forEach((s) => s());
  }
});
