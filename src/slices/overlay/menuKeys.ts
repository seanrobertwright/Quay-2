// The keys that open a context menu (#507). Kept free of React so pure key routers, such as the
// terminal's, can use it without loading the hook module.

/** Whether a keydown opens a context menu: Shift+F10 or the Menu key, with no other modifier. */
export function isContextMenuKey(e: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  return (e.key === "F10" && e.shiftKey) || e.key === "ContextMenu";
}
