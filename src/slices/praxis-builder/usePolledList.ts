// The React side of a polled list: the Runs list (#452, #464) or a graph trigger's Fires list
// (#478). The hook makes one list from `make`, and disposes it, with its call and timer, on unmount
// or when `make` changes. The list polls only while `onScreen` holds and the window is shown: the
// builder only hides when it closes, so the caller says when the list is on screen.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useDocumentVisible } from "./useDocumentVisible.ts";

/** What the hook needs from a list model. */
export interface PolledList<V> {
  /** The list is on screen, or has left it. Leaving stops its poller and kills its call. */
  set(onScreen: boolean): void;
  view(): V;
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Stops for good, killing every call in flight. */
  dispose(): void;
}

const noList = () => () => {};

/**
 * The list `make` creates and its view, `initial` until the list exists. `make` must keep its
 * identity across renders (a `useCallback` on the list's inputs): a new one makes a new list.
 */
export function usePolledList<L extends PolledList<V>, V>(make: () => L, initial: V, onScreen: boolean): { list: L | null; view: V } {
  const [list, setList] = useState<L | null>(null);
  useEffect(() => {
    const made = make();
    setList(made);
    return () => made.dispose();
  }, [make]);

  const visible = useDocumentVisible();
  const active = onScreen && visible;
  useEffect(() => {
    if (!list) return;
    list.set(active);
    return () => list.set(false);
  }, [list, active]);

  const view = useSyncExternalStore(list ? list.subscribe : noList, () => list?.view() ?? initial);
  return { list, view };
}
