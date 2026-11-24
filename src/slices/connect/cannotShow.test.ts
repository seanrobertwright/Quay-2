/// <reference types="node" />
// The mark on a terminal that can't show surfaces (#733): the button in its pane's title, when it is
// there, and what it says, with Rust faked at Tauri's `invoke` and its events.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RunKind } from "../terminal/types.ts";
import type { AntigravityConnection, ConnectState } from "./connectTypes.ts";

const { CannotShowMark } = await import("./CannotShowMark.tsx");
const { forgetAntigravity, onConnectRowAsked } = await import("./antigravity.ts");

const NAME = "Why this terminal can't show surfaces";

/** When each terminal's launch began, on the faked clock, whether it has shaken hands, and who was asked about. */
let clock = 0;
let launches: Record<string, { began: number; seen: boolean } | undefined> = {};
let asked: string[] = [];

const GRACE = 60_000;

function handshakeOf(terminalId: string) {
  const launch = launches[terminalId];
  return launch ? { seen: launch.seen, grace_left_ms: Math.max(0, launch.began + GRACE - clock) } : null;
}

let mounted: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => {
  clock = 0;
  launches = { a: { began: 0, seen: false } };
  asked = [];
  window.localStorage.clear();
  forgetAntigravity();
  mock.timers.enable({ apis: ["setTimeout"] });
  fakeInvoke(async (cmd, args) => {
    if (cmd !== "terminal_handshake") throw new Error(`no fake for ${cmd}`);
    asked.push(String(args.terminalId));
    return handshakeOf(String(args.terminalId));
  });
});

afterEach(() => {
  for (const { root, container } of mounted) {
    act(() => root.unmount());
    container.remove();
  }
  mounted = [];
  mock.timers.reset();
});

async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(node));
  return { container, rerender: (next: ReactNode) => act(async () => root.render(next)), unmount: () => act(async () => root.unmount()) };
}

const mark = (kind: RunKind = "claude", terminalId = "a") => createElement(CannotShowMark, { terminalId, kind });
const button = (container: HTMLElement) => container.querySelector<HTMLButtonElement>(`button[aria-label="${NAME}"]`);
const shown = (container: HTMLElement) => button(container) !== null;

/** Lets `ms` pass, in Quay and in the window. */
const pass = (ms: number) =>
  act(async () => {
    clock += ms;
    mock.timers.tick(ms);
  });

test("the mark shows once the grace of the terminal's launch is over, and not before", async () => {
  const { container } = await render(mark());
  assert.equal(shown(container), false);

  await pass(GRACE - 1);
  assert.equal(shown(container), false);

  await pass(1);
  assert.equal(shown(container), true);
});

const tellOf = (terminalId: string) => act(async () => emitEvent("terminal-handshake", { terminal_id: terminalId }));

test("a handshake within the grace keeps the mark away, and one after it takes the mark away", async () => {
  const { container } = await render(mark());
  await pass(GRACE / 2);
  launches.a = { began: 0, seen: true };
  await tellOf("a");
  await pass(GRACE);
  assert.equal(shown(container), false);

  launches.b = { began: 0, seen: false };
  const other = await render(mark("claude", "b"));
  assert.equal(shown(other.container), true, "its grace was over before its pane was drawn");
  launches.b = { began: 0, seen: true };
  await tellOf("b");
  assert.equal(shown(other.container), false);
});

test("a relaunch takes the mark away and has a grace of its own", async () => {
  const { container } = await render(mark());
  await pass(GRACE);
  assert.equal(shown(container), true);

  launches.a = { began: clock, seen: false };
  await tellOf("a");
  assert.equal(shown(container), false);
  await pass(GRACE - 1);
  assert.equal(shown(container), false);
  await pass(1);
  assert.equal(shown(container), true);
});

test("a relaunch in the grace starts it again, and the old launch's timer is cleared", async () => {
  const { container } = await render(mark());
  await pass(GRACE - 10);
  launches.a = { began: clock, seen: false };
  await tellOf("a");
  const before = asked.length;

  await pass(GRACE - 1);
  assert.equal(shown(container), false);
  assert.equal(asked.length, before, "only the new launch's timer is running");
  await pass(1);
  assert.equal(shown(container), true);
});

test("a terminal's exit or another's handshake leaves nothing to show and nothing running", async () => {
  const { container } = await render(mark());
  launches.b = { began: 0, seen: true };
  const before = asked.length;
  await tellOf("b");
  assert.equal(asked.length, before);
  await pass(GRACE);
  assert.equal(shown(container), true);

  launches.a = undefined;
  await tellOf("a");
  assert.equal(shown(container), false);
  const after = asked.length;
  await pass(GRACE * 2);
  assert.equal(asked.length, after);
});

