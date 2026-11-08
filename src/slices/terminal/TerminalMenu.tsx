// The terminal menu (#508), shared by a terminal's Rail row and its pane header. The items come
// from `terminalMenu`; each surface hands in the handlers its own buttons and shortcuts already
// call, and this component adds the two folder actions every surface shares.
import type { FC } from "react";
import { ContextMenu, type MenuPoint } from "../overlay/ContextMenu.tsx";
import { bindMenuItems, copyToClipboard, revealFolder } from "../overlay/menuActions.ts";
import { terminalMenu, terminalMenuLabel, type TerminalMenuAction, type TerminalMenuSurface } from "./terminalMenu.ts";
import type { TerminalInfo } from "./types.ts";

/** What each of a surface's items does; the folder actions are this component's own. */
export type TerminalMenuHandlers = Record<Exclude<TerminalMenuAction, "copyWorkingDirectory" | "openFolder">, () => void>;

interface TerminalMenuProps {
  terminal: TerminalInfo;
  surface: TerminalMenuSurface;
  at: MenuPoint;
  onClose: (refocus: boolean) => void;
  /** The surface's handlers. An item whose handler is missing is left out. */
  handlers: Partial<TerminalMenuHandlers>;
}

export const TerminalMenu: FC<TerminalMenuProps> = ({ terminal, surface, at, onClose, handlers }) => {
  const items = bindMenuItems<TerminalMenuAction>(terminalMenu(terminal, surface), {
    ...handlers,
    copyWorkingDirectory: () => copyToClipboard(terminal.project_path, "working directory"),
    openFolder: () => revealFolder(terminal.project_path),
  });
  return <ContextMenu label={terminalMenuLabel(terminal)} items={items} at={at} onClose={onClose} />;
};
