// Asking the app to open one file's diff in Topos from elsewhere (#721), such as a file link in an
// agent's surface.
import type { Side } from "./topos/stagingLists.ts";

/** Which of Topos's lists a file's change is in. Mirrors `ChangeSide`. */
export type ChangeSide = Side | "conflicted";

/** A file with uncommitted changes that an agent of `terminalId` named. */
export interface FileDiffRequest {
  terminalId: string;
  /** The root of the worktree the file is in. */
  worktree: string;
  /** Relative to that root, with `/` separators. */
  path: string;
  side: ChangeSide;
  /** The line the link named, or null. The diff view does not go to it yet. */
  line: number | null;
}

const EVENT = "quay:file-diff-request";

/** Asks for the diff view on a file. Says whether the app took it, which it does for the selected terminal's. */
export function requestFileDiff(request: FileDiffRequest): boolean {
  return !window.dispatchEvent(new CustomEvent<FileDiffRequest>(EVENT, { detail: request, cancelable: true }));
}

/** Calls `open` with each request; it says whether it took it. Returns a function that stops it. */
export function onFileDiffRequest(open: (request: FileDiffRequest) => boolean): () => void {
  const listener = (e: Event) => {
    // Cancelling the event is how the sender learns it was taken.
    if (open((e as CustomEvent<FileDiffRequest>).detail)) e.preventDefault();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
