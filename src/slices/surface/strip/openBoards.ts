// Which board of each terminal is open over it. It is kept here, so a pane that comes back to the screen
// is as it was left, and a board can be opened from outside its pane.
import { useSyncExternalStore } from "react";
import { surfaceKey } from "../surfaceAttention.ts";
import { surfacesByTerminal } from "../surfaceHost.ts";
import type { SurfaceKey, SurfaceRecord } from "../surfaceTypes.ts";

/** By terminal, the key of its open board. */
const open = new Map<string, string>();
const subscribers = new Set<() => void>();

const subscribe = (changed: () => void) => {
  subscribers.add(changed);
  return () => void subscribers.delete(changed);
};

/** Opens `record` over its terminal in place of the one that is, or folds the one that is when null. */
export function setOpenBoard(terminalId: string, record: SurfaceRecord | null): void {
  // A terminal that has no surfaces left may have closed
  for (const id of open.keys()) if (!surfacesByTerminal().has(id)) open.delete(id);
  if (record) open.set(terminalId, surfaceKey(record));
  else open.delete(terminalId);
  for (const subscriber of subscribers) subscriber();
}

/** Opens the surface `key` over its terminal, if it is one on its strip. Says whether it is. */
export function openBoard({ terminal_id, id }: SurfaceKey): boolean {
  const record = surfacesByTerminal().get(terminal_id)?.find((surface) => surface.id === id);
  if (record?.place !== "strip") return false;
  setOpenBoard(terminal_id, record);
  return true;
}

/** The key of `terminalId`'s open board, as `surfaceKey` gives it. The board may have left since. */
export const useOpenBoard = (terminalId: string): string | null => useSyncExternalStore(subscribe, () => open.get(terminalId) ?? null);
