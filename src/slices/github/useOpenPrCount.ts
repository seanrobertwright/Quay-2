import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** How often the open pull request count refreshes, in ms. */
const REFRESH_MS = 5 * 60_000;

/**
 * How many pull requests are open on the repository at `repoPath`, refreshed every five
 * minutes and whenever the path changes. Null while unknown: before the first answer, with no
 * repository, or while `gh` has never answered for this path (no GitHub remote, not signed
 * in). A later failure keeps the last count. A late answer for an earlier path is dropped.
 */
export function useOpenPrCount(repoPath: string): number | null {
  const [count, setCount] = useState<{ repoPath: string; count: number | null }>({ repoPath, count: null });

  useEffect(() => {
    if (!repoPath) return;
    let live = true;
    const load = () =>
      invoke<number>("count_open_github_prs", { repoPath })
        .then((n) => live && setCount({ repoPath, count: n }))
        // A failed refresh keeps the count already known for this path, so a brief network
        // error does not hide the badge until the next refresh.
        .catch(() => live && setCount((prev) => (prev.repoPath === repoPath ? prev : { repoPath, count: null })));
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [repoPath]);

  return repoPath && count.repoPath === repoPath ? count.count : null;
}
