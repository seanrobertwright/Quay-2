// A followed run's detail for a Runs view (#453, #465). One follow per project and work order,
// made when the detail mounts and disposed, with its call and timer, when it unmounts or turns to
// another run. Like the Runs list, it polls only while `onScreen` holds and the window is shown.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRunFollow, INITIAL_FOLLOW_VIEW, TEMPLATE_RUN, type FollowedRun, type FollowSource, type RunDetail, type RunFollow, type RunFollowView } from "./runDetail.ts";
import type { RunRow } from "./runsList.ts";
import { useDocumentVisible } from "./useDocumentVisible.ts";

const noFollow = () => () => {};

export function useRunDetail(projectPath: string, workOrderId: string, row: RunRow | null, onScreen: boolean): RunFollowView<RunDetail>;
/**
 * The run `source` reads, a template run when absent. `source` is a module-level source, such as
 * `TEMPLATE_RUN` or `GRAPH_RUN`: a new object would make a new follow each render.
 */
export function useRunDetail<Run extends FollowedRun>(
  projectPath: string,
  workOrderId: string,
  row: RunRow | null,
  onScreen: boolean,
  source: FollowSource<Run>,
): RunFollowView<Run>;
export function useRunDetail(
  projectPath: string,
  workOrderId: string,
  row: RunRow | null,
  onScreen: boolean,
  source: FollowSource<FollowedRun> = TEMPLATE_RUN,
): RunFollowView<FollowedRun> {
  const [follow, setFollow] = useState<RunFollow<FollowedRun> | null>(null);
  useEffect(() => {
    const made = createRunFollow({ projectPath, workOrderId, source });
    setFollow(made);
    return () => made.dispose();
  }, [projectPath, workOrderId, source]);

  useEffect(() => follow?.setRow(row), [follow, row]);

  const visible = useDocumentVisible();
  const active = onScreen && visible;
  useEffect(() => {
    if (!follow) return;
    follow.set(active);
    return () => follow.set(false);
  }, [follow, active]);

  return useSyncExternalStore(follow ? follow.subscribe : noFollow, () => follow?.view() ?? INITIAL_FOLLOW_VIEW);
}
