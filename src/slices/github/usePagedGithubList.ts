import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  appendPage,
  emptyPagedList,
  GITHUB_PAGE_SIZE,
  type GithubPage,
  type PagedList,
} from "./paging";

export interface PagedGithubList<T> {
  list: PagedList<T>;
  /** Restarts from page one. Rejects when the fetch fails, so callers can show the error. */
  loadFirstPage: () => Promise<void>;
  /** Fetches the next page; does nothing while a fetch is running or when all are loaded. */
  loadMore: () => Promise<void>;
  isLoadingMore: boolean;
  loadMoreError: string | null;
}

/**
 * Cursor-paged issues or pull requests for one repository and state filter. A new
 * first page (refresh, filter change) supersedes any page still in flight: its
 * response is dropped instead of being appended to the new list.
 */
export function usePagedGithubList<T extends { number: number }>(
  command: "list_github_issues" | "list_github_prs",
  repoPath: string,
  state: string,
): PagedGithubList<T> {
  const [list, setList] = useState<PagedList<T>>(emptyPagedList);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Bumped by every first-page load; a response whose run is older is stale.
  const runRef = useRef(0);
  const fetchingRef = useRef(false);
  const listRef = useRef(list);
  // The repo and filter the loaded list belongs to; a cursor only continues its own list.
  const loadedKeyRef = useRef<string | null>(null);
  const key = `${repoPath}\n${state}`;

  const fetchPage = useCallback(
    (after: string | null) =>
      invoke<GithubPage<T>>(command, { repoPath, state, after, pageSize: GITHUB_PAGE_SIZE }),
    [command, repoPath, state],
  );

  const loadFirstPage = useCallback(async () => {
    const run = ++runRef.current;
    fetchingRef.current = true;
    setIsLoadingMore(false);
    setLoadMoreError(null);
    try {
      const page = await fetchPage(null);
      if (run !== runRef.current) return;
      const next = appendPage(listRef.current, page, true);
      listRef.current = next;
      loadedKeyRef.current = key;
      setList(next);
    } catch (err) {
      // A superseded load's failure is no longer the list's problem
      if (run === runRef.current) throw err;
    } finally {
      if (run === runRef.current) fetchingRef.current = false;
    }
  }, [fetchPage, key]);

  const loadMore = useCallback(async () => {
    const current = listRef.current;
    if (fetchingRef.current || !current.hasNextPage || loadedKeyRef.current !== key) return;
    const run = runRef.current;
    fetchingRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchPage(current.endCursor);
      if (run !== runRef.current) return;
      const next = appendPage(listRef.current, page, false);
      listRef.current = next;
      setList(next);
    } catch (err) {
      if (run === runRef.current) setLoadMoreError(String(err));
    } finally {
      if (run === runRef.current) {
        fetchingRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [fetchPage, key]);

  return { list, loadFirstPage, loadMore, isLoadingMore, loadMoreError };
}

/**
 * Calls `onVisible` when the returned ref's element scrolls within 200px of its scroll
 * container. The observer is rebuilt when `itemCount` changes, so a sentinel that is
 * still on screen after a page lands asks for the next page too.
 */
export function useLoadMoreSentinel(onVisible: () => void, itemCount: number) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const onVisibleRef = useRef(onVisible);
  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisibleRef.current();
      },
      { root: node.parentElement, rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, itemCount]);

  return setNode;
}
