// The layout commands as a menu (#248): the toolbar's Arrange button opens it with every
// action, and a node's context menu opens it with the aligns and distributes. Items that
// need more nodes selected stay in the list, marked unavailable, so the menu keeps its
// shape. It is the shared context menu (#507), which follows the WAI-ARIA menu pattern.
import { useId, useRef, useState, type FC } from "react";
import { LayoutGrid } from "lucide-react";
import { ContextMenu, type ContextMenuProps, type MenuPoint } from "../overlay/ContextMenu.tsx";
import { ARRANGE_ACTIONS, arrangeLabel, canArrange, type ArrangeAction } from "./arrange.ts";
import { ariaKeyShortcuts, shortcutLabel } from "./keymap.ts";

/** The actions a node's context menu offers: all but auto-arrange. */
export const NODE_MENU_ACTIONS = ARRANGE_ACTIONS.filter((a) => a.type !== "auto");

interface ArrangeMenuProps extends Omit<ContextMenuProps, "items"> {
  actions: readonly ArrangeAction[];
  selectedCount: number;
  onChoose: (action: ArrangeAction) => void;
}

export const ArrangeMenu: FC<ArrangeMenuProps> = ({ actions, selectedCount, onChoose, ...menu }) => (
  <ContextMenu
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
  // Where the menu opens while it is open: under the button, their right edges lined up.
  const [openAt, setOpenAt] = useState<MenuPoint | null>(null);
  const open = openAt !== null;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const show = () => {
    const box = buttonRef.current?.getBoundingClientRect();
    if (box) setOpenAt({ x: box.right, y: box.bottom + 4 });
  };
  const close = (refocus: boolean) => {
    setOpenAt(null);
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
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            show();
          }
        }}
        className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md"
      >
        <LayoutGrid className="w-4 h-4" aria-hidden="true" />
      </button>
      {openAt && (
        <ArrangeMenu
          id={menuId}
          label="Arrange"
          actions={ARRANGE_ACTIONS}
          selectedCount={selectedCount}
          onChoose={onChoose}
          onClose={close}
          anchorRef={buttonRef}
          at={openAt}
          align="end"
        />
      )}
    </div>
  );
};
