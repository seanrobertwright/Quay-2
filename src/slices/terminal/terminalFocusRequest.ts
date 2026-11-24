// Asking the app to select a terminal from elsewhere (#726), as a button in an agent's surface does. The
// asker names it by what its agent wrote, and only a terminal of the asker's own project is selected.
import { isSamePath } from "../../utils/paths.ts";
import type { TerminalInfo } from "./types.ts";

export interface TerminalFocusRequest {
  /** The terminal whose project the other is to be in. */
  fromTerminalId: string;
  /** The other's id, or its exact name. */
  target: string;
}

/** What came of a request: the terminal was selected, the asker's is gone, or its project has none or more than one by that name. */
export type TerminalFocusOutcome = { kind: "selected" } | { kind: "asker_gone" } | { kind: "none" } | { kind: "ambiguous"; count: number };

/** The one terminal `request` names among `terminals`, or why there is not one. An id comes before a name. */
export function namedTerminal(terminals: readonly TerminalInfo[], { fromTerminalId, target }: TerminalFocusRequest): TerminalInfo | Exclude<TerminalFocusOutcome, { kind: "selected" }> {
  const from = terminals.find(({ id }) => id === fromTerminalId);
  if (!from) return { kind: "asker_gone" };
  const own = terminals.filter(({ project_path }) => isSamePath(project_path, from.project_path));
  const byId = own.find(({ id }) => id === target);
  if (byId) return byId;
  const [named, ...others] = own.filter(({ name }) => name === target);
  if (!named) return { kind: "none" };
  return others.length > 0 ? { kind: "ambiguous", count: others.length + 1 } : named;
}

const EVENT = "quay:terminal-focus-request";

interface RequestDetail {
  request: TerminalFocusRequest;
  /** What the app makes of it, or null while nothing has answered. */
  outcome: TerminalFocusOutcome | null;
}

/** Asks for a terminal to be selected, which it is at once. Null when nothing is there to ask. */
export function requestTerminalFocus(request: TerminalFocusRequest): TerminalFocusOutcome | null {
  const detail: RequestDetail = { request, outcome: null };
  window.dispatchEvent(new CustomEvent<RequestDetail>(EVENT, { detail }));
  return detail.outcome;
}

/** Calls `answer` with each request; it says what came of it. Returns a function that stops it. */
export function onTerminalFocusRequest(answer: (request: TerminalFocusRequest) => TerminalFocusOutcome): () => void {
  const listener = (e: Event) => {
    const { detail } = e as CustomEvent<RequestDetail>;
    detail.outcome = answer(detail.request);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
