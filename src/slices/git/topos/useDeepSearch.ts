// Deep search (#400) for the find field: the backend search behind it, and the loaded rows its
// results land on.

import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { DeepSearch, IDLE, ResultScan, type DeepSearchState, type SearchBackend, type SearchEvent, type SearchQuery } from "./deepSearch";
import type { GraphStore } from "./graphStore";

/** Rows one chunk of the result scan covers before it yields to the page. */
const CHUNK_ROWS = 100_000;

const tauriSearch: SearchBackend = {
  start: (repoPath, query, onEvent) => {
    const channel = new Channel<SearchEvent>();
    channel.onmessage = onEvent;
    return invoke<number>("git_log_search", { repoPath, query, onEvent: channel });
  },
  more: (searchId) => void invoke("git_search_more", { searchId }).catch(console.error),
  cancel: (searchId) => void invoke("git_search_cancel", { searchId }).catch(console.error),
};

/**
 * The deep search for `query` over `repoPath`'s history, or none for null. A changed query cancels
 * the running search at once and starts the new one once typing pauses; unmounting cancels it.
 */
export function useDeepSearch(repoPath: string | null, query: SearchQuery | null): { state: DeepSearchState; loadMore: () => void } {
  const [state, setState] = useState<DeepSearchState>(IDLE);
  const search = useRef<DeepSearch | null>(null);
  if (search.current === null) {
    search.current = new DeepSearch({
      backend: tauriSearch,
      timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) },
      onState: setState,
    });
  }
  useEffect(() => {
    search.current?.ask(repoPath, query);
  }, [repoPath, query]);
  useEffect(() => () => search.current?.dispose(), []);
  const loadMore = useCallback(() => search.current?.loadMore(), []);
  return { state, loadMore };
}

export interface ResultRowsFound {
  /** The loaded rows that are results, ascending. */
  matches: Int32Array;
  /** Whether the scan hasn't reached the last loaded row yet. */
  scanning: boolean;
}

const NONE: ResultRowsFound = { matches: new Int32Array(0), scanning: false };

/**
 * The loaded rows of `store` whose commits are among `oids`, scanned in chunks that yield to the
 * page. New results or a new store start the scan over; more rows (`rowCount`) carry it on.
 */
export function useResultRows(store: GraphStore | null, rowCount: number, oids: readonly string[]): ResultRowsFound {
  const [found, setFound] = useState<ResultRowsFound>(NONE);
  const running = useRef<{ scan: ResultScan; store: GraphStore; oids: readonly string[] } | null>(null);
  useEffect(() => {
    if (store === null || oids.length === 0) {
      running.current = null;
      setFound(NONE);
      return;
    }
    let current = running.current;
    if (current === null || current.store !== store || current.oids !== oids) {
      current = { scan: new ResultScan(oids), store, oids };
      running.current = current;
    }
    const scan = current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      if (running.current !== scan) return;
      const done = scan.scan.scan(store, CHUNK_ROWS);
      setFound({ matches: scan.scan.matches, scanning: !done });
      if (!done) timer = setTimeout(step, 0);
    };
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [store, rowCount, oids]);
  return found;
}
