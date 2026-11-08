/// <reference types="node" />
// The terminal body's clipboard (#511): a real xterm terminal in happy-dom, with only the
// clipboard faked. Its keys and its menu are two ways into one copy path and one paste path, so
// each check runs both ways and expects the same thing.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { TerminalInfo } from "./types.ts";

// xterm ships one CommonJS bundle, whose names Node's ESM loader can't see.
const { Terminal } = ((await import("@xterm/xterm")) as unknown as { default: typeof import("@xterm/xterm") }).default;
const { attachTerminalKeys, rightClickOpensMenu } = await import("./terminalBody.ts");
const { TerminalBodyMenu } = await import("./TerminalMenu.tsx");

const TERMINAL: TerminalInfo = {
  id: "t1",
  name: "claude-1",
  project_path: "C:\\src\\repo",
  run_kind: "claude",
  permission_mode: "skip",
  live_mode: "skip",
  claude_status: "working",
  auto_approved_count: 0,
};

let terms: XTerm[] = [];
let mounted: Root | null = null;
/** What reached the clipboard, and what the clipboard holds for a paste. */
let clipboard: { written: string[]; holds: string };
/** What the terminal sent to the shell. */
let sent: string[];
/** What the terminal's key handlers were asked to do. */
let asked: string[];

beforeEach(() => {
  fakeInvoke(async () => null);
  clipboard = { written: [], holds: "" };
  sent = [];
  asked = [];
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (text: string) => void clipboard.written.push(text),
      readText: async () => clipboard.holds,
    },
    configurable: true,
  });
});
afterEach(() => {
  if (mounted) act(() => mounted?.unmount());
  mounted = null;
  for (const term of terms) term.dispose();
  terms = [];
  document.body.innerHTML = "";
});

/** An open terminal showing `text`, with Quay's keys attached. */
async function openTerminal(text: string): Promise<XTerm> {
  const term = new Terminal({ allowProposedApi: true });
  terms.push(term);
  const el = document.createElement("div");
  document.body.append(el);
  term.open(el);
  term.onData((data) => sent.push(data));
  attachTerminalKeys(term, { search: () => asked.push("search"), menu: () => asked.push("menu") });
  await new Promise<void>((done) => term.write(text, done));
  return term;
}

/** The key codes xterm reads to turn a key into what it sends. */
const KEY_CODES: Record<string, number> = { c: 67, v: 86, f: 70, F10: 121, ContextMenu: 93 };

function press(term: XTerm, key: string, init: KeyboardEventInit = {}) {
  const keyCode = KEY_CODES[key];
  term.textarea!.dispatchEvent(new KeyboardEvent("keydown", { key, keyCode, which: keyCode, bubbles: true, cancelable: true, ...init }));
}

/** Lets the clipboard's promises settle. */
const settle = () => act(async () => {});

test("Ctrl+C with a selection copies it and clears it, and sends nothing to the shell", async () => {
  const term = await openTerminal("hello world");
  term.select(0, 0, 5);
  press(term, "c", { ctrlKey: true });
  await settle();
  assert.deepEqual(clipboard.written, ["hello"]);
  assert.equal(term.hasSelection(), false);
  assert.deepEqual(sent, []);
});

/** Opens the body menu for `term` and chooses the item named `name`. */
function chooseFromMenu(term: XTerm, name: string) {
  const container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() =>
    mounted!.render(
      createElement(TerminalBodyMenu, {
        terminal: TERMINAL,
        paneCount: 1,
        term,
        scrollback: () => "the whole scrollback",
        at: { x: 10, y: 10 },
        onClose: () => asked.push("close"),
        handlers: { find: () => asked.push("find") },
      })
    )
  );
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) => el.textContent?.startsWith(name));
  assert.ok(item, `no item ${name}`);
  act(() => item.click());
}

test("Ctrl+C with nothing selected still sends ^C to the shell", async () => {
  const term = await openTerminal("hello world");
  press(term, "c", { ctrlKey: true });
  await settle();
  assert.deepEqual(sent, [""]);
  assert.deepEqual(clipboard.written, []);
});

test("the menu's Copy copies the selection and clears it, as Ctrl+C does", async () => {
  const term = await openTerminal("hello world");
  term.select(6, 0, 5);
  chooseFromMenu(term, "Copy");
  await settle();
  assert.deepEqual(clipboard.written, ["world"]);
  assert.equal(term.hasSelection(), false);
  assert.deepEqual(sent, []);
});

// With bracketed paste on, xterm wraps a paste in ESC[200~ … ESC[201~ and sends its line feeds as
// carriage returns, as a terminal does.
const BRACKETED = "\x1b[?2004h";

test("Ctrl+V pastes the clipboard through xterm's paste, bracketed and with Enter for each line feed", async () => {
  const term = await openTerminal(BRACKETED);
  clipboard.holds = "echo one\necho two";
  press(term, "v", { ctrlKey: true });
  await settle();
  assert.deepEqual(sent, ["\x1b[200~echo one\recho two\x1b[201~"]);
});

test("the menu's Paste pastes exactly as Ctrl+V does", async () => {
  const term = await openTerminal(BRACKETED);
  clipboard.holds = "echo one\necho two";
  chooseFromMenu(term, "Paste");
  await settle();
  assert.deepEqual(sent, ["\x1b[200~echo one\recho two\x1b[201~"]);
});

test("Select all selects the whole buffer", async () => {
  const term = await openTerminal("first line\r\nsecond line");
  chooseFromMenu(term, "Select all");
  assert.match(term.getSelection(), /^first line\r?\nsecond line/);
});

test("Copy scrollback copies the whole scrollback, and Find… opens the pane's search", async () => {
  const term = await openTerminal("hello");
  chooseFromMenu(term, "Copy scrollback");
  await settle();
  assert.deepEqual(clipboard.written, ["the whole scrollback"]);
  act(() => mounted?.unmount());
  chooseFromMenu(term, "Find…");
  assert.deepEqual(asked, ["close", "close", "find"]);
});

test("Ctrl+F asks for the pane's search, and Shift+F10 and the Menu key for the menu, with nothing sent to the shell", async () => {
  const term = await openTerminal("hello");
  press(term, "f", { ctrlKey: true });
  press(term, "F10", { shiftKey: true });
  press(term, "ContextMenu");
  assert.deepEqual(asked, ["search", "menu", "menu"]);
  assert.deepEqual(sent, []);
});

test("a right-click opens the menu unless the program has turned on mouse reporting, when only Shift+right-click does", async () => {
  const term = await openTerminal("hello");
  assert.equal(rightClickOpensMenu(term, { shiftKey: false }), true, "reporting off");
  assert.equal(rightClickOpensMenu(term, { shiftKey: true }), true, "reporting off, with Shift");
  // ESC[?1000h asks for button presses, ESC[?1003h for every motion as well.
  for (const on of ["[?1000h", "[?1003h"]) {
    await new Promise<void>((done) => term.write(on, done));
    assert.equal(rightClickOpensMenu(term, { shiftKey: false }), false, `${JSON.stringify(on)}: the program has the click`);
    assert.equal(rightClickOpensMenu(term, { shiftKey: true }), true, `${JSON.stringify(on)}: Shift+right-click`);
  }
  await new Promise<void>((done) => term.write("[?1003l[?1000l", done));
  assert.equal(rightClickOpensMenu(term, { shiftKey: false }), true, "reporting off again");
});
