// A workflow template's Runs list for the Runs view (#452). One list per project and template,
// made when the view mounts and disposed, with its call and timer, when the view unmounts or
// turns to another project or template. The poller runs only while `onScreen` holds and the
// window is shown: the builder only hides when it closes, so the caller says when it is shown.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRunsList, INITIAL_RUNS_VIEW, type RunsList, type RunsListView } from "./runsList.ts";
import { useDocumentVisible } from "./useDocumentVisible.ts";

const noList = () => () => {};

export function useRunsList(projectPath: string, name: string, onScreen: boolean): { list: RunsList | null; view: RunsListView } {
  const [list, setList] = useState<RunsList | null>(null);
  useEffect(() => {
    const made = createRunsList({ projectPath, name });
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

  const view = useSyncExternalStore(
    list ? list.subscribe : noList,
    () => list?.view() ?? INITIAL_RUNS_VIEW,
  );
  return { list, view };
}
