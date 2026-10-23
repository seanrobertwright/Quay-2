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
  };
}

/** A keydown as the window listener sees it, recording whether it was swallowed. */
function keydown(key: string, { ctrlKey = false } = {}) {
  const event = {
    key,
    ctrlKey,
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

test("keys with no pending prefix, and non-chord keys after one, reach the terminal", () => {
  const calls: string[] = [];
  const handle = createCtrlBKeyHandler(createCtrlBPrefix(fakeClock().clock), recordingActions(calls));

  const z = keydown("z");
  assert.equal(handle(z), false);
  assert.equal(z.defaultPrevented || z.propagationStopped, false);

  handle(keydown("b", { ctrlKey: true }));
  const q = keydown("q");
  assert.equal(handle(q), false);
  assert.equal(q.defaultPrevented || q.propagationStopped, false);
  assert.equal(handle(keydown("z")), true, "a non-chord key leaves the prefix pending, as before");
  assert.deepEqual(calls, ["toggleZoom"]);
});
