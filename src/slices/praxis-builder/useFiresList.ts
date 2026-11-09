// A graph trigger's Fires list for its Fires panel (#478). One list per project and trigger, made
// when the panel mounts and disposed, with its call and timer, when it unmounts or turns to another
// project or trigger. The poller runs only while `onScreen` holds and the window is shown, as a
// Runs list's does (`useRunsList`): the builder only hides when it closes, so the caller says when
// the panel is shown.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createFiresList, INITIAL_FIRES_VIEW, type FiresList, type FiresListView } from "./firesList.ts";
import { useDocumentVisible } from "./useDocumentVisible.ts";

const noList = () => () => {};

/** The fires of graph trigger `name`, polled while `onScreen` holds and the window is shown. */
export function useFiresList(projectPath: string, name: string, onScreen: boolean): { list: FiresList | null; view: FiresListView } {
  const [list, setList] = useState<FiresList | null>(null);
  useEffect(() => {
    const made = createFiresList({ projectPath, name });
    setList(made);
    return () => made.dispose();
  }, [projectPath, name]);

  const visible = useDocumentVisible();
  const active = onScreen && visible;
  useEffect(() => {
    if (!list) return;
    list.set(active);
    return () => list.set(false);
  }, [list, active]);

  const view = useSyncExternalStore(list ? list.subscribe : noList, () => list?.view() ?? INITIAL_FIRES_VIEW);
  return { list, view };
}
