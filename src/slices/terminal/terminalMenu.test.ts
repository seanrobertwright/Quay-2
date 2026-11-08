/// <reference types="node" />
// The terminal menu's items (#508), from the pure item builder: which items each surface shows,
// in what order and groups, which are disabled and why, and the hints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shownMenu as shown } from "../../test-support/menuEntries.ts";
import { terminalBodyMenu, terminalMenu, terminalMenuLabel, type TerminalMenuTarget } from "./terminalMenu.ts";

const claude: TerminalMenuTarget = { name: "claude-1", run_kind: "claude", claude_status: "working", live_mode: "skip" };

test("a running agent's Rail row menu lists the terminal items in their groups, without the pane-only ones", () => {
  assert.deepEqual(shown(terminalMenu(claude, { kind: "rail" })), [
    "Rename…",
    "Relaunch agent (disabled: Still running)",
    "[ ] Ask before tool calls",
    "---",
    "Show in focused pane",
    "Redraw [Ctrl+L]",
    "Find… [Ctrl+F]",
    "---",
    "Copy working directory",
    "Open folder in Explorer",
    "---",
    "Close terminal",
  ]);
});

test("a pane header's menu swaps Show in focused pane for Zoom pane, and adds Close pane", () => {
  assert.deepEqual(shown(terminalMenu(claude, { kind: "pane", paneCount: 2 })), [
    "Rename…",
    "Relaunch agent (disabled: Still running)",
    "[ ] Ask before tool calls",
    "---",
    "Zoom pane [Ctrl+Shift+B z]",
    "Redraw [Ctrl+L]",
    "Find… [Ctrl+F]",
    "---",
    "Copy working directory",
    "Open folder in Explorer",
    "---",
    "Close pane",
    "Close terminal",
  ]);
});

test("Close pane is disabled with its reason when the stage shows one pane", () => {
  const closePane = terminalMenu(claude, { kind: "pane", paneCount: 1 }).find((i) => i.action === "closePane");
  assert.deepEqual(closePane && { enabled: closePane.enabled, hint: closePane.hint }, { enabled: false, hint: "Only one pane" });
});

test("Relaunch agent runs once the agent has exited", () => {
  const relaunch = terminalMenu({ ...claude, claude_status: "exited" }, { kind: "rail" }).find((i) => i.action === "relaunch");
  assert.deepEqual(relaunch && { enabled: relaunch.enabled, hint: relaunch.hint }, { enabled: true, hint: undefined });
});

test("the relaunch item names the agent only on an agent terminal, and reads Relaunch on a plain shell", () => {
  const relaunchName = (run_kind: TerminalMenuTarget["run_kind"]) =>
    terminalMenu({ ...claude, run_kind }, { kind: "rail" }).find((i) => i.action === "relaunch")?.name;
  assert.equal(relaunchName("claude"), "Relaunch agent");
  assert.equal(relaunchName("archon"), "Relaunch agent");
  assert.equal(relaunchName("powershell"), "Relaunch");
  assert.equal(relaunchName("command"), "Relaunch");
});

test("the Ask toggle is checked while the terminal asks before tool calls, and clear in Skip", () => {
  const ask = (live_mode: TerminalMenuTarget["live_mode"]) =>
    terminalMenu({ ...claude, live_mode }, { kind: "rail" }).find((i) => i.action === "toggleAsk")?.checked;
  assert.equal(ask("normal"), true);
  assert.equal(ask("skip"), false);
});

test("pi and PiG, which never ask before tool calls, get no Ask toggle, nor does a plain shell", () => {
  const names = (run_kind: TerminalMenuTarget["run_kind"]) => terminalMenu({ ...claude, run_kind }, { kind: "rail" }).map((i) => i.name);
  for (const kind of ["pi", "pig", "powershell", "command"] as const) {
    assert.ok(!names(kind).includes("Ask before tool calls"), kind);
  }
  for (const kind of ["claude", "codex", "opencode", "gemini"] as const) {
    assert.ok(names(kind).includes("Ask before tool calls"), kind);
  }
});

test("the menu's accessible name names the terminal", () => {
  assert.equal(terminalMenuLabel({ name: "claude-1" }), "Terminal claude-1");
});

test("the terminal body menu puts the clipboard group above the pane's terminal menu, with Find… once", () => {
  assert.deepEqual(shown(terminalBodyMenu(claude, 2, true)), [
    "Copy [Ctrl+C]",
    "Paste [Ctrl+V]",
    "Select all",
    "Find… [Ctrl+F]",
    "Copy scrollback",
    "---",
    "Rename…",
    "Relaunch agent (disabled: Still running)",
    "[ ] Ask before tool calls",
    "---",
    "Zoom pane [Ctrl+Shift+B z]",
    "Redraw [Ctrl+L]",
    "---",
    "Copy working directory",
    "Open folder in Explorer",
    "---",
    "Close pane",
    "Close terminal",
  ]);
});

test("Copy is disabled with its reason when nothing is selected, and the rest of the clipboard group still runs", () => {
  assert.deepEqual(shown(terminalBodyMenu(claude, 1, false).filter((i) => i.group === "clipboard")), [
    "Copy (disabled: No selection)",
    "Paste [Ctrl+V]",
    "Select all",
    "Find… [Ctrl+F]",
    "Copy scrollback",
  ]);
});
