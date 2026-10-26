/** The modifier and key parts of a keyboard event that decide what a terminal does with it. */
export interface TerminalKey {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * What a key pressed in a terminal pane does.
 *
 * - `copy`: copy the selection to the clipboard.
 * - `paste`: paste the clipboard into the shell.
 * - `search`: open or close the pane's scrollback search.
 * - `shell`: let xterm send the key to the shell as usual.
 */
export type TerminalKeyAction = "copy" | "paste" | "search" | "shell";

/**
 * Routes a key pressed in a terminal pane. `Ctrl+C` copies when there is a selection and otherwise
 * sends `^C`; `Ctrl+V` pastes; `Ctrl+Shift+C` and `Ctrl+Shift+V` always copy and paste; `Ctrl+F`
 * searches. Every other key, `Ctrl+A`, `Ctrl+B`, `Ctrl+K` and `Ctrl+X` among them, goes to the shell.
 */
export function terminalKeyAction(e: TerminalKey, hasSelection: boolean): TerminalKeyAction {
  // Alt with Ctrl is AltGr on Windows, which types a character rather than a shortcut.
  if (!e.ctrlKey || e.altKey || e.metaKey) return "shell";
  switch (e.key.toLowerCase()) {
    case "c":
      return e.shiftKey || hasSelection ? "copy" : "shell";
    case "v":
      return "paste";
    case "f":
      return "search";
    default:
      return "shell";
  }
}
