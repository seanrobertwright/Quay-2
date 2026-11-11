// Focus kept in a run's detail (#578). A run's detail is drawn again on each read of the run, and a
// read can remove the element in it that had focus: the node panel's hold link, or a hold panel or
// a control in one, once the hold closes, or the waiting banner's button, once the run waits no
// more. Focus that fell to the page with it goes to the heading of the region it was in instead:
// the node panel's for its hold link, else the run detail's, which names the run. `focusLost` is
// the one test of focus having fallen to the page, which the run canvas's Try again hands its own
// focus on by too (RunCanvas.tsx).
import { useEffect, useRef, type FocusEvent, type RefObject } from "react";

/** True when focus is on no element of the page, as when the element that had it was removed. */
export const focusLost = (focused: Element | null) => focused === null || focused === document.body || !focused.isConnected;

/** The handlers a region that keeps its focus spreads on its element, which follow where focus is in it. */
export interface KeptFocus {
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
}

/**
 * Keeps focus in a region, such as a run's detail or its node panel, when a render of the region
 * removes the element in it that had focus, as a read of the run does: focus that fell to the page
 * with that element goes to `landing`, the heading that names the region, which takes focus from
 * code only. Focus the reader moved elsewhere, in the region or out of it, stays where it is, and a
 * render that removes nothing moves none.
 *
 * Focus moves in an effect, once the render is committed. Effects run from the inside out, so a
 * region in another, as the node panel is in the run's detail, keeps its focus first, and the
 * outer region finds focus already on the inner one's heading. The run canvas's effect that hands
 * Try again's focus on is in the detail too, so it runs first, and the detail finds that focus
 * already handed on when the detail is drawn again with it.
 */
export function useKeptFocus(landing: RefObject<HTMLElement | null>): KeptFocus {
  // The element in the region that had focus last, until focus moves to an element out of it.
  const held = useRef<Element | null>(null);
  useEffect(() => {
    const had = held.current;
    if (had === null || had.isConnected || !focusLost(document.activeElement)) return;
    held.current = null;
    landing.current?.focus();
  });
  return {
    onFocus: (e) => {
      held.current = e.target;
    },
    onBlur: (e) => {
      // Focus that moves to an element out of the region is no longer the region's. Focus that
      // leaves for no element still is: Quay's window lost focus, as to the browser Open in browser
      // opens, and the element stays the page's active element, or the element is being removed. A
      // press in the builder on anything that takes no focus gives it to the nearest element that
      // does, at worst the builder's dialog, so the reader never puts focus on the page itself.
      if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) held.current = null;
    },
  };
}
