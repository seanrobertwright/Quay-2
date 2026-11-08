// The terminal menu (#508), shared by a terminal's Rail row and its pane header, and the terminal
// body menu (#511), which puts a clipboard group above it. The items come from `terminalMenu`
// and `terminalBodyMenu`; each surface hands in the handlers its own buttons and shortcuts
// already call, and this module adds the actions every surface shares: the two folder actions,
// and the body's clipboard actions, which are the same functions the terminal's keys call.
import type { FC } from "react";
import { ContextMenu, type MenuPoint } from "../overlay/ContextMenu.tsx";
import { bindMenuItems, copyToClipboard, revealFolder } from "../overlay/menuActions.ts";
import { copySelection, pasteClipboard, type BodyTerminal } from "./terminalBody.ts";
import {
  terminalBodyMenu,
  terminalMenu,
  terminalMenuLabel,
  type ClipboardMenuAction,
  type TerminalMenuAction,
  type TerminalMenuSurface,
} from "./terminalMenu.ts";
import type { TerminalInfo } from "./types.ts";

/** What each of a surface's items does; the folder actions are this module's own. */
export type TerminalMenuHandlers = Record<Exclude<TerminalMenuAction, "copyWorkingDirectory" | "openFolder">, () => void>;

/** The folder actions every terminal menu offers. */
function folderHandlers(terminal: TerminalInfo) {
  return {
    copyWorkingDirectory: () => copyToClipboard(terminal.project_path, "working directory"),
    openFolder: () => revealFolder(terminal.project_path),
  };
}

interface TerminalMenuProps {
  terminal: TerminalInfo;
  surface: TerminalMenuSurface;
  at: MenuPoint;
  onClose: (refocus: boolean) => void;
  /** The surface's handlers. An item whose handler is missing is left out. */
  handlers: Partial<TerminalMenuHandlers>;
}

export const TerminalMenu: FC<TerminalMenuProps> = ({ terminal, surface, at, onClose, handlers }) => {
  const items = bindMenuItems<TerminalMenuAction>(terminalMenu(terminal, surface), { ...handlers, ...folderHandlers(terminal) });
  return <ContextMenu label={terminalMenuLabel(terminal)} items={items} at={at} onClose={onClose} />;
};

interface TerminalBodyMenuProps {
  terminal: TerminalInfo;
  /** How many panes the stage shows, which decides whether Close pane can run. */
  paneCount: number;
  /** The xterm terminal the clipboard group acts on. */
  term: BodyTerminal;
  /** The terminal's whole scrollback as text, for Copy scrollback. */
  scrollback: () => string;
  at: MenuPoint;
  onClose: (refocus: boolean) => void;
  /** The pane's handlers, as for its header's menu; `find` also runs the clipboard group's Find…. */
  handlers: Partial<TerminalMenuHandlers>;
}

/** The menu a right-click in a terminal's body opens. Copy reads whether there is a selection as the menu opens. */
export const TerminalBodyMenu: FC<TerminalBodyMenuProps> = ({ terminal, paneCount, term, scrollback, at, onClose, handlers }) => {
  const items = bindMenuItems<TerminalMenuAction | ClipboardMenuAction>(terminalBodyMenu(terminal, paneCount, term.hasSelection()), {
    ...handlers,
    ...folderHandlers(terminal),
    copy: () => copySelection(term),
    paste: () => pasteClipboard(term),
    selectAll: () => term.selectAll(),
    copyScrollback: () => copyToClipboard(scrollback(), "scrollback"),
  });
  return <ContextMenu label={terminalMenuLabel(terminal)} items={items} at={at} onClose={onClose} />;
};
