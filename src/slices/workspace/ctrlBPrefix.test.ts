/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCtrlBPrefix, createCtrlBKeyHandler, type CtrlBActions, type PrefixClock } from "./ctrlBPrefix.ts";

/** A clock the test advances by hand, so the 1.5 s prefix window runs instantly. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { due: number; fn: () => void }>();
  const clock: PrefixClock = {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { due: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    clock,
    pendingTimers: () => pending.size,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.due <= now) {
          pending.delete(id);
          timer.fn();
        }
      }
    },
  };
}

/** Records which action each chord ran. */
function recordingActions(calls: string[]): CtrlBActions {
  const record = (name: string) => () => calls.push(name);
  return {
    openNewTerminal: record("openNewTerminal"),
    splitHorizontal: record("splitHorizontal"),
    splitVertical: record("splitVertical"),
    splitGrid: record("splitGrid"),
    openSwarmModal: record("openSwarmModal"),
    openDiffInspector: record("openDiffInspector"),
    openNewWorktreeModal: record("openNewWorktreeModal"),
    toggleGithubDrawer: record("toggleGithubDrawer"),
    openAuditModal: record("openAuditModal"),
    toggleSessionHistory: record("toggleSessionHistory"),
    toggleTokenSpend: record("toggleTokenSpend"),
    toggleArchonGraph: record("toggleArchonGraph"),
    toggleFactoryStation: record("toggleFactoryStation"),
    toggleUpdateModal: record("toggleUpdateModal"),
    openA2A: record("openA2A"),
    focusNextPane: record("focusNextPane"),
    toggleZoom: record("toggleZoom"),
    unsplit: record("unsplit"),
    selectTerminalAt: (index) => calls.push(`selectTerminalAt(${index})`),
    sendPrefixToTerminal: record("sendPrefixToTerminal"),
  };
}

/** A stand-in for the DOM element a keydown comes from; the tests run without a DOM. */
function element(
  tagName: string,
  { className = "", isContentEditable = false, type = undefined as string | undefined } = {}
): EventTarget {
  const classes = className.split(" ").filter(Boolean);
  const el = {
    tagName: tagName.toUpperCase(),
    type,
    isContentEditable,
    classList: { contains: (c: string) => classes.includes(c) },
  };
  return el as unknown as EventTarget;
}

/** The hidden textarea xterm.js focuses to take a pane's keystrokes. */
const xtermTextarea = element("textarea", { className: "xterm-helper-textarea" });

/** A keydown as the window listener sees it, recording whether it was swallowed. */
function keydown(
  key: string,
  { ctrlKey = false, repeat = false, target = xtermTextarea as EventTarget | null } = {}
) {
  const event = {
    key,
    ctrlKey,
    repeat,
    target,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.propagationStopped = true;
    },
  };
  return event;
}

test("Ctrl+B then Z zooms even when Quay re-renders between the two keys", () => {
  const { clock } = fakeClock();
  // The hook keeps one prefix for its whole life; each render's effect builds a fresh handler.
  const prefix = createCtrlBPrefix(clock);
  const firstRenderCalls: string[] = [];
  const firstRender = createCtrlBKeyHandler(prefix, recordingActions(firstRenderCalls));

  assert.equal(firstRender(keydown("b", { ctrlKey: true })), true);

  // Terminal output arrives: the effect is torn down and set up again with new callbacks.
  const secondRenderCalls: string[] = [];
  const secondRender = createCtrlBKeyHandler(prefix, recordingActions(secondRenderCalls));

  const z = keydown("z");
  assert.equal(secondRender(z), true);
  assert.deepEqual(secondRenderCalls, ["toggleZoom"]);
  assert.deepEqual(firstRenderCalls, []);
  assert.equal(z.defaultPrevented, true);
  assert.equal(z.propagationStopped, true);
});