test("a pane that is taken away leaves no timer and hears nothing", async () => {
  const { unmount } = await render(mark());
  await unmount();
  const before = asked.length;

  await pass(GRACE * 2);
  await tellOf("a");

  assert.equal(asked.length, before);
});

test("an answer that comes after a newer one is not used, and neither is another terminal's", async () => {
  const replies: ((handshake: unknown) => void)[] = [];
  fakeInvoke(() => new Promise((resolve) => replies.push(resolve)));
  const { container, rerender } = await render(mark());
  await tellOf("a");
  assert.equal(replies.length, 2);

  await act(async () => replies[1]({ seen: true, grace_left_ms: 0 }));
  await act(async () => replies[0]({ seen: false, grace_left_ms: 0 }));
  assert.equal(shown(container), false);

  await tellOf("a");
  await rerender(mark("claude", "b"));
  await act(async () => replies[2]({ seen: false, grace_left_ms: 0 }));
  assert.equal(shown(container), false);

  await act(async () => replies[3]({ seen: false, grace_left_ms: 0 }));
  assert.equal(shown(container), true);
  await rerender(mark("claude", "c"));
  assert.equal(shown(container), false, "nothing is known of it yet");
});

test("a handshake that can't be read shows nothing, and is said in the log", async () => {
  const warned = mock.method(console, "warn", () => {});
  fakeInvoke(() => Promise.reject(new Error("no")));
  const { container } = await render(mark());
  await pass(GRACE);

  assert.equal(shown(container), false);
  assert.equal(warned.mock.callCount(), 1);
  warned.mock.restore();
});

test("a shell, a command and an Archon workflow never have the mark, and nothing is asked of them", async () => {
  for (const kind of ["powershell", "command", "archon"] as const) {
    const { container } = await render(mark(kind));
    await pass(GRACE * 2);
    assert.equal(container.innerHTML, "", kind);
  }
  assert.deepEqual(asked, []);
});

const panel = () => document.querySelector<HTMLElement>('[role="dialog"]');
const words = () => panel()?.textContent ?? "";

/** The mark of a terminal whose grace is over, opened. */
async function opened(kind: RunKind) {
  clock = GRACE;
  const view = await render(mark(kind));
  await act(async () => button(view.container)?.click());
  return view;
}

