// Topos's one modal layer (#421): while any confirm is open, the rest of Topos is inert, so nothing
// in the graph, the diff view, the inspector or the toolbar can be clicked or reached by Tab.

/** The rest of Topos: everything but the layer the confirms draw in. */
export interface ModalContent {
  setInert(on: boolean): void;
}

/** The control that opened a confirm, which takes focus back when it closes. */
export interface Opener {
  readonly isConnected: boolean;
  focus(): void;
}

export interface ModalLayer {
  /**
   * Makes the rest of Topos inert for a confirm opened from `opener`. The returned function closes
   * it: once no confirm is left open the rest is live again, and then `opener` takes focus back if
   * it is still there. Calling it again does nothing.
   */
  open(opener: Opener | null): () => void;
  isOpen(): boolean;
}

export function createModalLayer(content: ModalContent): ModalLayer {
  let open = 0;
  return {
    open(opener) {
      if (open++ === 0) content.setInert(true);
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        if (--open === 0) content.setInert(false);
        // Only after the content is live again: an inert control can't take focus.
        if (opener?.isConnected) opener.focus();
      };
    },
    isOpen: () => open > 0,
  };
}