test("the prefix lapses 1.5 s after Ctrl+B, and the next key goes to the terminal", () => {
  const { clock, advance } = fakeClock();
  const prefix = createCtrlBPrefix(clock);
  const calls: string[] = [];
  const handle = createCtrlBKeyHandler(prefix, recordingActions(calls));

  handle(keydown("b", { ctrlKey: true }));
  advance(1499);
  assert.equal(handle(keydown("o")), true, "still inside the window at 1499 ms");

  handle(keydown("b", { ctrlKey: true }));
  advance(1500);
  const z = keydown("z");
  assert.equal(handle(z), false);
  assert.equal(z.defaultPrevented, false);
  assert.equal(z.propagationStopped, false);
  assert.deepEqual(calls, ["focusNextPane"]);
});

test("unmounting clears the pending prefix and its timer", () => {
  const { clock, pendingTimers } = fakeClock();
  const prefix = createCtrlBPrefix(clock);
  const calls: string[] = [];
  const handle = createCtrlBKeyHandler(prefix, recordingActions(calls));

  handle(keydown("b", { ctrlKey: true }));
  assert.equal(pendingTimers(), 1);

  prefix.dispose();
  assert.equal(pendingTimers(), 0);
  assert.equal(handle(keydown("z")), false);
  assert.deepEqual(calls, []);
});

test("every Ctrl+B chord keeps its key and is swallowed", () => {
  // The chord table as it stood in useWorkspace before the prefix moved into this module.
  const chords: [string, string][] = [
    ["n", "openNewTerminal"],
    ["%", "splitHorizontal"],
    ['"', "splitVertical"],
    ["'", "splitVertical"],
    ["g", "splitGrid"],
    ["s", "openSwarmModal"],
    ["d", "openDiffInspector"],
    ["w", "openNewWorktreeModal"],
    ["i", "toggleGithubDrawer"],
    ["a", "openAuditModal"],
    ["h", "toggleSessionHistory"],
    ["t", "toggleTokenSpend"],
    ["$", "toggleTokenSpend"],
    ["r", "toggleArchonGraph"],
    ["f", "toggleFactoryStation"],
    ["u", "toggleUpdateModal"],
    ["m", "openA2A"],
    ["o", "focusNextPane"],
    ["Z", "toggleZoom"],
    ["x", "unsplit"],
    ["1", "selectTerminalAt(0)"],
    ["9", "selectTerminalAt(8)"],
  ];
  for (const [key, action] of chords) {
    const calls: string[] = [];
    const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));
    const prefixKey = keydown("b", { ctrlKey: true });
    handle(prefixKey);
    assert.equal(prefixKey.defaultPrevented && prefixKey.propagationStopped, true, "Ctrl+B is swallowed");

    const chordKey = keydown(key);
    assert.equal(handle(chordKey), true, `Ctrl+B ${key}`);
    assert.deepEqual(calls, [action], `Ctrl+B ${key}`);
    assert.equal(chordKey.defaultPrevented && chordKey.propagationStopped, true, `Ctrl+B ${key} is swallowed`);
    assert.equal(handle(keydown(key)), false, `Ctrl+B ${key} uses up the prefix`);
  }
});

test("keys with no pending prefix reach the terminal", () => {
  const calls: string[] = [];
  const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));

  const z = keydown("z");
  assert.equal(handle(z), false);
  assert.equal(z.defaultPrevented || z.propagationStopped, false);
  assert.deepEqual(calls, []);
});

test("a non-chord key after Ctrl+B ends the prefix and reaches the terminal", () => {
  const calls: string[] = [];
  const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));

  handle(keydown("b", { ctrlKey: true }));
  for (const key of ["q", "z"]) {
    const event = keydown(key);
    assert.equal(handle(event), false, `${key} is left for the terminal`);
    assert.equal(event.defaultPrevented || event.propagationStopped, false, `${key} is not swallowed`);
  }
  assert.deepEqual(calls, []);
});

test("modifier keys keep the prefix pending, so Ctrl+B Shift+5 still splits", () => {
  const calls: string[] = [];
  const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));

  handle(keydown("b", { ctrlKey: true }));
  for (const key of ["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "NumLock", "Fn", "Dead"]) {
    assert.equal(handle(keydown(key)), false, `${key} is left alone`);
  }
  assert.equal(handle(keydown("%")), true);
  assert.deepEqual(calls, ["splitHorizontal"]);
});

