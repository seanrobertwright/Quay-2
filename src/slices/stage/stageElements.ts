// The stage's elements on the page that code looks for, and the attributes it finds them by. It imports no
// slice, so that what asks after the stage need not import what draws it.

/** Marks the stage's own element. */
export const STAGE_MARK = { "data-stage": true };
/** Marks the button that launches a terminal from a stage with none. */
export const LAUNCH_TERMINAL_MARK = { "data-launch-terminal": true };

/** Whether `element` is on the stage, the stage tab bar and what its tabs show among it. */
export const isOnStage = (element: Element): boolean => element.closest("[data-stage]") !== null;

/** The button that launches a terminal, when `stage` shows no terminal's panes. */
export const launchTerminalOf = (stage: Element): HTMLElement | null => stage.querySelector<HTMLElement>("[data-launch-terminal]");

/** Marks a lens's frame, which its host draws beside the stage, over it. */
export const LENS_MARK = { "data-lens": true };

/** Whether a lens is drawn over the stage that `element` is on. */
export const isUnderLens = (element: Element): boolean =>
  element.closest("[data-stage]")?.parentElement?.querySelector("[data-lens]") != null;

/** Whether something covers `element` on the stage: a stage tab in front of it, which makes it inert, or a lens. */
export const isCoveredOnStage = (element: Element): boolean => element.closest("[inert]") !== null || isUnderLens(element);
