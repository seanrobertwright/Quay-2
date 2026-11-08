// What the terminal body does with the clipboard, its keys and a right-click (#511). Copy and
// Paste each live here once: the keys (`attachTerminalKeys`) and the body menu both call them.
import type { Terminal } from "@xterm/xterm";
import { terminalKeyAction } from "./terminalKeys.ts";

/** What the body's clipboard actions and right-click rule read from xterm, and the textarea its menu gives focus back to. */
export type BodyTerminal = Pick<Terminal, "hasSelection" | "getSelection" | "clearSelection" | "paste" | "selectAll" | "modes" | "textarea">;

/** Copies the selection to the clipboard and clears it. Does nothing when nothing is selected. */
export function copySelection(term: BodyTerminal): void {
  const selection = term.getSelection();
  if (!selection) return;
  navigator.clipboard.writeText(selection).catch((err) => {
    console.error("Failed to copy terminal selection:", err);
  });
  term.clearSelection();
}

/**
 * Pastes the clipboard into the terminal through xterm's own paste, which applies bracketed
 * paste mode and line-ending fixes, so every paste reaches the program the same way.
 */
export function pasteClipboard(term: BodyTerminal): void {
  navigator.clipboard
    .readText()
    .then((text) => {
      if (text) term.paste(text);
    })
    .catch((err) => {
      console.error("Failed to paste into terminal:", err);
    });
}

/**
 * Whether a right-click in the body opens Quay's menu. Once the running program has turned on
 * mouse reporting, a plain right-click is the program's (xterm has already sent it the press),
 * and Shift+right-click, which xterm keeps from the program, opens the menu.
 */
export function rightClickOpensMenu(term: BodyTerminal, e: { shiftKey: boolean }): boolean {
  return term.modes.mouseTrackingMode === "none" || e.shiftKey;
}

/** What the terminal's keys ask of the pane around it. */
export interface TerminalKeyHandlers {
  /** Opens or closes the pane's scrollback search. */
  search: () => void;
  /** Opens the terminal body menu. */
  menu: () => void;
}

/**
 * Gives `term` Quay's copy, paste, search and menu keys (terminalKeys.ts). xterm runs the handler
 * for keydown, keypress and keyup, so an action runs on keydown only while every phase is kept
 * from the shell.
 */
export function attachTerminalKeys(term: Terminal, on: TerminalKeyHandlers): void {
  term.attachCustomKeyEventHandler((e) => {
    const action = terminalKeyAction(e, term.hasSelection());
    if (action === "shell") return true;

    e.preventDefault();
    if (e.type !== "keydown") return false;
    // The pane's window Ctrl+F listener would toggle the search a second time.
    e.stopPropagation();

    // xterm turns Ctrl+V into ^V and cancels it, so no paste event fires; the paste reads the
    // clipboard itself.
    if (action === "copy") copySelection(term);
    else if (action === "paste") pasteClipboard(term);
    else if (action === "search") on.search();
    else on.menu();
    return false;
  });
}
