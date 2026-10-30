import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isSamePath } from "../../../utils/paths";
import type { GitRefs } from "./graphRefs";
import {
  ALL_DIRTY,
  graphNeeded,
  planRefresh,
  RefreshQueue,
  tipOids,
  type Dirty,
  type RepoChanged,
} from "./refreshTable";
import type { GraphSession } from "./useGraphSession";
import type { GraphRefsReader } from "./useGraphRefs";

export interface LiveUpdatesTarget {
  /** The repo whose graph session is live. */
  repoPath: string;
  /** The selected worktree, whose HEAD, index and files the watch follows. */
  worktreePath: string;
}

/** The selected worktree's HEAD in `refs`, or null when it has none. */
function headOf(refs: GitRefs, worktreePath: string): string | null {
  return refs.worktrees.find((w) => isSamePath(w.path, worktreePath))?.oid ?? null;
}

/**
 * Keeps Topos current by itself (#354, #379). It points the graph session's watch at the selected
 * worktree, watching files only while Topos is `visible`, and runs the refresh table on each
 * `git-repo-changed` for it, one refresh at a time. While live updates are off it compares a
 * fingerprint of the repo on window focus and on show instead. Returns Retry for the marker.
 */
export function useLiveUpdates(
  target: LiveUpdatesTarget | null,
  visible: boolean,
  graph: GraphSession,
  refs: GraphRefsReader
): () => void {
  const sessionId = graph.feed?.sessionId ?? null;
  const watchState = graph.feed?.watch?.state ?? null;
  // The handlers below outlive renders, so they read the newest of these through refs.
  const latest = useRef({ graph, refs, target });
  latest.current = { graph, refs, target };
  const operation = useRef({ inOperation: false, graphHeld: false });

  const queue = useRef<RefreshQueue | null>(null);
  if (queue.current === null) {
    queue.current = new RefreshQueue(async (dirty: Dirty) => {
      const { graph, refs, target } = latest.current;
      const store = graph.feed?.store ?? null;
      if (target === null || store === null) return;
      const plan = planRefresh(dirty, operation.current);
      if (plan.holdGraph) operation.current.graphHeld = true;
      if (plan.graph === "yes") operation.current.graphHeld = false;
      // Status, the open diff and the operation banner join here as the inspector (#382, #383)
      // and the conflict banner (#389) land; each fetch carries a request id from `RequestIds`.
      if (!plan.refs) return;
      const before = refs.refs.state === "done" ? tipOids(refs.refs.refs) : null;
      const after = await refs.reload();
      const run =
        plan.graph === "yes" ||
        (after !== null &&
          graphNeeded(plan.graph, {
            tipsBefore: before,
            tipsAfter: tipOids(after),
            headOid: headOf(after, target.worktreePath),
            isLoaded: (oid) => store.rowOf(oid) !== -1,
          }));
      if (run) await graph.refresh();
    });
  }

  const watch = useCallback(() => {
    if (target === null) return;
    void graph.watch(target.worktreePath, visible);
  }, [graph, target, visible]);

  // Each show is a retarget: the watch follows the selection and visibility, and a watch that is
  // off gets one more try.
  const repoPath = target?.repoPath ?? null;
  const worktreePath = target?.worktreePath ?? null;
  useEffect(() => {
    if (sessionId === null || worktreePath === null) return;
    void latest.current.graph.watch(worktreePath, visible);
  }, [sessionId, worktreePath, visible]);

  useEffect(() => {
    if (repoPath === null || worktreePath === null) return;
    let live = true;
    const unlisten = listen<RepoChanged>("git-repo-changed", ({ payload }) => {
      if (!live || !isSamePath(payload.repoRoot, repoPath) || !isSamePath(payload.worktreePath, worktreePath)) return;
      operation.current.inOperation = payload.inOperation;
      queue.current?.request(payload.dirty);
    });
    return () => {
      live = false;
      void unlisten.then((stop) => stop());
    };
  }, [repoPath, worktreePath]);

  // With live updates off, a fingerprint of refs, HEAD and the index stands in for the watch.
  const fingerprint = useRef<string | null>(null);
  const checkFingerprint = useCallback(() => {
    if (worktreePath === null) return;
    invoke<string>("git_repo_fingerprint", { worktreePath })
      .then((next) => {
        const changed = fingerprint.current !== null && fingerprint.current !== next;
        fingerprint.current = next;
        if (changed) queue.current?.request(ALL_DIRTY);
      })
      .catch(console.error);
  }, [worktreePath]);
  // The baseline is taken when live updates go off, and kept across hides and shows.
  useEffect(() => {
    fingerprint.current = null;
    if (watchState === "off") checkFingerprint();
  }, [watchState, checkFingerprint]);
  useEffect(() => {
    if (watchState !== "off" || !visible) return;
    if (fingerprint.current !== null) checkFingerprint();
    window.addEventListener("focus", checkFingerprint);
    return () => window.removeEventListener("focus", checkFingerprint);
  }, [watchState, visible, checkFingerprint]);

  return watch;
}
