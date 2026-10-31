import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommitDetails, CommitFiles, Verification } from "./commitDetails";
import type { FileDiff } from "./diffDoc";
import { errorMessage } from "./gitVersion";
import { RequestIds } from "./refreshTable";
import { SettledLoader, type LoadState } from "./settledLoader";

/** How long the selection must hold still before its details are read (#368). */
export const DETAILS_DELAY_MS = 120;
/** How many commits' details stay cached (#368). */
export const DETAILS_CACHE = 200;

const BROWSER_TIMERS = {
  set: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clear: (handle: unknown) => window.clearTimeout(handle as number),
};

const EMPTY: LoadState<CommitDetails> = { key: null, shown: null, shownKey: null, pending: false, error: null };

/**
 * The selected commit's details (#397): read 120 ms after the selection settles, with stale
 * answers dropped and up to 200 commits cached per repo. While a new commit loads, the previous
 * one stays in `shown` with `pending` set, so the inspector can dim it. The wait is cleared when
 * the repo changes or the inspector unmounts.
 */
export function useCommitDetails(repoPath: string | null, oid: string | null): LoadState<CommitDetails> {
  const [state, setState] = useState<LoadState<CommitDetails>>(EMPTY);
  const loader = useRef<SettledLoader<CommitDetails> | null>(null);

  useEffect(() => {
    if (repoPath === null) return;
    const next = new SettledLoader<CommitDetails>({
      fetch: (key) => invoke<CommitDetails>("git_commit_details", { repoPath, oid: key }),
      delayMs: DETAILS_DELAY_MS,
      capacity: DETAILS_CACHE,
      timers: BROWSER_TIMERS,
      onState: setState,
      describe: errorMessage,
    });
    loader.current = next;
    return () => {
      next.dispose();
      loader.current = null;
      setState(EMPTY);
    };
  }, [repoPath]);

  useEffect(() => {
    loader.current?.select(oid);
  }, [oid, repoPath]);

  return state;
}

export type FilesState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; files: CommitFiles }
  | { state: "failed"; message: string };

/**
 * The files of the commit `oid`, against its parent `parentIndex` (from 1), once its details have
 * arrived. Each read carries a request id, so an answer for an older commit or parent never lands.
 */
export function useCommitFiles(repoPath: string | null, oid: string | null, parentIndex: number): FilesState {
  const [files, setFiles] = useState<FilesState>({ state: "idle" });
  const ids = useRef(new RequestIds());
  useEffect(() => {
    const id = ids.current.next();
    if (repoPath === null || oid === null) {
      setFiles({ state: "idle" });
      return;
    }
    setFiles({ state: "loading" });
    invoke<CommitFiles>("git_commit_files", { repoPath, oid, parentIndex }).then(
      (out) => ids.current.isLatest(id) && setFiles({ state: "done", files: out }),
      (e: unknown) => ids.current.isLatest(id) && setFiles({ state: "failed", message: errorMessage(e) })
    );
  }, [repoPath, oid, parentIndex]);
  return files;
}

export type VerifyState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "done"; result: Verification }
  | { state: "failed"; message: string };

/** The Signed chip's Verify (#397): `git_verify_commit` only when asked, reset for each commit. */
export function useVerifyCommit(repoPath: string | null, oid: string | null): { verify: VerifyState; run: () => void } {
  const [verify, setVerify] = useState<VerifyState>({ state: "idle" });
  const ids = useRef(new RequestIds());
  useEffect(() => {
    ids.current.next();
    setVerify({ state: "idle" });
  }, [repoPath, oid]);
  const run = useCallback(() => {
    if (repoPath === null || oid === null) return;
    const id = ids.current.next();
    setVerify({ state: "checking" });
    invoke<Verification>("git_verify_commit", { repoPath, oid }).then(
      (result) => ids.current.isLatest(id) && setVerify({ state: "done", result }),
      (e: unknown) => ids.current.isLatest(id) && setVerify({ state: "failed", message: errorMessage(e) })
    );
  }, [repoPath, oid]);
  return { verify, run };
}

/** A commit file open in the read-only diff (#397): the commit, the parent it is diffed against, and the file. */
export interface OpenCommitFile {
  oid: string;
  /** The parent's oid, or null for a root commit, diffed against the empty tree. */
  parent: string | null;
  /** Which parent, from 1, for the header. */
  parentIndex: number;
  path: string;
  oldPath: string | null;
  status: string;
}

export type CommitDiffState = { state: "loading" } | { state: "done"; diff: FileDiff } | { state: "failed"; message: string };

/** The context lines a commit file's diff is read with, as for the staging diff. */
const CONTEXT = 3;

/** The open commit file's diff, through #383's `git_file_diff` on a commit side, with request ids. */
export function useCommitDiff(
  repoPath: string | null,
  file: OpenCommitFile | null
): { diff: CommitDiffState; loadedLarge: boolean; loadLarge: () => void; reload: () => void } {
  const [diff, setDiff] = useState<CommitDiffState>({ state: "loading" });
  const [loadedLarge, setLoadedLarge] = useState(false);
  const ids = useRef(new RequestIds());
  const key = repoPath === null || file === null ? null : `${repoPath}\n${file.oid}\n${file.parent ?? ""}\n${file.path}`;
  const latest = useRef({ repoPath, file });
  latest.current = { repoPath, file };

  const read = useCallback((large: boolean) => {
    const { repoPath: repo, file: open } = latest.current;
    const id = ids.current.next();
    if (repo === null || open === null) return;
    invoke<FileDiff>("git_file_diff", {
      worktreePath: repo,
      requestId: id,
      path: open.path,
      side: { kind: "commit", oid: open.oid, parent: open.parent },
      context: CONTEXT,
      loadLarge: large,
    }).then(
      (next) => ids.current.isLatest(id) && setDiff({ state: "done", diff: next }),
      (e: unknown) => ids.current.isLatest(id) && setDiff({ state: "failed", message: errorMessage(e) })
    );
  }, []);

  useEffect(() => {
    setDiff({ state: "loading" });
    setLoadedLarge(false);
    read(false);
  }, [key, read]);

  const loadLarge = useCallback(() => {
    setLoadedLarge(true);
    read(true);
  }, [read]);
  const reload = useCallback(() => read(loadedLarge), [read, loadedLarge]);
  return { diff, loadedLarge, loadLarge, reload };
}
