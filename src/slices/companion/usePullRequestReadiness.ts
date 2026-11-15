import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PullRequestReadiness } from "../github/types.ts";

/** Where a pull request lives: the folder `gh` runs in, and the slot's repository when it names one. */
export interface PullRequestLocation {
  repoPath: string;
  /** `owner/name`, or null for the repository at `repoPath`. */
  repo: string | null;
  number: number;
}

/** The pull request as last read, and whether a read is under way or failed. */
export interface PullRequestReadinessState {
  pr: PullRequestReadiness | null;
  loading: boolean;
  error: string | null;
  /** Reads the pull request again, as after a merge. */
  reload: () => void;
}

/** The message in a rejected `invoke`, which Tauri delivers as a string. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Reads the pull request at `location` through `get_github_pr_readiness`, again whenever the
 * location changes or `reload` is called. An answer to a read that a newer one replaced, or that
 * arrives after unmount, is dropped. Until a new location's first answer arrives, the last pull
 * request read stays, so a caller that shows another pull request remounts the hook by key.
 */
export function usePullRequestReadiness({ repoPath, repo, number }: PullRequestLocation): PullRequestReadinessState {
  const [pr, setPr] = useState<PullRequestReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    // Set when a newer read replaces this one or the hook unmounts.
    let stale = false;
    setLoading(true);
    invoke<PullRequestReadiness>("get_github_pr_readiness", { repoPath, repo, number })
      .then((next) => {
        if (stale) return;
        setPr(next);
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
  }, [repoPath, repo, number, generation]);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { pr, loading, error, reload };
}
