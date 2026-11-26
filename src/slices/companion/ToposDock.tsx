import { useMemo, useRef, useState, type ReactNode } from "react";
import { SlotLayer } from "../stage/SlotLayer.tsx";
import { Lens, OVER_LENS_MARK } from "../lens/Lens.tsx";
import { focusTerminal } from "../terminal/terminalRequests.ts";

/** Topos as the companion sees it: where its view draws Topos, and the view's Wide toggle. */
export interface CompanionTopos {
  /** Whether the Topos lens is open. */
  wide: boolean;
  /** Takes the element the Topos view draws Topos over, or null when the view goes. */
  viewSlot: (el: HTMLElement | null) => void;
  /** Opens the Topos lens. */
  openWide: () => void;
  /** Closes the Topos lens and hands keyboard focus back to the selected terminal. */
  closeWide: () => void;
}

/** Where Topos draws: over the companion's Topos view, or over the stage in the Topos lens. */
export type ToposPlacement = "companion" | "lens";

/** What `useToposDock` returns: Topos's one instance, placed in the companion or the Topos lens. */
export interface ToposDock {
  companion: CompanionTopos;
  /** Whether the Topos lens is open. */
  wide: boolean;
  /** Takes the element the Topos lens draws Topos over. */
  lensSlot: (el: HTMLElement | null) => void;
  /** Where Topos draws now, or null while it is hidden. */
  placement: ToposPlacement | null;
  /** The element Topos draws over now, or null while it is hidden. */
  slot: HTMLElement | null;
  /** Closes the Topos lens without moving focus, for the lens frame's own close, which returns focus itself. */
  dismiss: () => void;
}

/**
 * Topos's place in the shell. Topos is drawn once and never unmounted, so its scroll position,
 * selection and filters last while it is hidden; this decides what it draws over. With the Topos
 * lens open it draws over the lens, else over the companion's Topos view while that view shows,
 * else nowhere. The lens belongs to the terminal it opened for, so selecting another terminal
 * closes it. `onOpenWide` runs as the lens opens, so the app can close another lens first.
 */
export function useToposDock(activeTerminalId: string | null, onOpenWide?: () => void): ToposDock {
  const [wideFor, setWideFor] = useState<string | null>(null);
  if (wideFor !== null && wideFor !== activeTerminalId) setWideFor(null);
  const [viewSlot, setViewSlot] = useState<HTMLElement | null>(null);
  const [lensSlot, setLensSlot] = useState<HTMLElement | null>(null);
  const onOpenWideRef = useRef(onOpenWide);
  onOpenWideRef.current = onOpenWide;
  const wide = wideFor !== null;
  // Until the lens has drawn its slot, Topos stays over its view, so it never blinks hidden.
  const placement: ToposPlacement | null = wide && lensSlot ? "lens" : viewSlot ? "companion" : null;
  const slot = placement === "lens" ? lensSlot : placement === "companion" ? viewSlot : null;
  const companion = useMemo<CompanionTopos>(
    () => ({
      wide,
      viewSlot: setViewSlot,
      openWide: () => {
        if (activeTerminalId === null) return;
        onOpenWideRef.current?.();
        setWideFor(activeTerminalId);
      },
      closeWide: () => {
        if (wideFor === null) return;
        setWideFor(null);
        focusTerminal(wideFor);
      },
    }),
    [wide, wideFor, activeTerminalId],
  );
  return useMemo(
    () => ({ companion, wide, lensSlot: setLensSlot, placement, slot, dismiss: () => setWideFor(null) }),
    [companion, wide, placement, slot],
  );
}

/**
 * The layer Topos draws in, laid over the dock's slot and hidden while it has none. It stays in
 * one place in the page whatever it draws over, so Topos inside it is never remounted and keeps
 * its scroll position. Over the companion it sits under the companion's popups; over the lens, on
 * top of the lens frame.
 */
export const ToposLayer = ({ dock, children }: { dock: ToposDock; children: ReactNode }) => (
  <SlotLayer
    slot={dock.slot}
    layerClass={`${dock.placement === "lens" ? "z-30" : "z-10"} flex flex-col`}
    data={{ "data-topos-layer": true, "data-placement": dock.placement ?? undefined, ...(dock.placement === "lens" ? OVER_LENS_MARK : {}) }}
  >
    {children}
  </SlotLayer>
);

/**
 * The Topos lens: the lens frame over the stage, whose body Topos draws over. It closes like every
 * lens, from its close button or with Escape, and hands keyboard focus back to the terminal.
 */
export const ToposLens = ({
  dock,
  terminalId,
  title,
  replyStrip,
}: {
  dock: ToposDock;
  terminalId: string;
  title: ReactNode;
  replyStrip: ReactNode;
}) => (
  <Lens label="Topos lens" title={title} terminalId={terminalId} onClose={dock.dismiss} replyStrip={replyStrip}>
    <div ref={dock.lensSlot} className="flex-1 min-h-0" />
  </Lens>
);

/**
 * The companion's Topos view: the slot Topos draws over. While the Topos lens is open, Topos draws
 * there instead, and the view says so.
 */
export const ToposViewSlot = ({ topos }: { topos: CompanionTopos }) => (
  <div ref={topos.viewSlot} data-topos-slot className="h-full min-h-0">
    {topos.wide && <p className="p-4 text-xs text-[#8b949e]">Topos is open wide over the terminal.</p>}
  </div>
);
