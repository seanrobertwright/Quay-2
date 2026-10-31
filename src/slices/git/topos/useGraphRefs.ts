import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./gitVersion";
import type { GitRefs } from "./graphRefs";
import { RequestIds } from "./refreshTable";

export type RefsState =
  | { state: "idle" }
  | { state: "done"; repoPath: string; refs: GitRefs }
  | { state: "failed"; repoPath: string; message: string };

export interface GraphRefsReader {
  refs: RefsState;
  /**
   * Reads the refs again, as a refresh does (#379). Resolves to what it read, or null when the
   * read failed or a newer read overtook it.
   */
  reload: () => Promise<GitRefs | null>;
  /**
   * Shows `refs`, which a ref operation on `repoPath` returned (#393), at once rather than after
   * the watcher's refresh. It overtakes any read in flight.
   */
  accept: (repoPath: string, refs: GitRefs) => void;
}

/**
 * The refs of `repoPath` (#378), read with `git_refs` apart from the graph session, so badges
 * refresh without re-running the walk. They are read again whenever `readCount` changes, such as
 * each time Topos is shown, and on `reload`. Only the newest read may set the result.
 */
export function useGraphRefs(repoPath: string | null, readCount: number): GraphRefsReader {
  const [result, setResult] = useState<RefsState>({ state: "idle" });
  const ids = useRef(new RequestIds());

  const read = useCallback((path: string | null): Promise<GitRefs | null> => {
    const id = ids.current.next();
    if (path === null) {
      setResult({ state: "idle" });
      return Promise.resolve(null);
    }
    return invoke<GitRefs>("git_refs", { repoPath: path }).then(
      (refs) => {
        if (!ids.current.isLatest(id)) return null;
        setResult({ state: "done", repoPath: path, refs });
        return refs;
      },
      (e: unknown) => {
        if (ids.current.isLatest(id)) setResult({ state: "failed", repoPath: path, message: errorMessage(e) });
        return null;
      }
    );
  }, []);

  useEffect(() => {
    void read(repoPath);
  }, [repoPath, readCount, read]);

  const reload = useCallback(() => read(repoPath), [read, repoPath]);
  const accept = useCallback((path: string, refs: GitRefs) => {
    ids.current.next();
    setResult({ state: "done", repoPath: path, refs });
  }, []);

  // Refs read for another repo are never handed out, not even for the render before a new read.
  const refs = result.state !== "idle" && result.repoPath !== repoPath ? ({ state: "idle" } as const) : result;
  return { refs, reload, accept };
}
