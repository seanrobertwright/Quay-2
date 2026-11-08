// What a surface needs to offer the terminal menu (#508): the menu's open state, the inline
// rename box's state, and the element's right-click and Shift+F10 / Menu key handlers. A Rail
// row and a pane header both use it, so the two open the menu the same way.
import { useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useContextMenu } from "../overlay/useContextMenu.ts";

export function useTerminalMenu(terminalId: string, onRename?: (newName: string) => void) {
  const menu = useContextMenu<string>();
  const [isRenaming, setIsRenaming] = useState(false);

  return {
    menu,
    isRenaming,
    startRename: () => setIsRenaming(true),
    /** The rename box's `onDone`: saves a changed name and closes the box. */
    renameDone: (newName: string | null) => {
      if (newName !== null) onRename?.(newName);
      setIsRenaming(false);
    },
    /** Opens the menu at the pointer. The rename box keeps the native menu, with its Cut, Copy and Paste. */
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (!isRenaming) menu.onContextMenu(e, terminalId);
    },
    /** Opens the menu below the element on Shift+F10 or the Menu key, pressed on the element itself. */
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.target === e.currentTarget) menu.onKeyDown(e, terminalId);
    },
  };
}
