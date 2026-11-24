// Keeps the keyboard's place when what it is on leaves the screen, as a question does that settles.
import { useEffect, useRef, type FocusEvent } from "react";

interface Focused {
  terminalId: string;
  element: HTMLElement;
}

export interface FocusHandlers {
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
}

const isDisabled = (element: HTMLElement) => element.matches(":disabled");

/**
 * Calls `moveOn` after a draw that took the element that had the focus away, while the focus has gone
 * nowhere else since. The handlers are for what the elements are in. Nothing is moved when another
 * terminal's surfaces were drawn instead.
 */
export function useKeptFocus(terminalId: string, moveOn: () => void): FocusHandlers {
  const focused = useRef<Focused | null>(null);
  useEffect(() => {
    const had = focused.current;
    if (!had || (had.terminalId === terminalId && had.element.isConnected)) return;
    focused.current = null;
    const isNowhere = document.activeElement === null || document.activeElement === document.body;
    if (had.terminalId === terminalId && isNowhere) moveOn();
  });
  return {
    onFocus: ({ target }) => {
      focused.current = { terminalId, element: target };
    },
    onBlur: ({ target, relatedTarget }) => {
      // A button that is disabled as it is clicked loses the focus to nothing, and the keyboard's place is still there
      if (relatedTarget !== null || !isDisabled(target)) focused.current = null;
    },
  };
}
