// What a surface's menu component shares with the others: binding a builder's entries to their
// handlers, and the clipboard and folder actions several menus offer. The clipboard and the
// opener plugin are the only ways these menus reach outside the webview.
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ContextMenuItem } from "./ContextMenu.tsx";

/** A builder's entry: a menu item that names its action instead of carrying a handler. */
export type MenuEntry<A extends string> = Omit<ContextMenuItem, "onChoose"> & { action: A };

/** Binds each entry to its handler. An entry whose handler is missing is left out. */
export function bindMenuItems<A extends string>(
  entries: readonly MenuEntry<A>[],
  handlers: Partial<Record<A, () => void>>
): ContextMenuItem[] {
  return entries.flatMap(({ action, ...item }) => {
    const run = handlers[action];
    return run ? [{ ...item, onChoose: run }] : [];
  });
}

/** Copies `text` to the clipboard; `what` names it in the log when that fails. */
export function copyToClipboard(text: string, what: string) {
  navigator.clipboard.writeText(text).catch((err) => console.error(`Failed to copy the ${what}:`, err));
}

/** Opens Explorer on a folder, through the opener plugin. */
export function revealFolder(path: string) {
  revealItemInDir(path).catch((err) => console.error("Failed to open the folder in Explorer:", err));
}
