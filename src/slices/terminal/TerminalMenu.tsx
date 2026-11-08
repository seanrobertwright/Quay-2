// The terminal menu (#508), shared by a terminal's Rail row and its pane header. The items come
// from `terminalMenu`; each surface hands in the handlers its own buttons and shortcuts already
// call, and this component adds the two folder actions every surface shares.
import type { FC } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ContextMenu, type ContextMenuItem, type MenuPoint } from "../overlay/ContextMenu.tsx";
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

/** Copies the terminal's working directory to the clipboard. */
function copyWorkingDirectory(path: string) {
  navigator.clipboard.writeText(path).catch((err) => console.error("Failed to copy the working directory:", err));
}

/** Opens Explorer on the terminal's folder, through the opener plugin. */
function openFolder(path: string) {
  revealItemInDir(path).catch((err) => console.error("Failed to open the folder in Explorer:", err));
}

export const TerminalMenu: FC<TerminalMenuProps> = ({ terminal, surface, at, onClose, handlers }) => {
  const all: Partial<Record<TerminalMenuAction, () => void>> = {
    ...handlers,
    copyWorkingDirectory: () => copyWorkingDirectory(terminal.project_path),
    openFolder: () => openFolder(terminal.project_path),
  };
  const items: ContextMenuItem[] = terminalMenu(terminal, surface).flatMap(({ action, ...item }) => {
    const run = all[action];
    return run ? [{ ...item, onChoose: run }] : [];
  });
  return <ContextMenu label={terminalMenuLabel(terminal)} items={items} at={at} onClose={onClose} />;
};
