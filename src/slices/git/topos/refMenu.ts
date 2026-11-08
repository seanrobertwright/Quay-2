// The badge and commit-row menus (#367, #393) as the shared context menu shows them (#510): an
// adapter from Topos's own menu items to the shared menu's.

import type { ContextMenuItem } from "../../overlay/ContextMenu.tsx";
import type { MenuItem, RefAction } from "./refActions.ts";

/**
 * A badge's or a commit row's menu items as the shared context menu shows them: in order, in one
 * group, a disabled item with its reason as its hint. Choosing an enabled item runs its action.
 */
export function refMenuItems(items: readonly MenuItem[], run: (action: RefAction) => void): ContextMenuItem[] {
  return items.map((item) => {
    const { action } = item;
    return action === null
      ? { name: item.label, enabled: false, group: "ref", hint: item.disabledReason, onChoose: () => {} }
      : { name: item.label, enabled: true, group: "ref", onChoose: () => run(action) };
  });
}
