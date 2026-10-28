// The layout commands as a menu (#248): the toolbar's Arrange button opens it with every
// action, and a node's context menu opens it with the aligns and distributes. The empty
// canvas's context menu uses the same menu for Paste. Items that
// need more nodes selected stay in the list, marked unavailable, so the menu keeps its
// shape. It follows the WAI-ARIA menu pattern: focus starts on the first item, the arrow
// keys, Home and End move it, and Escape or Tab closes the menu.
import { useEffect, useId, useRef, useState, type CSSProperties, type FC, type KeyboardEvent, type RefObject } from "react";
import { LayoutGrid } from "lucide-react";
import { ARRANGE_ACTIONS, arrangeLabel, canArrange, type ArrangeAction } from "./arrange.ts";
import { ariaKeyShortcuts, shortcutLabel } from "./keymap.ts";

/** The actions a node's context menu offers: all but auto-arrange. */
export const NODE_MENU_ACTIONS = ARRANGE_ACTIONS.filter((a) => a.type !== "auto");

/** One entry of a menu. */
export interface MenuItem {
  name: string;
  enabled: boolean;
  /** Items of one group sit together, with a separator between groups. */
  group: string;
  /** Shown at the item's right edge: a shortcut, or why it is unavailable. */
  hint?: string;
  ariaKeyShortcuts?: string;
  onChoose: () => void;
}

interface MenuProps {
  /** The menu's accessible name. */
  label: string;
  id?: string;
  items: readonly MenuItem[];
  /** Called when the menu should go away; `refocus` is false when focus has moved on already. */
  onClose: (refocus: boolean) => void;
  /** The button that opened the menu, whose own presses toggle it rather than close it. */
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
  style?: CSSProperties;
}

/** A list of items following the WAI-ARIA menu pattern described at the top of this file. */
export const Menu: FC<MenuProps> = ({ label, id, items, onClose, anchorRef, className, style }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttons = () => [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  useEffect(() => {
    buttons()[0]?.focus();
  }, []);
  // A press anywhere outside closes the menu, leaving focus where the press puts it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!rootRef.current?.contains(target) && !anchorRef?.current?.contains(target)) onClose(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose, anchorRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = buttons();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => list[(to + list.length) % list.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        move(at - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "Escape":
        onClose(true);
        break;
      case "Tab":
        onClose(true);
        break;
      default:
        return;
    }
    // Handled here, so the builder's own keys leave it alone.
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={rootRef}
      id={id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`z-30 min-w-56 py-1 rounded-md border border-[#30363d] bg-[#161b22] shadow-xl text-xs ${className ?? ""}`}
      style={style}
    >
      {items.map((item, i) => {
        const groupStarts = i > 0 && items[i - 1].group !== item.group;
        return (
          <div key={item.name}>
            {groupStarts && <div role="separator" className="my-1 border-t border-[#30363d]" />}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={!item.enabled}
              aria-keyshortcuts={item.ariaKeyShortcuts}
              onClick={() => {
                if (!item.enabled) return;
                onClose(true);
                item.onChoose();
              }}
              className="w-full flex items-center gap-4 px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] focus:bg-[#21262d] focus:outline-none aria-disabled:text-[#484f58] aria-disabled:hover:bg-transparent"
            >
              <span>{item.name}</span>
              <span className="ml-auto text-[10px] text-[#6e7681]">{item.hint}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

interface ArrangeMenuProps extends Omit<MenuProps, "items"> {
  actions: readonly ArrangeAction[];
  selectedCount: number;
  onChoose: (action: ArrangeAction) => void;
}

export const ArrangeMenu: FC<ArrangeMenuProps> = ({ actions, selectedCount, onChoose, ...menu }) => (
  <Menu
    {...menu}
    items={actions.map((action) => {
      const enabled = canArrange(action, selectedCount);
      const auto = action.type === "auto";
      return {
        name: arrangeLabel(action),
        enabled,
        group: action.type,
        hint: auto ? shortcutLabel("auto-arrange") : enabled ? undefined : `${action.type === "align" ? 2 : 3}+ nodes`,
        ariaKeyShortcuts: auto ? ariaKeyShortcuts("auto-arrange") : undefined,
        onChoose: () => onChoose(action),
      };
    })}
  />
);

/** The toolbar's Arrange button and the menu it opens under it. */
export const ArrangeMenuButton: FC<{ selectedCount: number; onChoose: (action: ArrangeAction) => void }> = ({
  selectedCount,
  onChoose,
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Arrange"
        title="Arrange"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md"
      >
        <LayoutGrid className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <ArrangeMenu
          id={menuId}
          label="Arrange"
          actions={ARRANGE_ACTIONS}
          selectedCount={selectedCount}
          onChoose={onChoose}
          onClose={close}
          anchorRef={buttonRef}
          className="absolute right-0 top-full mt-1"
        />
      )}
    </div>
  );
};
