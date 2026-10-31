// Topos's toast queue (#367, #393): short results of ref operations, newest last, bounded so a
// burst of them never grows the stack past a few.

/** A button on a toast, such as "Show that worktree". */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  /** A success fades on its own; a failure stays until it is dismissed. */
  tone: "done" | "failed";
  /** Plain text: ref names and paths in it are untrusted, so it is only ever rendered as text. */
  text: string;
  /** Lines under the text, such as the files a checkout would overwrite. */
  lines?: string[];
  action?: ToastAction;
  /** How long a success stays before it fades, when not the default. */
  ttlMs?: number;
}

/** How long the toast that offers Restore after a branch delete stays (#367). */
export const RESTORE_MS = 10_000;

/** The most toasts shown at once. */
export const MAX_TOASTS = 4;

/** `queue` with `toast` added last, dropping the oldest past [`MAX_TOASTS`]. */
export function pushToast(queue: readonly Toast[], toast: Toast): Toast[] {
  return [...queue, toast].slice(-MAX_TOASTS);
}

/** `queue` without the toast `id`; the same array when it isn't there. */
export function dismissToast<T extends readonly Toast[]>(queue: T, id: number): T | Toast[] {
  return queue.some((t) => t.id === id) ? queue.filter((t) => t.id !== id) : queue;
}
