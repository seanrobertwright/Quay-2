import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommitDetails, CommitFiles, CompareFiles, CompareOrder, ComparedPair, FileStatus, Verification } from "./commitDetails";
import { comparedPair, pairKey, pairOfKey, unorderedPairKey } from "./commitSelection";
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
 * The selected commit's details (#397): read `DETAILS_DELAY_MS` after the selection settles, with
 * stale answers dropped and up to `DETAILS_CACHE` commits cached per repo. While a new commit loads, the previous
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

/** The compare files loader's own wait: the order's `DETAILS_DELAY_MS` has already passed by then. */
const COMPARE_FILES_DELAY_MS = 0;

export interface CompareState {
  /** The pair's order by the rule, the previous pair's while it loads. */
  order: LoadState<CompareOrder>;
  /** The direction shown once the order has arrived: older to newer, or reversed by Swap. */
  pair: ComparedPair | null;
  /** The files from `pair.from` to `pair.to`, the previous pair's while they load. */
  files: LoadState<CompareFiles>;
}

const EMPTY_ORDER: LoadState<CompareOrder> = { key: null, shown: null, shownKey: null, pending: false, error: null };
const EMPTY_FILES: LoadState<CompareFiles> = { key: null, shown: null, shownKey: null, pending: false, error: null };

/**
 * Two selected commits compared (#398). Their order loads `DETAILS_DELAY_MS` after the selection
 * settles, keyed by the unordered pair, then the files load for the shown direction, keyed by the
 * ordered pair, so Swap reads the reverse once and both directions stay cached. Both go through
 * #397's settled loader, so an answer for a pair no longer selected is dropped, and both caches
 * hold `DETAILS_CACHE` entries per repo.
 */
export function useCompare(repoPath: string | null, first: string | null, second: string | null, swapped: boolean): CompareState {
  const [order, setOrder] = useState<LoadState<CompareOrder>>(EMPTY_ORDER);
  const [files, setFiles] = useState<LoadState<CompareFiles>>(EMPTY_FILES);
  const orders = useRef<SettledLoader<CompareOrder> | null>(null);
  const diffs = useRef<SettledLoader<CompareFiles> | null>(null);

  useEffect(() => {
    if (repoPath === null) return;
    const orderLoader = new SettledLoader<CompareOrder>({
      fetch: (key) => {
        const [a, b] = pairOfKey(key);
        return invoke<CompareOrder>("git_compare_order", { repoPath, a, b });
      },
      delayMs: DETAILS_DELAY_MS,
      capacity: DETAILS_CACHE,
      timers: BROWSER_TIMERS,
      onState: setOrder,
      describe: errorMessage,
    });
    const filesLoader = new SettledLoader<CompareFiles>({
      fetch: (key) => {
        const [a, b] = pairOfKey(key);
        return invoke<CompareFiles>("git_compare_files", { repoPath, a, b });
      },
      delayMs: COMPARE_FILES_DELAY_MS,
      capacity: DETAILS_CACHE,
      timers: BROWSER_TIMERS,
      onState: setFiles,
      describe: errorMessage,
    });
    orders.current = orderLoader;
    diffs.current = filesLoader;
    return () => {
      orderLoader.dispose();
      filesLoader.dispose();
      orders.current = null;
      diffs.current = null;
      setOrder(EMPTY_ORDER);
      setFiles(EMPTY_FILES);
    };
  }, [repoPath]);

  // The unordered pair: the same two commits picked in either order share one order read.
  const orderKey = first === null || second === null ? null : unorderedPairKey(first, second);
  useEffect(() => {
    orders.current?.select(orderKey);
    if (orderKey === null) diffs.current?.select(null);
  }, [orderKey, repoPath]);

  const ordered = order.shown !== null && !order.pending && order.shownKey === orderKey ? order.shown : null;
  const pair = ordered === null ? null : comparedPair(ordered, swapped);
  const filesKey = pair === null ? null : comparedKey(pair);
  useEffect(() => {
    // Until the new order arrives the previous pair's files stay, dimmed.
    if (filesKey !== null) diffs.current?.select(filesKey);
  }, [filesKey, repoPath]);

  return { order, pair, files };
}

/** The files cache key of `pair` in its shown direction. */
export function comparedKey(pair: ComparedPair): string {
  return pairKey(pair.from.oid, pair.to.oid);
}

/** The compared files once they are `pair`'s in its shown direction, or null while they are another pair's. */
export function filesOfPair(files: LoadState<CompareFiles>, pair: ComparedPair | null): CompareFiles | null {
  return pair !== null && files.shown !== null && files.shownKey === comparedKey(pair) ? files.shown : null;
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

/**
 * What an open commit file is diffed against: one of the commit's parents (#397), by its index
 * from 1 and its oid, null for a root commit's empty tree; or the other commit of a compared pair
 * (#398), the pair's `from`.
 */
export type DiffedAgainst = { kind: "parent"; index: number; oid: string | null } | { kind: "commit"; oid: string };

/**
 * A commit file open in the read-only diff: the commit, what it is diffed against, and the file.
 * For a compared pair, `oid` is the pair's `to`.
 */
export interface OpenCommitFile {
  oid: string;
  against: DiffedAgainst;
  path: string;
  oldPath: string | null;
  status: FileStatus;
}

/** Whether `file` is one of commit `oid`'s files against its parent `index`. */
export function isParentFile(file: OpenCommitFile | null, oid: string | null, index: number): file is OpenCommitFile {
  return file !== null && file.oid === oid && file.against.kind === "parent" && file.against.index === index;
}

/** Whether `file` is one of `pair`'s files, diffed in the pair's shown direction. */
export function isPairFile(file: OpenCommitFile | null, pair: ComparedPair | null): file is OpenCommitFile {
  return file !== null && pair !== null && file.oid === pair.to.oid && file.against.kind === "commit" && file.against.oid === pair.from.oid;
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
  const key = repoPath === null || file === null ? null : `${repoPath}\n${file.oid}\n${file.against.oid ?? ""}\n${file.oldPath ?? ""}\n${file.path}`;
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
      // A rename or copy is read as the pair, not as the new path added.
      side: { kind: "commit", oid: open.oid, parent: open.against.oid, oldPath: open.oldPath },
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
