// How the menu builders' tests write a menu down, so one assertion pins its items, their order,
// hints, toggles and groups.
import type { ContextMenuItem } from "../slices/overlay/ContextMenu.tsx";

/** Each item as `name`, `name [hint]`, `name (disabled: why)` or `[x] name`, with `---` between groups. */
export function shownMenu(items: readonly Omit<ContextMenuItem, "onChoose">[]): string[] {
  const out: string[] = [];
  items.forEach((item, i) => {
    if (i > 0 && items[i - 1].group !== item.group) out.push("---");
    const box = item.checked === undefined ? "" : item.checked ? "[x] " : "[ ] ";
    const tail = !item.enabled ? ` (disabled: ${item.hint})` : item.hint ? ` [${item.hint}]` : "";
    out.push(`${box}${item.name}${tail}`);
  });
  return out;
}
