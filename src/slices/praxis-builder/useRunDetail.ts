// A followed run's detail for the Runs view (#453). One follow per project and work order, made
// when the detail mounts and disposed, with its call and timer, when it unmounts or turns to
// another run. Like the Runs list, it polls only while `onScreen` holds and the window is shown.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRunFollow, INITIAL_FOLLOW_VIEW, type RunFollowView } from "./runDetail.ts";
import type { RunRow } from "./runsList.ts";
import { useDocumentVisible } from "./useDocumentVisible.ts";

const noFollow = () => () => {};

export function useRunDetail(projectPath: string, workOrderId: string, row: RunRow | null, onScreen: boolean): RunFollowView {
  const [follow, setFollow] = useState<ReturnType<typeof createRunFollow> | null>(null);
  useEffect(() => {
    const made = createRunFollow({ projectPath, workOrderId });
    setFollow(made);
    return () => made.dispose();
  }, [projectPath, workOrderId]);

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
