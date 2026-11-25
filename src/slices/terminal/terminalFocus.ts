import { isOverlayOpen } from "../overlay/useOverlay.ts";

/** A control the operator types or chooses in. */
const FIELD = 'input, textarea, select, [contenteditable="true"]';

/** The hidden field a terminal takes its keys from. */
const TERMINAL_KEYS = ".xterm-helper-textarea";

/** An agent's surface in the stage tab in front. One behind is hidden, and nothing in it has the focus. */
const SURFACE_IN_FRONT = "[data-stage-tool-panel] [data-surface]";

/** The pane a terminal's element is in. */
export const paneOf = (element: Element | null | undefined) => element?.closest("[data-terminal-pane]") ?? null;

/**
 * Whether the operator is in a field outside `pane`, such as an agent's question in the companion, or
 * anywhere in a surface whose stage tab is in front of the panes. A terminal that took the focus then
 * would be typed what was meant for the field or the surface. Another terminal is no such field: the
 * focus moves between terminals.
 */
export function isTypingOutside(pane: Element | null): boolean {
  const active = document.activeElement;
  if (active?.closest(SURFACE_IN_FRONT)) return true;
  return !!active?.matches(FIELD) && !active.matches(TERMINAL_KEYS) && !pane?.contains(active);
}

/** The field that terminal `terminalId` takes its keys from, when its pane is in `root`. */
export function terminalKeysOf(root: Element, terminalId: string | null): HTMLElement | null {
  const pane = [...root.querySelectorAll<HTMLElement>("[data-pie-terminal]")].find((one) => one.dataset.pieTerminal === terminalId);
  return pane?.querySelector<HTMLElement>(TERMINAL_KEYS) ?? null;
}

/** What of an xterm terminal its focus needs. */
interface FocusableTerminal {
  readonly element?: HTMLElement;
  readonly textarea?: HTMLTextAreaElement;
  focus(): void;
}

/**
 * Focuses a terminal unless an overlay is open or the operator is in a field outside its pane: these
 * focus calls run on timers and output events, and would otherwise pull the focus out from under what
 * the operator has gone to in the meantime.
 */
export function focusXterm(term: FocusableTerminal): void {
  if (isOverlayOpen() || isTypingOutside(paneOf(term.element))) return;
  try {
    term.focus();
    term.textarea?.focus({ preventScroll: true });
  } catch (_) {}
}
