// The one menu component in Quay (#507), promoted from the Praxis builder's menu. It follows the
// WAI-ARIA menu pattern: focus starts on the first item (or the last, for a menu button opened
// by ArrowUp), the arrow keys, Home and End move it
// with wrap, and Escape or Tab closes the menu. Escape goes through the overlay stack, so it
// closes the menu before any overlay behind it. It renders through a portal to the document
// body, at a point in the window. It is never larger than the window: a long name is cut short,
// and a long list scrolls inside the menu.
import { useEffect, useLayoutEffect, useRef, useState, type FC, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { usePopupLayer } from "./useOverlay.ts";

/** A point in the window, in CSS pixels from its top left corner. */
export interface MenuPoint {
  x: number;
  y: number;
}

/** One entry of a menu. */
export interface ContextMenuItem {
  name: string;
  enabled: boolean;
  /** Items of one group sit together, with a separator between groups. */
  group: string;
  /** Shown at the item's right edge: a shortcut, or why it is unavailable. */
  hint?: string;
  ariaKeyShortcuts?: string;
  /** Set for a toggle: the item is then a checkbox item, announced as checked or not. */
  checked?: boolean;
  /** A CSS color shown as a dot before the name, such as a Topos track's lane color. */
  swatch?: string;
  /** The item's tooltip, such as what choosing it does. */
  title?: string;
  onChoose: () => void;
}

/** The roles of a menu's items, which the keys move between. */
const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"]';

export interface ContextMenuProps {
  /** The menu's accessible name. */
  label: string;
  id?: string;
  items: readonly ContextMenuItem[];
  /**
   * Where the menu opens: its top left corner, or its top right one with `align` "end". Near
   * the window's edge it flips to the other side of the point, or is clamped inside the window
   * when neither side has room.
   */
  at: MenuPoint;
  /** Which corner of the menu's top edge is at the point. Defaults to its start, the left. */
  align?: "start" | "end";
  /** Which item takes focus when the menu opens. Defaults to the first; a menu button opened by ArrowUp starts on the last. */
  focus?: "first" | "last";
  /** Called when the menu should go away; `refocus` is false when focus has moved on already. */
  onClose: (refocus: boolean) => void;
  /** The button that opened the menu, whose own presses toggle it rather than close it. */
  anchorRef?: RefObject<HTMLElement | null>;
}

/**
 * Where a menu `size` long on one axis starts, opened at `at` in a window `room` long: starting
 * at the point when it fits, else ending at the point, else as far in as fits. With `fromEnd` it
 * tries ending at the point first.
 */
function placeOnAxis(at: number, size: number, room: number, fromEnd = false): number {
  const after = at + size <= room ? at : null;
  const before = at - size >= 0 ? at - size : null;
  return (fromEnd ? (before ?? after) : (after ?? before)) ?? Math.max(0, room - size);
}

/** A list of items following the WAI-ARIA menu pattern described at the top of this file. */
export const ContextMenu: FC<ContextMenuProps> = ({ label, id, items, at, align = "start", focus = "first", onClose, anchorRef }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // On the Escape stack, so Escape closes the menu before any overlay behind it.
  usePopupLayer(true, () => onClose(true), rootRef);
  // Measured before the first paint, so the menu never shows cut off by the window's edge.
  const [place, setPlace] = useState(at);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    setPlace({
      x: placeOnAxis(at.x, root.offsetWidth, window.innerWidth, align === "end"),
      y: placeOnAxis(at.y, root.offsetHeight, window.innerHeight),
    });
  }, [at.x, at.y, align]);
  const buttons = () => [...(rootRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
  // Once, as the menu opens, and without scrolling, since a scroll closes the menu.
  const startOn = useRef(focus);
  useEffect(() => {
    const list = buttons();
    list[startOn.current === "last" ? list.length - 1 : 0]?.focus({ preventScroll: true });
  }, []);
  // A press anywhere outside closes the menu, leaving focus where the press puts it. The menu
  // sits at a point in the window, so a scroll or a resize, which moves what is under it, closes
  // it too, as does the window losing focus; focus then goes back where the menu came from.
  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && !!rootRef.current?.contains(target);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!inside(target) && !anchorRef?.current?.contains(target)) onClose(false);
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) onClose(true);
    };
    const onResize = () => onClose(true);
    // Focus events don't bubble, so this hears only the window's own blur.
    const onBlur = (e: FocusEvent) => {
      if (e.target === window) onClose(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose, anchorRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = buttons();
    const current = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => list[(to + list.length) % list.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        move(current + 1);
        break;
      case "ArrowUp":
        move(current - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "Escape":
      case "Tab":
        onClose(true);
        break;
      default:
        return;
    }
    // Handled here, so the keys of whatever the menu opened over leave it alone.
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={rootRef}
      id={id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // The portal still bubbles React events to the surface that rendered it. A right-click on
      // the menu does nothing, where the surface would open the menu again under the pointer, and
      // a press on it stays the menu's own, where an overlay's backdrop would take a press outside
      // its panel for a dismissal.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-[60] min-w-56 max-w-[min(28rem,calc(100vw-1rem))] max-h-[calc(100vh-1rem)] overflow-y-auto py-1 rounded-md border border-[#30363d] bg-[#161b22] shadow-xl text-xs"
      style={{ left: place.x, top: place.y }}
    >
      {items.map((item, i) => {
        const groupStarts = i > 0 && items[i - 1].group !== item.group;
        const toggle = item.checked !== undefined;
        return (
          <div key={item.name}>
            {groupStarts && <div role="separator" className="my-1 border-t border-[#30363d]" />}
            <button
              type="button"
              role={toggle ? "menuitemcheckbox" : "menuitem"}
              aria-checked={toggle ? item.checked : undefined}
              tabIndex={-1}
              aria-disabled={!item.enabled}
              aria-keyshortcuts={item.ariaKeyShortcuts}
              title={item.title}
              onClick={() => {
                if (!item.enabled) return;
                onClose(true);
                item.onChoose();
              }}
              className="w-full flex items-center gap-4 px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] focus:bg-[#21262d] focus:outline-none aria-disabled:text-[#484f58] aria-disabled:hover:bg-transparent"
            >
              {toggle && <Check className={`-ml-1 w-3 h-3 shrink-0 ${item.checked ? "" : "invisible"}`} aria-hidden="true" />}
              {item.swatch !== undefined && (
                <span aria-hidden="true" className="-mr-2 w-2 h-2 shrink-0 rounded-full" style={{ background: item.swatch }} />
              )}
              <span className="truncate">{item.name}</span>
              <span className="ml-auto text-[10px] text-[#6e7681]">{item.hint}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
};
