/** One page of a cursor-paged list, as `list_github_issues` and `list_github_prs` return it. */
export interface GithubPage<T> {
  items: T[];
  endCursor: string | null;
  hasNextPage: boolean;
}

/** Items per page a paged list asks for. */
export const GITHUB_PAGE_SIZE = 50;

/** Most items the Source control panel loads into one list before it stops paging. */
export const GITHUB_LIST_CAP = 500;

/** Everything loaded so far for one list, plus where the next page starts. */
export interface PagedList<T> {
  items: T[];
  endCursor: string | null;
  hasNextPage: boolean;
}

export const emptyPagedList = <T>(): PagedList<T> => ({
  items: [],
  endCursor: null,
  hasNextPage: false,
});

/**
 * Adds a page to the list. A first page replaces what was there. Later pages skip
 * numbers already loaded, since an item created between fetches shifts the rest down.
 */
export function appendPage<T extends { number: number }>(
  list: PagedList<T>,
  page: GithubPage<T>,
  isFirstPage: boolean,
): PagedList<T> {
  const base = isFirstPage ? [] : list.items;
  const seen = new Set(base.map((item) => item.number));
  const fresh = page.items.filter((item) => !seen.has(item.number));
  return {
    items: [...base, ...fresh],
    endCursor: page.endCursor,
    hasNextPage: page.hasNextPage && page.endCursor !== null,
  };
}

/** Whether another page should load: more remain and the list holds fewer than `cap` items. */
export function canLoadMore(list: PagedList<unknown>, cap: number = Infinity): boolean {
  return list.hasNextPage && list.items.length < cap;
}

/**
 * "50 loaded" while more pages remain, "All 73 loaded" once the list is complete, and "First 500
 * shown; filter to narrow the list" once it reaches `cap` with more left on GitHub.
 */
export function loadedCountLabel(list: PagedList<unknown>, cap: number = Infinity): string {
  if (!list.hasNextPage) return `All ${list.items.length} loaded`;
  if (list.items.length >= cap) return `First ${list.items.length} shown; filter to narrow the list`;
  return `${list.items.length} loaded`;
}
