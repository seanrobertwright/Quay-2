// Asking the app to open one file's diff in Topos from elsewhere (#721), such as a file link in an
// agent's surface.
import type { Side } from "./topos/stagingLists.ts";

/** A file with uncommitted changes, in the worktree that is its terminal's folder. */
export interface FileDiffRequest {
  terminalId: string;
  /** Relative to the worktree root, with `/` separators. */
  path: string;
  /** The staging list its change is in. */
  side: Side;
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
