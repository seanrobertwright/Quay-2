// The Merge undo window as a hook any Merge button can start: the pie's Merge stroke and the
// Projects panel lane's Merge. It holds the window (mergeUndo.ts), ticks it
// each second, and when it ends merges through `merge_github_pr` with the pull request view's
// defaults (readiness.ts `mergeArgs`). The toast that shows it is `MergeUndoToast`.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MergeMethod, PullRequestReadiness } from "../github/types.ts";
import { IDLE, mergeUndoSecondsLeft, stepMergeUndo, type MergeUndoEvent, type MergeUndoState } from "./mergeUndo.ts";
import { mergeArgs, mergeWarning, type MergeOutcome } from "./readiness.ts";
import { errorText, type PullRequestLocation } from "./usePullRequestReadiness.ts";

/** A merge to run: the pull request, as it was read when the Merge was asked for, and the method. */
export interface MergeJob {
  location: PullRequestLocation;
  pr: PullRequestReadiness;
  method: MergeMethod;
}

/** What came of the merge a window ran: merged (perhaps with a warning), or why it failed. */
export interface MergeResult {
  job: MergeJob;
  ok: boolean;
  text: string;
}

/** The Merge undo window as its toast and its callers see it. */
export interface MergeUndo {
  /** The merge counting down and the whole seconds it has left, or null. */
  pending: { job: MergeJob; secondsLeft: number } | null;
  /** The merge running now, once its window ended, or null. */
  running: MergeJob | null;
  /** What came of the last merge, until it is dismissed or another Merge starts. */
  result: MergeResult | null;
  /** Starts the window for `job`; with the window Off, asks the caller's confirm step instead. */
  start: (job: MergeJob) => void;
  cancel: () => void;
  dismiss: () => void;
}

interface MergeUndoCallbacks {
  /** Opens the pull request view's confirm step for `job`, when the window is Off. */
  onConfirm: (job: MergeJob) => void;
  /** Called once `job` has merged, so its pull request can be read again. */
  onMerged?: (job: MergeJob) => void;
}

/** The Merge undo window of `seconds` (the Merge undo window setting; 0 is Off). */
export function useMergeUndo(seconds: number, callbacks: MergeUndoCallbacks): MergeUndo {
  const [state, setState] = useState<MergeUndoState<MergeJob>>(IDLE);
  const [now, setNow] = useState(() => Date.now());
  const [running, setRunning] = useState<MergeJob | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  // Read by the timer and by `start`, which must see the window as it is, not as last rendered.
  const current = useRef(state);
  const latest = useRef({ seconds, callbacks });
  latest.current = { seconds, callbacks };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const merge = useCallback(async (job: MergeJob) => {
    setRunning(job);
    try {
      const outcome = await invoke<MergeOutcome>("merge_github_pr", { ...mergeArgs(job.location, job.pr, job.method) });
      if (!alive.current) return;
      setResult({ job, ok: true, text: mergeWarning(outcome) ?? `Merged #${job.location.number}.` });
      latest.current.callbacks.onMerged?.(job);
    } catch (e) {
      if (alive.current) setResult({ job, ok: false, text: `Merge #${job.location.number} failed: ${errorText(e)}` });
    } finally {
      if (alive.current) setRunning(null);
    }
  }, []);

  const dispatch = useCallback(
    (event: MergeUndoEvent<MergeJob>) => {
      const next = stepMergeUndo(current.current, event);
      current.current = next.state;
      setState(next.state);
      if (next.effect?.run === "merge") void merge(next.effect.job);
      if (next.effect?.run === "confirm") latest.current.callbacks.onConfirm(next.effect.job);
    },
    [merge],
  );

  // While a window counts, wake at each whole second to redraw the count, and at its end to merge.
  useEffect(() => {
    if (state.phase !== "counting") return;
    const left = state.endsAt - Date.now();
    const timer = setTimeout(() => {
      const at = Date.now();
      setNow(at);
      dispatch({ type: "tick", at });
    }, Math.max(0, left % 1000 || 1000));
    return () => clearTimeout(timer);
  }, [state, now, dispatch]);

  const start = useCallback(
    (job: MergeJob) => {
      const at = Date.now();
      if (current.current.phase === "idle") setResult(null);
      setNow(at);
      dispatch({ type: "start", job, seconds: latest.current.seconds, at });
    },
    [dispatch],
  );
  const cancel = useCallback(() => dispatch({ type: "cancel" }), [dispatch]);
  const dismiss = useCallback(() => setResult(null), []);

  return {
    pending: state.phase === "counting" ? { job: state.job, secondsLeft: mergeUndoSecondsLeft(state, now) } : null,
    running,
    result,
    start,
    cancel,
    dismiss,
  };
}
