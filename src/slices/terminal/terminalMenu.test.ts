/// <reference types="node" />
// The terminal menu's items (#508), from the pure item builder: which items each surface shows,
// in what order and groups, which are disabled and why, and the hints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { terminalMenu, terminalMenuLabel, type TerminalMenuEntry, type TerminalMenuTarget } from "./terminalMenu.ts";

const claude: TerminalMenuTarget = { name: "claude-1", run_kind: "claude", claude_status: "working", live_mode: "skip" };

/** Each item as `name`, `name [hint]`, `name (disabled: why)` or `[x] name`, with `---` between groups. */
function shown(items: TerminalMenuEntry[]): string[] {
  const out: string[] = [];
  items.forEach((item, i) => {
    if (i > 0 && items[i - 1].group !== item.group) out.push("---");
    const box = item.checked === undefined ? "" : item.checked ? "[x] " : "[ ] ";
    const tail = !item.enabled ? ` (disabled: ${item.hint})` : item.hint ? ` [${item.hint}]` : "";
    out.push(`${box}${item.name}${tail}`);
  });
  return out;
}

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
