/** The parts of a keydown that decide whether it dismisses an overlay. */
export interface DismissKeyEvent {
  key: string;
  target: EventTarget | null;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** True while an IME is composing, when Escape cancels the composition instead. */
  isComposing?: boolean;
  /** True for auto-repeat, so holding Escape closes one overlay rather than the whole stack. */
  repeat?: boolean;
}

/** An open overlay, as the stack sees it. */
export interface Overlay {
  close(): void;
  /** Whether a key or click target sits inside this overlay's panel. */
  contains(target: EventTarget | null): boolean;
}

export interface OverlayStack {
  /** Puts an overlay on top of the stack. The returned function takes it off again. */
  open(overlay: Overlay): () => void;
  /** Whether any overlay is open. */
  isOpen(): boolean;
  /**
   * Closes the topmost overlay when `e` is a plain Escape that belongs to the stack, and says
   * whether it did; the caller then keeps the key from everything else, a terminal included.
   *
   * Escape belongs to the stack when it comes from inside any open overlay, or from outside every
   * other surface (a terminal, the rail, the page). It is left alone when it comes from inside a
   * surface the stack doesn't know, such as another modal open on top, which `isOtherSurface`
   * recognises.
   */
  handleDismissKey(e: DismissKeyEvent, isOtherSurface: (target: EventTarget | null) => boolean): boolean;
}

/** Whether a keydown is a plain Escape: no modifiers, not auto-repeat, not ending an IME composition. */
export function isDismissKey(e: DismissKeyEvent): boolean {
  return (
    e.key === "Escape" &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    !e.isComposing &&
    !e.repeat
  );
}

export function createOverlayStack(): OverlayStack {
  const stack: Overlay[] = [];

  return {
    open(overlay) {
      // Each open gets its own entry, so the same overlay object can't be removed twice.
      const entry: Overlay = { close: () => overlay.close(), contains: (t) => overlay.contains(t) };
      stack.push(entry);
      return () => {
        const index = stack.indexOf(entry);
        if (index !== -1) stack.splice(index, 1);
      };
    },

    isOpen() {
      return stack.length > 0;
    },

    handleDismissKey(e, isOtherSurface) {
      if (!isDismissKey(e)) return false;
      const top = stack[stack.length - 1];
      if (!top) return false;
      const fromStack = stack.some((overlay) => overlay.contains(e.target));
      if (!fromStack && isOtherSurface(e.target)) return false;
      top.close();
      return true;
    },
  };
}
