// Keeps the keyboard's place when a stage tab closes or another comes to the front (#771).
import { useEffect, useRef, type RefObject } from "react";
import { isOverlayOpen } from "../overlay/useOverlay.ts";
import { terminalKeysOf } from "../terminal/terminalFocus.ts";
import { launchTerminalOf } from "./stageElements.ts";
import { frontTabOf } from "./StageTabBar.tsx";

/** What the stage shows, as far as its focus goes. */
interface Shown {
  /** The active project. Another's surface tabs leave the tab bar and are not closed. */
  project: string;
  /** The open stage tabs. */
  toolIds: readonly string[];
  /** The stage tab in front, or null while the terminals or Launch Terminal are. */
  front: string | null;
  /** The terminal in the panes that takes the focus, or null when no pane shows one. */
  focusTargetId: string | null;
}

/** Whether the focus is on nothing the operator can see: on the page itself, or on what is hidden or inert. */
function isFocusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active.closest("[hidden], [inert]") !== null;
}

/**
 * Puts the focus back on the stage when it was lost with a stage tab that closed, or beneath one that came to
 * the front. Once no stage tab is in front any more, it goes to the terminal `shown.focusTargetId`, or to Launch
 * Terminal. When a stage tab comes to the front, or one behind closes, it goes to the tab of what is in front.
 * Where the one is not on the stage, it goes to the other. Focus that is anywhere else stays there. While an
 * overlay is open nothing moves, and what changed beneath it is handled at the first render after it closes.
 */
export function useStageFocus(stage: RefObject<HTMLElement | null>, shown: Shown): void {
  const last = useRef(shown);
  useEffect(() => {
    // A change under an open overlay is kept for the first render after it closes.
    if (isOverlayOpen()) return;
    const before = last.current;
    last.current = shown;
    const { project, toolIds, front, focusTargetId } = shown;
    const frontChanged = front !== before.front;
    const closed = project === before.project && before.toolIds.some((id) => !toolIds.includes(id));
    if (!(frontChanged || closed) || !isFocusLost() || !stage.current) return;
    const tab = frontTabOf(stage.current);
    const content = terminalKeysOf(stage.current, focusTargetId) ?? launchTerminalOf(stage.current);
    const target = frontChanged && front === null ? (content ?? tab) : (tab ?? content);
    target?.focus({ preventScroll: true });
  });
}
