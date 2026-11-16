// Asking a terminal's pane or Projects panel row to run one of its own actions from elsewhere
// (#508, #648): the terminal menu on a Projects panel row redraws the screen or opens the
// scrollback search of a pane it isn't in, and the pie's Rename opens the inline rename box of
// the pane header or row it was stroked over. Each runs the same action as its own buttons.

/** What a pane or row can be asked to do. */
export type TerminalRequest = "redraw" | "find" | "rename";

/** Where a request is for: the terminal's pane on the stage, or its Projects panel row. */
export type TerminalPlace = "pane" | "row";

const EVENT = "quay:terminal-request";

interface RequestDetail {
  terminalId: string;
  request: TerminalRequest;
  place: TerminalPlace;
}

/**
 * Asks terminal `terminalId`'s pane, or its row with `place` "row", to run `request`. Says whether
 * one took it; a row is not drawn while its project is collapsed or the Projects panel was never opened.
 */
export function requestTerminal(terminalId: string, request: TerminalRequest, place: TerminalPlace = "pane"): boolean {
  const event = new CustomEvent<RequestDetail>(EVENT, { detail: { terminalId, request, place }, cancelable: true });
  return !window.dispatchEvent(event);
}

/**
 * Calls `handler` with each request made of terminal `terminalId` at `place`. Returns a function
 * that stops it.
 */
export function onTerminalRequest(
  terminalId: string,
  handler: (request: TerminalRequest) => void,
  place: TerminalPlace = "pane"
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<RequestDetail>).detail;
    if (detail?.terminalId !== terminalId || detail.place !== place) return;
    // Cancelling the event is how the sender learns it was taken.
    e.preventDefault();
    handler(detail.request);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/**
 * Asks the pane of terminal `terminalId` to take keyboard focus, through the
 * `quay:focus-terminal` event each pane listens for.
 */
export function focusTerminal(terminalId: string): void {
  window.dispatchEvent(new CustomEvent("quay:focus-terminal", { detail: { terminalId } }));
}
