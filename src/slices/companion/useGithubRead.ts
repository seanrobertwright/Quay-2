import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorText } from "./usePullRequestReadiness.ts";

/** What a read of GitHub last answered, and whether one is under way or failed. */
export interface GithubRead<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Reads again, as after posting a comment. */
  reload: () => void;
}

/**
 * Reads `command` with `args` through `invoke`, again whenever `args` changes in value or `reload`
 * is called. An answer to a read that a newer one replaced, or that arrives after unmount, is
 * dropped. The last answer stays while a new read is under way.
 */
export function useGithubRead<T>(command: string, args: Record<string, unknown>): GithubRead<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  // The read reruns on a change in what is asked for, not on a new object with the same values.
  const key = JSON.stringify(args);
  useEffect(() => {
    let stale = false;
    setLoading(true);
    invoke<T>(command, JSON.parse(key) as Record<string, unknown>)
      .then((next) => {
        if (stale) return;
        setData(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!stale) setError(errorText(e));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [command, key, generation]);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { data, loading, error, reload };
}
