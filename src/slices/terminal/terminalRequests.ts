// Asking a terminal's pane to run one of its own actions from elsewhere (#508): the terminal
// menu on a Rail row redraws the screen or opens the scrollback search of a pane it isn't in.
// The pane runs the same `repaintTerminal` and search toggle as its header buttons.

/** What a pane can be asked to do. */
export type TerminalRequest = "redraw" | "find";

const EVENT = "quay:terminal-request";

interface RequestDetail {
  terminalId: string;
  request: TerminalRequest;
}

/** Asks the pane of terminal `terminalId` to run `request`. */
export function requestTerminal(terminalId: string, request: TerminalRequest): void {
  window.dispatchEvent(new CustomEvent<RequestDetail>(EVENT, { detail: { terminalId, request } }));
}

/** Calls `handler` with each request made of terminal `terminalId`. Returns a function that stops it. */
export function onTerminalRequest(terminalId: string, handler: (request: TerminalRequest) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<RequestDetail>).detail;
    if (detail?.terminalId === terminalId) handler(detail.request);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
