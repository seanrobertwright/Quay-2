// The terminal menu (#508): one menu for a terminal, opened from its Rail row or its pane
// header. This module only says what the menu offers; each surface binds the actions to the
// handlers its own buttons and shortcuts already use.
//
// An item that never applies to a surface is left out. An item that applies but cannot run now
// is shown disabled, with the reason as its hint.

import type { ContextMenuItem } from "../overlay/ContextMenu.tsx";
import { isAgentRunKind, offersAskToggle, type TerminalInfo } from "./types.ts";

/** What a terminal menu item asks for. */
export type TerminalMenuAction =
  | "rename"
  | "relaunch"
  | "toggleAsk"
  | "showInFocusedPane"
  | "zoomPane"
  | "redraw"
  | "find"
  | "copyWorkingDirectory"
  | "openFolder"
  | "closePane"
  | "closeTerminal";

/** Where the menu opens: a Rail row, or a pane header on a stage showing `paneCount` panes. */
export type TerminalMenuSurface = { kind: "rail" } | { kind: "pane"; paneCount: number };

/** One item of the terminal menu, before its action is bound to a handler. */
export type TerminalMenuEntry = Omit<ContextMenuItem, "onChoose"> & { action: TerminalMenuAction };

/** What the menu reads from the terminal. */
export type TerminalMenuTarget = Pick<TerminalInfo, "name" | "run_kind" | "claude_status" | "live_mode">;

const STILL_RUNNING = "Still running";
const ONLY_ONE_PANE = "Only one pane";

/** The terminal menu for `terminal` on `surface`, in order, its groups kept together. */
export function terminalMenu(terminal: TerminalMenuTarget, surface: TerminalMenuSurface): TerminalMenuEntry[] {
  const onPane = surface.kind === "pane";
  const exited = terminal.claude_status === "exited";
  const severalPanes = surface.kind === "pane" && surface.paneCount > 1;
  const items: (TerminalMenuEntry | null)[] = [
    { action: "rename", name: "Rename…", group: "session", enabled: true },
    { action: "relaunch", name: isAgentRunKind(terminal.run_kind) ? "Relaunch agent" : "Relaunch", group: "session", enabled: exited, hint: exited ? undefined : STILL_RUNNING },
    offersAskToggle(terminal.run_kind)
      ? { action: "toggleAsk", name: "Ask before tool calls", group: "session", enabled: true, checked: terminal.live_mode === "normal" }
      : null,
    onPane ? null : { action: "showInFocusedPane", name: "Show in focused pane", group: "view", enabled: true },
    onPane ? { action: "zoomPane", name: "Zoom pane", group: "view", enabled: true, hint: "Ctrl+Shift+B z" } : null,
    { action: "redraw", name: "Redraw", group: "view", enabled: true, hint: "Ctrl+L", ariaKeyShortcuts: "Control+L" },
    { action: "find", name: "Find…", group: "view", enabled: true, hint: "Ctrl+F", ariaKeyShortcuts: "Control+F" },
    { action: "copyWorkingDirectory", name: "Copy working directory", group: "folder", enabled: true },
    { action: "openFolder", name: "Open folder in Explorer", group: "folder", enabled: true },
    onPane
      ? { action: "closePane", name: "Close pane", group: "close", enabled: severalPanes, hint: severalPanes ? undefined : ONLY_ONE_PANE }
      : null,
    { action: "closeTerminal", name: "Close terminal", group: "close", enabled: true },
  ];
  return items.filter((item) => item !== null);
}

/** What an item of the terminal body's clipboard group asks for; its Find… is the terminal menu's `find`. */
export type ClipboardMenuAction = "copy" | "paste" | "selectAll" | "copyScrollback";

/** One item of the terminal body menu, before its action is bound to a handler. */
export type TerminalBodyMenuEntry = Omit<ContextMenuItem, "onChoose"> & { action: TerminalMenuAction | ClipboardMenuAction };

const NO_SELECTION = "No selection";

/**
 * The menu a right-click in a terminal's body opens, on a stage showing `paneCount` panes: the
 * clipboard group, then the pane's terminal menu. Find… sits in the clipboard group, so the
 * terminal menu below leaves its own out rather than show it twice.
 */
export function terminalBodyMenu(terminal: TerminalMenuTarget, paneCount: number, hasSelection: boolean): TerminalBodyMenuEntry[] {
  const clipboard: TerminalBodyMenuEntry[] = [
    {
      action: "copy",
      name: "Copy",
      group: "clipboard",
      enabled: hasSelection,
      hint: hasSelection ? "Ctrl+C" : NO_SELECTION,
      ariaKeyShortcuts: "Control+C",
    },
    { action: "paste", name: "Paste", group: "clipboard", enabled: true, hint: "Ctrl+V", ariaKeyShortcuts: "Control+V" },
    { action: "selectAll", name: "Select all", group: "clipboard", enabled: true },
    { action: "find", name: "Find…", group: "clipboard", enabled: true, hint: "Ctrl+F", ariaKeyShortcuts: "Control+F" },
    { action: "copyScrollback", name: "Copy scrollback", group: "clipboard", enabled: true },
  ];
  const rest = terminalMenu(terminal, { kind: "pane", paneCount }).filter((item) => item.action !== "find");
  return [...clipboard, ...rest];
}

/** The menu's accessible name, which names the terminal it acts on. */
export function terminalMenuLabel(terminal: Pick<TerminalInfo, "name">): string {
  return `Terminal ${terminal.name}`;
}
