// The classes Quay's plain buttons are drawn with.

/** The shape the plain buttons share. */
export const BUTTON_SHAPE = "h-7 px-3 rounded-md border text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed";

/** The green button for a view's main action, such as Merge or Comment. */
export const PRIMARY = `${BUTTON_SHAPE} border-[#2ea043] bg-[#238636] text-white enabled:hover:bg-[#2ea043]`;

/** The grey button for every other action. */
export const SECONDARY = `${BUTTON_SHAPE} border-[#30363d] bg-[#21262d] text-[#c9d1d9] enabled:hover:bg-[#30363d]`;

/** A button that looks like a link. */
export const BORDERLESS =
  "min-h-7 rounded-sm text-left text-xs text-[#58a6ff] underline enabled:hover:text-[#79c0ff] focus-visible:outline-2 focus-visible:outline-(--quay-accent) disabled:opacity-50 disabled:cursor-not-allowed";
