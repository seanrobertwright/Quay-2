import { useRef, type ReactNode, type RefObject } from "react";
import { usePopupLayer } from "../overlay/useOverlay.ts";
import { focusTerminal } from "../terminal/terminalRequests.ts";

interface LensProps {
  /** The lens's accessible name, such as "Diff lens". */
  label: string;
  /** What the lens shows, in its header. */
  title: ReactNode;
  /** The selected terminal, which takes keyboard focus back when the lens closes. */
  terminalId: string;
  onClose: () => void;
  /** The reply strip at the lens's foot. */
  replyStrip: ReactNode;
  children: ReactNode;
}

/**
 * The frame every lens shares: it covers the stage, from the module bar or the open panel's right
 * edge to the companion's left edge, so the companion stays usable beside it. It closes from its
 * close button or with Escape from anywhere, a terminal included; either way keyboard focus goes
 * back to the selected terminal. Its host renders it inside a positioned stage wrapper and closes
 * it on a click on a readiness cell. Nothing underneath it changes while it is open.
 */
export const Lens = ({ label, title, terminalId, onClose, replyStrip, children }: LensProps) => {
  const frame = useRef<HTMLElement>(null);
  const close = () => {
    onClose();
    focusTerminal(terminalId);
  };
  // On the overlay stack, so Escape closes the lens from wherever focus is, and a modal opened
  // over it closes first.
  usePopupLayer(true, close, frame as RefObject<HTMLElement | null>);
  return (
    <section
      ref={frame}
      aria-label={label}
      data-lens
      className="absolute inset-0 z-30 flex flex-col bg-[#0b0f14] border-r-2 border-[#58a6ff]"
    >
      <header className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-[#30363d] bg-[#161b22] text-xs">
        <h2 className="min-w-0 truncate font-semibold text-white">{title}</h2>
        <span className="ml-auto text-[#8b949e]">Esc closes</span>
        <button
          type="button"
          onClick={close}
          className="h-7 px-3 rounded-md border border-[#30363d] bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]"
        >
          Close lens
        </button>
      </header>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      {replyStrip}
    </section>
  );
};
