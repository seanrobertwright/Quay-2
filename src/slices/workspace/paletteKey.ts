/** The parts of a keydown that decide whether it opens the command palette. */
export interface PaletteKeyEvent {
  key: string;
  target: EventTarget | null;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Whether a keydown came from inside a terminal pane: xterm's helper textarea or anything else
 * under its `.xterm` root. Duck-typed so it runs without a DOM in tests.
 */
export function isTerminalTarget(target: EventTarget | null): boolean {
  const el = target as Partial<Pick<Element, "closest">> | null;
  return typeof el?.closest === "function" && el.closest(".xterm") !== null;
}

/**
 * Whether a keydown toggles the command palette. `Ctrl+Shift+P` does from anywhere. `Ctrl+K` does
 * only outside a terminal, so inside one it reaches the shell.
 */
export function opensCommandPalette(e: PaletteKeyEvent): boolean {
  const key = e.key.toLowerCase();
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && key === "p") return true;
  return (e.ctrlKey || e.metaKey) && key === "k" && !isTerminalTarget(e.target);
}
