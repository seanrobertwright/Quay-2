// A followed run's detail for a Runs view (#453, #465). One follow per project, work order and kind,
// made when the detail mounts and disposed, with its call and timer, when it unmounts or turns to
// another run. Like the Runs list, it polls only while `onScreen` holds and the window is shown.
import { useEffect, useState, useSyncExternalStore } from "react";
import { GRAPH_RUN, type GraphRunDetail } from "./graphRunDetail.ts";
import { createRunFollow, INITIAL_FOLLOW_VIEW, TEMPLATE_RUN, type FollowedRun, type RunDetail, type RunFollow, type RunFollowView } from "./runDetail.ts";
import type { RunRow } from "./runsList.ts";
import { useDocumentVisible } from "./useDocumentVisible.ts";

const noFollow = () => () => {};

/** The kinds of run a detail follows, each read by its own source. */
const SOURCES = { template: TEMPLATE_RUN, graph: GRAPH_RUN } as const;
type RunKind = keyof typeof SOURCES;

/** A template run's detail, or a graph run's when `kind` says so. */
export function useRunDetail(projectPath: string, workOrderId: string, row: RunRow | null, onScreen: boolean, kind?: "template"): RunFollowView<RunDetail>;
export function useRunDetail(projectPath: string, workOrderId: string, row: RunRow | null, onScreen: boolean, kind: "graph"): RunFollowView<GraphRunDetail>;
export function useRunDetail(
  projectPath: string,
  workOrderId: string,
  row: RunRow | null,
  onScreen: boolean,
  kind: RunKind = "template",
): RunFollowView<FollowedRun> {
  const [follow, setFollow] = useState<RunFollow<FollowedRun> | null>(null);
  useEffect(() => {
    const made = createRunFollow<FollowedRun>({ projectPath, workOrderId, source: SOURCES[kind] });
    setFollow(made);
    return () => made.dispose();
  }, [projectPath, workOrderId, kind]);

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
