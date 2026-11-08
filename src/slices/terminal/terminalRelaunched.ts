/**
 * Tells listeners, such as the attention queue, that the user relaunched a terminal. The backend
 * sends no event for a relaunch, so the workspace reports it as it asks for one, and
 * `useAttentionQueue` listens: nothing the old launch was waiting on can be answered by the new.
 */
type TerminalRelaunchedListener = (terminalId: string) => void;

const listeners = new Set<TerminalRelaunchedListener>();

/** Reports that `terminalId` is being relaunched. */
export function reportTerminalRelaunched(terminalId: string): void {
  for (const listener of listeners) listener(terminalId);
}

/** Calls `listener` each time a terminal is relaunched. Returns the unsubscribe. */
export function onTerminalRelaunched(listener: TerminalRelaunchedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
