/** A control the operator types or chooses in. */
const FIELD = 'input, textarea, select, [contenteditable="true"]';

/** The hidden field a terminal takes its keys from. */
const TERMINAL_KEYS = ".xterm-helper-textarea";

/**
 * Whether the operator is in a field outside `pane`, such as an agent's question in the companion. A
 * terminal that took the focus then would be typed what was meant for the field. Another terminal
 * is no such field: the focus moves between terminals.
 */
export function isTypingOutside(pane: Element | null): boolean {
  const active = document.activeElement;
  return !!active?.matches(FIELD) && !active.matches(TERMINAL_KEYS) && !pane?.contains(active);
}