test("Ctrl+B Ctrl+B sends one Ctrl+B to the terminal and ends the prefix", () => {
  const calls: string[] = [];
  const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));

  const first = keydown("b", { ctrlKey: true });
  assert.equal(handle(first), true);
  assert.equal(first.defaultPrevented && first.propagationStopped, true, "a single Ctrl+B is swallowed");
  assert.deepEqual(calls, []);

  const second = keydown("b", { ctrlKey: true });
  assert.equal(handle(second), true);
  assert.equal(second.defaultPrevented && second.propagationStopped, true, "xterm must not send a second ^B");
  assert.deepEqual(calls, ["sendPrefixToTerminal"]);

  assert.equal(handle(keydown("z")), false, "the prefix ended");
  assert.deepEqual(calls, ["sendPrefixToTerminal"]);
});

test("holding Ctrl+B never sends a Ctrl+B to the terminal", () => {
  const { clock, advance } = fakeClock();
  const calls: string[] = [];
  const handle = createCtrlBKeyHandler(createCtrlBPrefix(clock), recordingActions(calls));

  assert.equal(handle(keydown("b", { ctrlKey: true })), true);
  for (let i = 0; i < 3; i++) {
    advance(1000);
    const held = keydown("b", { ctrlKey: true, repeat: true });
    assert.equal(handle(held), true);
    assert.equal(held.defaultPrevented && held.propagationStopped, true, "the repeat is swallowed");
  }
  assert.deepEqual(calls, []);
  assert.equal(handle(keydown("z")), true, "each repeat restarted the window");
  assert.deepEqual(calls, ["toggleZoom"]);

  // Held after Ctrl+B Ctrl+B: the repeats do not arm a new prefix.
  handle(keydown("b", { ctrlKey: true }));
  handle(keydown("b", { ctrlKey: true }));
  handle(keydown("b", { ctrlKey: true, repeat: true }));
  assert.equal(handle(keydown("z")), false);
  assert.deepEqual(calls, ["toggleZoom", "sendPrefixToTerminal"]);
});

test("chords still work from inputs that take no typed text", () => {
  for (const type of ["checkbox", "radio", "button", "range"]) {
    const calls: string[] = [];
    const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));
    const target = element("input", { type });

    assert.equal(handle(keydown("b", { ctrlKey: true, target })), true, `Ctrl+B on a ${type}`);
    assert.equal(handle(keydown("z", { target })), true, `Z on a ${type}`);
    assert.deepEqual(calls, ["toggleZoom"], type);
  }
});

test("Ctrl+B in a text field neither arms the prefix nor is swallowed", () => {
  const fields: [string, EventTarget][] = [
    ["input", element("input")],
    ["text input", element("input", { type: "text" })],
    ["search input", element("input", { type: "search" })],
    ["textarea", element("textarea")],
    ["select", element("select")],
    ["contenteditable", element("div", { isContentEditable: true })],
  ];
  for (const [name, target] of fields) {
    const calls: string[] = [];
    const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));

    const ctrlB = keydown("b", { ctrlKey: true, target });
    assert.equal(handle(ctrlB), false, `Ctrl+B in ${name}`);
    assert.equal(ctrlB.defaultPrevented || ctrlB.propagationStopped, false, `Ctrl+B in ${name} is not swallowed`);
    assert.equal(handle(keydown("n", { target })), false, `N in ${name} is typed, not a chord`);
    assert.equal(handle(keydown("n")), false, `Ctrl+B in ${name} left no prefix behind`);
    assert.deepEqual(calls, [], name);
  }
});

test("a key typed into a text field ends a prefix armed in the terminal", () => {
  const calls: string[] = [];
  const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));

  handle(keydown("b", { ctrlKey: true }));
  assert.equal(handle(keydown("n", { target: element("input") })), false);
  assert.equal(handle(keydown("n")), false, "the prefix ended");
  assert.deepEqual(calls, []);
});

test("Ctrl+B from xterm's helper textarea, or from no element, arms the prefix", () => {
  for (const target of [xtermTextarea, null]) {
    const calls: string[] = [];
    const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));

    assert.equal(handle(keydown("b", { ctrlKey: true, target })), true);
    assert.equal(handle(keydown("n", { target })), true);
    assert.deepEqual(calls, ["openNewTerminal"]);
  }
});
