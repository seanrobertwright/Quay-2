import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./gitVersion";
import type { GitRefs } from "./graphRefs";

export type RefsState =
  | { state: "idle" }
  | { state: "done"; repoPath: string; refs: GitRefs }
  | { state: "failed"; repoPath: string; message: string };

/**
 * The refs of `repoPath` (#378), read with `git_refs` apart from the graph session, so badges
 * refresh without re-running the walk. They are read again whenever `readCount` changes, such as
 * each time Topos is shown. Only the newest read may set the result.
 */
export function useGraphRefs(repoPath: string | null, readCount: number): RefsState {
  const [result, setResult] = useState<RefsState>({ state: "idle" });
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    if (repoPath === null) {
      setResult({ state: "idle" });
      return;
    }
    invoke<GitRefs>("git_refs", { repoPath })
      .then((refs) => {
        if (id === requestId.current) setResult({ state: "done", repoPath, refs });
      })
      .catch((e: unknown) => {
        if (id === requestId.current) setResult({ state: "failed", repoPath, message: errorMessage(e) });
      });
  }, [repoPath, readCount]);

  // Refs read for another repo are never handed out, not even for the render before a new read.
  return result.state !== "idle" && result.repoPath !== repoPath ? { state: "idle" } : result;
}
