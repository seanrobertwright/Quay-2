// Keeps the keyboard's place when a stage tab closes or another comes to the front (#771).
import { useEffect, useRef, type RefObject } from "react";
import { isOverlayOpen } from "../overlay/useOverlay.ts";
import { terminalKeysOf } from "../terminal/terminalFocus.ts";
import { frontTabOf } from "./StageTabBar.tsx";

/** What the stage shows, as far as its focus goes. */
interface Shown {
  /** The active project. Another's surface tabs leave the tab bar and are not closed. */
  project: string;
  /** The open stage tabs. */
  toolIds: readonly string[];
  /** The stage tab in front, or null while the terminals or Launch Terminal are. */
  front: string | null;
  /** The terminal in the focused pane, if a pane shows one. */
  terminalId: string | null;
}

/** Whether the focus is on nothing the operator can see: on the page itself, or on what is hidden or inert. */
function isFocusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active.closest("[hidden], [inert]") !== null;
}

/**
 * Puts the focus back on the stage when it was lost with a stage tab that closed, or beneath one that came to
 * the front. Once no stage tab is in front any more, it goes to the terminal in the focused pane, or to Launch
 * Terminal. When a stage tab comes to the front, or one behind closes, it goes to the tab of what is in front.
 * Where the one is not on the stage, it goes to the other. Focus that is anywhere else stays there.
 */
export function useStageFocus(stage: RefObject<HTMLElement | null>, shown: Shown): void {
  const last = useRef(shown);
  useEffect(() => {
    const before = last.current;
    last.current = shown;
    const { project, toolIds, front, terminalId } = shown;
    const another = front !== before.front;
    const closed = project === before.project && before.toolIds.some((id) => !toolIds.includes(id));
    if (!(another || closed) || isOverlayOpen() || !isFocusLost() || !stage.current) return;
    const tab = frontTabOf(stage.current);
    const content = terminalKeysOf(stage.current, terminalId) ?? stage.current.querySelector<HTMLElement>("[data-launch-terminal]");
    const target = another && front === null ? (content ?? tab) : (tab ?? content);
    target?.focus({ preventScroll: true });
  });
}
