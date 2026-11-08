// The app-wide right-click policy (#507). WebView2's own menu (Back, Refresh, Save as, Print,
// Inspect) never helps in Quay, and its Refresh reloads the UI mid-session, so one listener on
// the document cancels it.

/**
 * Inputs that take no text. On one of these the native menu is the page's (Back, Refresh, Print),
 * so they don't count as text fields.
 */
const NO_TEXT_INPUTS = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]
  .map((type) => `:not([type="${type}" i])`)
  .join("");

/** Where the native menu's Cut, Copy, Paste, Select all and spelling apply. */
const TEXT_FIELD = `input${NO_TEXT_INPUTS}, textarea, [contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i]`;

/** The element an event target is, or the element a text node sits in. */
function elementOf(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

/**
 * The terminal body: xterm's root. Its hidden textarea only takes keys, so it is no text field,
 * and the native menu never shows there.
 */
const TERMINAL_BODY = ".xterm";

/**
 * Whether a right-click keeps the native menu: in a text field, or, in a dev build, with Shift
 * held, so Inspect stays reachable. Never in the terminal body.
 */
function keepsNativeMenu(e: MouseEvent, dev: boolean): boolean {
  const el = elementOf(e.target);
  if (!el || el.closest(TERMINAL_BODY)) return false;
  if (dev && e.shiftKey) return true;
  return el.closest(TEXT_FIELD) !== null;
}

interface PolicyOptions {
  /** Whether this is a dev build. */
  dev: boolean;
}

/**
 * Cancels the native context menu on `doc`, except where `keepsNativeMenu` says. Returns a
 * function that takes the listener off again.
 */
export function installContextMenuPolicy(doc: Document, { dev }: PolicyOptions): () => void {
  const onContextMenu = (e: MouseEvent) => {
    if (!keepsNativeMenu(e, dev)) e.preventDefault();
  };
  doc.addEventListener("contextmenu", onContextMenu);
  return () => doc.removeEventListener("contextmenu", onContextMenu);
}
