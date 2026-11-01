// The confirm button's look (#421). A destructive confirm takes the danger colors each theme sets in
// `src/index.css`, so it never looks like Stage's green; its label names the action, so color is
// never the only cue.

const BASE =
  "px-3 py-1.5 rounded-md text-xs font-semibold aria-disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60";

/** The confirm button's classes: the danger style when `destructive`, Stage's green otherwise. */
export function confirmButtonClass(destructive: boolean): string {
  return destructive
    ? `${BASE} bg-[var(--topos-danger-bg)] hover:bg-[var(--topos-danger-bg-hover)] text-[var(--topos-danger-fg)]`
    : `${BASE} bg-[#238636] hover:bg-[#2ea043] text-white`;
}
