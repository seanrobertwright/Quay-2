// A Runs list for a Runs view (#452, #464). One list per project and record, made when the view
// mounts and disposed, with its call and timer, when the view unmounts or turns to another
// project or record. It polls only while `onScreen` holds and the window is shown (`usePolledList`).
import { useCallback } from "react";
import { createRunsList, INITIAL_RUNS_VIEW, TEMPLATE_RUNS, type RunsList, type RunsListView, type RunsSource } from "./runsList.ts";
import { usePolledList } from "./usePolledList.ts";

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
  const make = useCallback(() => createRunsList({ projectPath, name, source }), [projectPath, name, source]);
  return usePolledList(make, INITIAL_RUNS_VIEW, onScreen);
}
