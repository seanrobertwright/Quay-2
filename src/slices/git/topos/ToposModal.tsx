import React, { createContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createModalLayer, type ModalLayer } from "./modalLayer";

/**
 * Topos's modal layer (#421), which every `ConfirmDialog` inside Topos opens: `host` is where the
 * dialog draws, over the whole panel and outside the content the layer makes inert.
 */
export const ToposModalContext = createContext<{ layer: ModalLayer; host: HTMLElement | null } | null>(null);

/** Creates Topos's one modal layer; pass it to `ToposModalScope`, which binds it to the content. */
export function useToposModal(): { layer: ModalLayer; content: React.RefObject<HTMLDivElement | null> } {
  const content = useRef<HTMLDivElement>(null);
  const [layer] = useState(() =>
    createModalLayer({
      setInert: (on) => {
        if (content.current) content.current.inert = on;
      },
    })
  );
  return { layer, content };
}

/**
 * Everything a confirm blocks while it is open, and the host the confirms draw in beside it. While
 * the layer is open `children` is inert, so nothing in it can be clicked or reached by Tab. A
 * `ConfirmDialog` anywhere under it portals into the host. Put a live region outside it, since an
 * inert one isn't announced.
 */
export const ToposModalScope: React.FC<{ modal: ReturnType<typeof useToposModal>; children: ReactNode }> = ({ modal, children }) => {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ layer: modal.layer, host }), [modal.layer, host]);
  return (
    <ToposModalContext.Provider value={value}>
      <div ref={modal.content} className="contents">
        {children}
      </div>
      <div ref={setHost} />
    </ToposModalContext.Provider>
  );
};