test("the mark says why, by CLI, with the remedy", async () => {
  const cases: [RunKind, RegExp][] = [
    ["aider", /^Aider has no tool channel.*Claude Code, Codex, OpenCode, PiG and Antigravity/],
    ["copilot", /^Copilot can't show surfaces in this release.*Claude Code, Codex, OpenCode, PiG and Antigravity/],
    ["pi", /^Pi can't show surfaces in this release/],
    ["gemini", /^Gemini can't show surfaces in this release/],
    ["grok", /^Grok can't show surfaces in this release/],
    ["kiro", /^Kiro can't show surfaces in this release/],
    ["claude", /^Quay has not seen Claude Code connect/],
    ["codex", /^Quay has not seen Codex connect/],
    ["opencode", /^Quay has not seen OpenCode connect/],
    ["pig", /^Quay has not seen PiG connect/],
  ];
  for (const [kind, expected] of cases) {
    const { container, unmount } = await opened(kind);
    assert.match(words(), expected, kind);
    assert.equal(panel()?.querySelector("button") === null, true, `${kind} has no link`);
    assert.equal(shown(container), true);
    await unmount();
  }
});

/** Has `antigravity_connection` say that Antigravity's entry is in `state`, and counts the reads. */
function antigravityIs(state: ConnectState) {
  const found = state === "missing" || state === "unreadable" ? null : "{}";
  const connection: AntigravityConnection = { file: "mcp_config.json", entry: "{}", state, found, problem: null };
  const reads = { count: 0 };
  fakeInvoke(async (cmd, args) => {
    if (cmd === "terminal_handshake") return handshakeOf(String(args.terminalId));
    if (cmd !== "antigravity_connection") throw new Error(`no fake for ${cmd}`);
    reads.count += 1;
    return connection;
  });
  return reads;
}

test("an Antigravity terminal that is not connected has a link, which opens the Connect row and closes the panel", async () => {
  antigravityIs("missing");
  let rowAsked = 0;
  const stop = onConnectRowAsked(() => void (rowAsked += 1));
  await opened("antigravity");
  assert.match(words(), /^Antigravity is not connected to Quay/);

  const link = panel()?.querySelector("button");
  assert.equal(link?.textContent, "Connect Antigravity in Settings");
  await act(async () => link?.click());
  stop();

  assert.equal(rowAsked, 1);
  assert.equal(panel() === null, true);
});

test("what is wrong with Antigravity's entry is read as the mark is opened", async () => {
  const cases: [ConnectState, RegExp, boolean][] = [
    ["unreadable", /configuration file can't be used/, true],
    ["old_relay", /old relay/, true],
    ["changed", /not the one Quay writes/, true],
    ["connected", /^Quay has not seen Antigravity connect/, false],
  ];
  for (const [state, expected, linked] of cases) {
    const reads = antigravityIs(state);
    clock = GRACE;
    const { container, unmount } = await render(mark("antigravity"));
    assert.equal(reads.count, 0);

    await act(async () => button(container)?.click());

    assert.equal(reads.count, 1);
    assert.match(words(), expected, state);
    assert.equal(panel()?.querySelector("button") !== null, linked, state);
    await unmount();
  }
});

const press = (key: string) =>
  act(async () => void document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const hasFocus = (element: Element | null | undefined) => !!element && document.activeElement === element;

test("it works by keyboard: the panel takes focus, Tab reaches the link, and Tab from there or Escape gives focus back", async () => {
  antigravityIs("missing");
  const { container } = await opened("antigravity");
  assert.equal(button(container)?.getAttribute("aria-expanded"), "true");
  assert.equal(button(container)?.getAttribute("aria-controls"), panel()?.id);
  assert.equal(hasFocus(panel()), true);

  await press("Tab");
  assert.equal(hasFocus(panel()?.querySelector("button")), true);
  await press("Tab");
  assert.equal(panel() === null, true);
  assert.equal(hasFocus(button(container)), true);
  assert.equal(button(container)?.getAttribute("aria-expanded"), "false");
  assert.equal(button(container)?.hasAttribute("aria-controls"), false);

  await act(async () => button(container)?.click());
  await press("Escape");
  assert.equal(panel() === null, true);
  assert.equal(hasFocus(button(container)), true);
});

test("a press outside the panel closes it, and one on the panel does not", async () => {
  const { container } = await opened("aider");
  const pressOn = (element: Element | null) => act(async () => void element?.dispatchEvent(new Event("pointerdown", { bubbles: true })));

  await pressOn(panel());
  assert.equal(panel() !== null, true);

  // The button's own press closes it too, and does not open it again
  await pressOn(button(container));
  await act(async () => button(container)?.click());
  assert.equal(panel() === null, true);

  await act(async () => button(container)?.click());
  assert.equal(panel() !== null, true);
  await pressOn(document.body);
  assert.equal(panel() === null, true);
});

test("the panel closes when focus goes elsewhere", async () => {
  await opened("aider");
  const field = document.createElement("input");
  document.body.append(field);

  await act(async () => field.focus());

  assert.equal(panel() === null, true);
  assert.equal(hasFocus(field), true);
  field.remove();
});

test("the panel goes with the handshake, and focus that was in it goes to the terminal", async () => {
  const focused: string[] = [];
  const onFocusAsked = (event: Event) => focused.push((event as CustomEvent<{ terminalId: string }>).detail.terminalId);
  window.addEventListener("quay:focus-terminal", onFocusAsked);
  const { container } = await opened("claude");

  launches.a = { began: 0, seen: true };
  await tellOf("a");
  assert.equal(panel() === null && !shown(container), true);
  assert.deepEqual(focused, ["a"]);

  // Another launch without a handshake: the panel does not open by itself
  launches.a = { began: 0, seen: false };
  await tellOf("a");
  assert.equal(shown(container) && panel() === null, true);
  launches.a = { began: 0, seen: true };
  await tellOf("a");
  window.removeEventListener("quay:focus-terminal", onFocusAsked);
  assert.deepEqual(focused, ["a"], "focus was elsewhere");
});

test("a click on the mark or in its panel is not the pane's, which would take focus to the terminal", async () => {
  let clicks = 0;
  clock = GRACE;
  const { container } = await render(createElement("div", { onClick: () => void (clicks += 1) }, mark("aider")));

  await act(async () => button(container)?.click());
  await act(async () => panel()?.querySelector("p")?.click());

  assert.equal(panel() !== null, true);
  assert.equal(clicks, 0);
  assert.equal(button(container)?.closest("[data-no-terminal-focus]") !== null, true);
  assert.equal(panel()?.closest("[data-no-terminal-focus]") !== null, true);
});
