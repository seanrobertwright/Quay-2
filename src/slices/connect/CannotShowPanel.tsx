import { useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { usePopupLayer } from "../overlay/useOverlay.ts";
import type { CannotShow } from "./cannotShow.ts";
import { ConnectRowLink } from "./ConnectRowLink.tsx";

/** The panel's width, and how far it stays from the window's edges, in pixels. */
const WIDTH = 288;
const MARGIN = 8;

interface CannotShowPanelProps {
  id: string;
  label: string;
  why: CannotShow;
  /** The button that opened it, which it opens under. */
  button: RefObject<HTMLButtonElement | null>;
  /** Called when it should go away. `refocus` is false when focus has moved on already. */
  onClose: (refocus: boolean) => void;
}

/**
 * Why a terminal can't show surfaces, in a panel under its mark. It is drawn outside the pane, which
 * would cut it off. It takes focus as it opens; Escape, Tab past its link, a press outside, focus
 * moving elsewhere or a resize of the window closes it.
 */
export const CannotShowPanel = ({ id, label, why, button, onClose }: CannotShowPanelProps) => {
  const panel = useRef<HTMLDivElement | null>(null);
  usePopupLayer(true, () => onClose(true), panel);

  useLayoutEffect(() => {
    const at = button.current?.getBoundingClientRect();
    if (!at || !panel.current) return;
    const furthest = Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN);
    panel.current.style.left = `${Math.min(Math.max(MARGIN, at.right - WIDTH), furthest)}px`;
    panel.current.style.top = `${at.bottom + 4}px`;
    panel.current.focus({ preventScroll: true });
  }, [button]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) onClose(false);
    };
    const onResize = () => onClose(true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [button, onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const link = panel.current?.querySelector("button");
    if (link && document.activeElement !== link && !e.shiftKey) link.focus();
    else onClose(true);
  };

  const onBlur = ({ relatedTarget }: FocusEvent) => {
    const inside = panel.current?.contains(relatedTarget) || relatedTarget === button.current;
    // Nothing takes focus when the window loses it, and the panel stays
    if (relatedTarget && !inside) onClose(false);
  };

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a dialog whose Tab leaves it, and whose clicks and right-clicks the portal would hand to the pane
    <div
      ref={panel}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-no-terminal-focus
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className="fixed z-[60] p-3 flex flex-col items-start gap-1.5 rounded-lg border border-[#30363d] bg-[#161b22] shadow-xl text-xs leading-5 text-[#c9d1d9] select-text focus:outline-hidden"
      style={{ width: WIDTH }}
    >
      <p>{why.reason}</p>
      {why.remedy === "words" ? <p className="text-[#8b949e]">{why.words}</p> : <ConnectRowLink onPress={() => onClose(true)} />}
    </div>,
    document.body
  );
};
