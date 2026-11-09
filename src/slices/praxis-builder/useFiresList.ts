// A graph trigger's Fires list for its Fires panel (#478). One list per project and trigger, made
// when the panel mounts and disposed, with its call and timer, when it unmounts or turns to another
// project or trigger. It polls only while `onScreen` holds and the window is shown (`usePolledList`).
import { useCallback } from "react";
import { createFiresList, INITIAL_FIRES_VIEW, type FiresList, type FiresListView } from "./firesList.ts";
import { usePolledList } from "./usePolledList.ts";

/** The fires of graph trigger `name`, polled while `onScreen` holds and the window is shown. */
export function useFiresList(projectPath: string, name: string, onScreen: boolean): { list: FiresList | null; view: FiresListView } {
  const make = useCallback(() => createFiresList({ projectPath, name }), [projectPath, name]);
  return usePolledList(make, INITIAL_FIRES_VIEW, onScreen);
}
