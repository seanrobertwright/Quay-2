// A Runs list for a Runs view (#452, #464). One list per project and record, made when the view
// mounts and disposed, with its call and timer, when the view unmounts or turns to another
// project or record. The poller runs only while `onScreen` holds and the
// window is shown: the builder only hides when it closes, so the caller says when it is shown.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRunsList, INITIAL_RUNS_VIEW, TEMPLATE_RUNS, type RunsList, type RunsListView, type RunsSource } from "./runsList.ts";
import { useDocumentVisible } from "./useDocumentVisible.ts";

const noList = () => () => {};

/**
 * The runs of `name` that `source` lists, a workflow template's when absent. `source` is one of
 * runsList.ts's sources, `TEMPLATE_RUNS` or `GRAPH_RUNS`: a new object would make a new list each render.
 */
export function useRunsList(
  projectPath: string,
  name: string,
  onScreen: boolean,
  source: RunsSource = TEMPLATE_RUNS,
): { list: RunsList | null; view: RunsListView } {
  const [list, setList] = useState<RunsList | null>(null);
  useEffect(() => {
    const made = createRunsList({ projectPath, name, source });
    setList(made);
    return () => made.dispose();
  }, [projectPath, name, source]);

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
