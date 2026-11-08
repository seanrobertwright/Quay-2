// Opening a surface's `ContextMenu` (#507): from a right-click, at the pointer, or from Shift+F10
// or the Menu key, at the focused element's lower left corner. The surface renders the menu
// while `open` is set, at `open.at`, with `close` as its `onClose`.
import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { MenuPoint } from "./ContextMenu.tsx";

/** A menu that is open: what it is for, and where it opens. */
export interface OpenContextMenu<T> {
  target: T;
  at: MenuPoint;
}

/**
 * What takes focus when the menu closes: an element, or a function that finds it then, for a
 * surface whose element may have been drawn afresh while the menu was open.
 */
export type MenuOpener = HTMLElement | (() => HTMLElement | null);

/** Whether a keydown opens a context menu: Shift+F10 or the Menu key, with no other modifier. */
export function isContextMenuKey(e: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  return (e.key === "F10" && e.shiftKey) || e.key === "ContextMenu";
}

interface Options<T> {
  /** Names the thing a menu is for, so two targets for the same thing compare equal. Defaults to the target itself. */
  keyOf?: (target: T) => unknown;
}

export function useContextMenu<T>({ keyOf = (t: T) => t }: Options<T> = {}) {
  const [open, setOpen] = useState<OpenContextMenu<T> | null>(null);
  // Read by the handlers, so a handler made before the last render still sees the menu open now.
  const current = useRef<{ key: unknown; fromKey: boolean; opener: MenuOpener | null } | null>(null);
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;

  /**
   * Opens the menu for `target` at a point in the window, as a right-click does. The Menu key
   * can fire a contextmenu event after its keydown has opened the menu; that second opening is
   * ignored, so the menu doesn't move and keeps what to give focus back to. Says whether the
   * menu opened.
   */
  const openAt = useCallback((target: T, at: MenuPoint, opener: MenuOpener | null): boolean => {
    const key = keyOfRef.current(target);
    if (current.current?.fromKey && Object.is(current.current.key, key)) return false;
    current.current = { key, fromKey: false, opener };
    setOpen({ target, at });
    return true;
  }, []);

  /** Opens the menu for `target` at `el`'s lower left corner, as Shift+F10 does; focus goes back to `opener`, or else `el`. */
  const openBelow = useCallback((target: T, el: HTMLElement, opener: MenuOpener = el) => {
    const box = el.getBoundingClientRect();
    current.current = { key: keyOfRef.current(target), fromKey: true, opener };
    setOpen({ target, at: { x: box.left, y: box.bottom } });
  }, []);

  /** The surface's `onContextMenu`: opens the menu at the pointer. */
  const onContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLElement>, target: T) => {
      // Quay's menu replaces the native one, and nothing behind the surface opens another.
      e.preventDefault();
      e.stopPropagation();
      openAt(target, { x: e.clientX, y: e.clientY }, e.currentTarget);
    },
    [openAt]
  );

  /** The surface's `onKeyDown`: Shift+F10 and the Menu key open the menu below it. */
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>, target: T) => {
      if (!isContextMenuKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      openBelow(target, e.currentTarget);
    },
    [openBelow]
  );

  /** Closes the menu; with `refocus`, focus goes back to what opened it. */
  const close = useCallback((refocus: boolean) => {
    const opener = current.current?.opener ?? null;
    current.current = null;
    setOpen(null);
    if (!refocus) return;
    const el = typeof opener === "function" ? opener() : opener;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, []);

  return { open, openAt, openBelow, onContextMenu, onKeyDown, close };
}
