// The confirm button's look (#421). A destructive confirm takes the danger colors each theme sets in
// `src/index.css`, so it never looks like Stage's green; its label names the action, so color is
// never the only cue.

/**
 * A confirm's words, which every Topos prompt builder returns and `ConfirmRequest` extends with its
 * controls.
 */
export interface ConfirmPrompt {
  title: string;
  detail: string;
  /** The confirm button's text, which names the action, so its color is never the only cue. */
  confirmLabel: string;
  /** Drops or overwrites work: the confirm button takes the danger style, never Stage's green. */
  destructive?: boolean;
}

const BASE =
  "px-3 py-1.5 rounded-md text-xs font-semibold aria-disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60";

/** The confirm button's classes: the danger style when `destructive`, Stage's green otherwise. */
export function confirmButtonClass(destructive: boolean): string {
  return destructive
    ? `${BASE} bg-[var(--topos-danger-bg)] hover:bg-[var(--topos-danger-bg-hover)] text-[var(--topos-danger-fg)]`
    : `${BASE} bg-[#238636] hover:bg-[#2ea043] text-white`;
}
