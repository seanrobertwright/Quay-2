import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PullRequestReadiness } from "../github/types.ts";
import type { PullRequestLocation } from "./usePullRequestReadiness.ts";

/** The selected terminal's pull request as last read, with where it lives. */
export interface SelectedPullRequest {
  location: PullRequestLocation;
  pr: PullRequestReadiness;
}

const keyOf = (location: PullRequestLocation) => `${location.repoPath}|${location.repo ?? ""}#${location.number}`;

/**
 * Reads the pull request at `location` (the selected terminal's, or null when it has none) through
 * `get_github_pr_readiness`, again whenever the location changes or `reload` is called. Unlike the
 * pull request view's read, an answer for an earlier location is never handed out for a later one,
 * so a Merge always acts on the pull request it was read for. A failed read gives null.
 */
export function useSelectedPullRequest(location: PullRequestLocation | null): { selected: SelectedPullRequest | null; reload: () => void } {
  const [answer, setAnswer] = useState<{ key: string; selected: SelectedPullRequest | null } | null>(null);
  const [generation, setGeneration] = useState(0);
  const repoPath = location?.repoPath ?? null;
  const repo = location?.repo ?? null;
  const number = location?.number ?? null;
  const key = repoPath !== null && number !== null ? keyOf({ repoPath, repo, number }) : null;
  useEffect(() => {
    if (repoPath === null || number === null || key === null) return;
    let stale = false;
    const at = { repoPath, repo, number };
    invoke<PullRequestReadiness>("get_github_pr_readiness", at)
      .then((pr) => {
        if (!stale) setAnswer({ key, selected: { location: at, pr } });
      })
      .catch(() => {
        if (!stale) setAnswer({ key, selected: null });
      });
    return () => {
      stale = true;
    };
  }, [key, repoPath, repo, number, generation]);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { selected: answer && answer.key === key ? answer.selected : null, reload };
}
