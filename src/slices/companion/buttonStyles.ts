// The companion's shared button and text classes, so its views draw one button style.

/** The shape every companion button shares. */
const BUTTON = "h-7 px-3 rounded-md border text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed";

/** The green button for a view's main action, such as Merge or Comment. */
export const PRIMARY = `${BUTTON} border-[#2ea043] bg-[#238636] text-white enabled:hover:bg-[#2ea043]`;

/** The grey button for every other action. */
export const SECONDARY = `${BUTTON} border-[#30363d] bg-[#21262d] text-[#c9d1d9] enabled:hover:bg-[#30363d]`;

/** Secondary text. */
export const MUTED = "text-[#8b949e]";
