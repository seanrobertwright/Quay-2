/**
 * Tells the attention queue that the user sent input to a terminal: keys, paste or mouse. The
 * terminal view reports it, and `useAttentionQueue` listens. Replies xterm writes by itself, such
 * as the focus-in report it sends when the pane gains focus, are not reported, so focusing a
 * terminal never clears its finished turn.
 */
type UserInputListener = (terminalId: string) => void;

const listeners = new Set<UserInputListener>();

/** Reports input the user sent to `terminalId`. */
export function reportUserInput(terminalId: string): void {
  for (const listener of listeners) listener(terminalId);
}

/** Calls `listener` on each input the user sends to a terminal. Returns the unsubscribe. */
export function onUserInput(listener: UserInputListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
