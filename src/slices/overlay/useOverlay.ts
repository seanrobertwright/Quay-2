import { useEffect, useRef, type MouseEvent, type RefObject } from "react";
import { trapTabTarget } from "./focusTrap.ts";
import { createOverlayStack } from "./overlayStack.ts";

/** Every open overlay in the app, topmost last. */
const overlays = createOverlayStack();

/**
 * A modal surface the stack doesn't manage: one marked `role="dialog"`, or a full-window
 * `fixed inset-0` layer like the app's other modals. Escape from inside one is left to it.
 */
function isOtherSurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"], .fixed.inset-0') !== null;
}

// Window capture runs before any element sees the key. xterm handles Escape on its textarea and
// stops it there, so a bubble-phase listener never hears Escape while a terminal has focus.
let listening = false;
function listenForEscape() {
  if (listening) return;
  listening = true;
  window.addEventListener(
    "keydown",
    (e) => {
      if (overlays.handleDismissKey(e, isOtherSurface)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
}

/**
 * Whether an overlay is open. Code that moves focus on its own, such as a terminal reclaiming it,
 * checks this so it doesn't pull focus out from under an open overlay.
 */
export function isOverlayOpen(): boolean {
  return overlays.isOpen();
}

/**
 * Puts a popup that opens inside an overlay, such as a menu, on the stack while `isOpen`, so
 * Escape closes it before the overlay under it. `onClose` runs instead of the overlay's.
 */
export function usePopupLayer(isOpen: boolean, onClose: () => void, popupRef: RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    listenForEscape();
    return overlays.open({
      close: () => onCloseRef.current(),
      contains: (target) => target instanceof Node && !!popupRef.current?.contains(target),
    });
  }, [isOpen, popupRef]);
}

/** The controls a dialog's focus trap moves between. */
const DIALOG_CONTROLS = "input:not(:disabled), select:not(:disabled), button:not(:disabled)";

/**
 * Focus for a modal dialog drawn inside an overlay while `isOpen`: it starts on the first enabled
 * control, Tab and Shift+Tab stay among the enabled controls, and on close it goes back where it
 * was, or to `fallbackRef` when that has gone.
 */
export function useDialogFocus(
  isOpen: boolean,
  panelRef: RefObject<HTMLElement | null>,
  fallbackRef?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!isOpen) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = fallbackRef?.current ?? null;
    const node = panelRef.current;
    node?.querySelector<HTMLElement>(DIALOG_CONTROLS)?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || node === null) return;
      const controls = [...node.querySelectorAll<HTMLElement>(DIALOG_CONTROLS)];
      const target = trapTabTarget(controls, document.activeElement, e.shiftKey);
      if (target === null) return;
      e.preventDefault();
      target.focus();
    };
    node?.addEventListener("keydown", trap);
    return () => {
      node?.removeEventListener("keydown", trap);
      if (before?.isConnected) before.focus();
      else fallback?.focus();
    };
  }, [isOpen, panelRef, fallbackRef]);
}

interface UseOverlayOptions {
  isOpen: boolean;
  onClose: () => void;
  /** What takes focus when the overlay opens. Defaults to the panel itself. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Makes a modal panel dismissable the same way as every other overlay: Escape closes the topmost
 * one from anywhere, a terminal included; a click on the backdrop outside the panel closes it;
 * focus moves into it on open and goes back where it was on close.
 *
 * Spread `backdropProps` on the full-window layer and `panelProps` on the panel inside it.
 */
export function useOverlay({ isOpen, onClose, initialFocusRef }: UseOverlayOptions) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRefRef = useRef(initialFocusRef);
  initialFocusRefRef.current = initialFocusRef;
  const pressStartedOutside = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    listenForEscape();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const remove = overlays.open({
      close: () => onCloseRef.current(),
      contains: (target) => target instanceof Node && !!panelRef.current?.contains(target),
    });
    (initialFocusRefRef.current?.current ?? panelRef.current)?.focus({ preventScroll: true });

    return () => {
      remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const isOutside = (target: EventTarget) =>
    !(target instanceof Node && panelRef.current?.contains(target));

  return {
    backdropProps: {
      // Both ends of the click must land outside, so a text selection dragged out of the panel
      // doesn't close it.
      onMouseDown: (e: MouseEvent) => {
        pressStartedOutside.current = isOutside(e.target);
      },
      onClick: (e: MouseEvent) => {
        if (pressStartedOutside.current && isOutside(e.target)) onCloseRef.current();
        pressStartedOutside.current = false;
      },
    },
    panelProps: {
      ref: panelRef,
      role: "dialog",
      "aria-modal": true,
      tabIndex: -1,
    } as const,
  };
}
