// Runs Find (#399) over the graph's loaded rows: once per query after a short debounce, in chunks
// that yield to the page, dropped when the query, the store or the refs change, and carried on as
// more rows load.

import { useCallback, useEffect, useRef, useState } from "react";
import { FindScan, findNeedle, type FindBadge } from "./graphFind";
import type { GraphStore } from "./graphStore";

/** How long typing pauses before a query runs. */
const DEBOUNCE_MS = 150;
/** Rows one chunk scans before yielding: about 50 ms at the 1M-row test's pace. */
const CHUNK_ROWS = 100_000;

export interface FindResult {
  /** The query these matches are for, which trails the typed text by the debounce. */
  query: string;
  /** The matching rows, ascending. */
  matches: Int32Array;
  /** Whether the scan hasn't reached the last loaded row yet. */
  scanning: boolean;
}

const NO_FIND: FindResult = { query: "", matches: new Int32Array(0), scanning: false };

interface RunningScan {
  scan: FindScan;
  query: string;
  store: GraphStore;
  badges: ReadonlyMap<string, readonly FindBadge[]>;
}

/**
 * Find over `store`'s loaded rows for `text`. `rowCount` bumps as pages land, which carries a
 * finished scan on over the new rows. `settle` runs the typed text now, skipping the debounce.
 */
export function useGraphFind(
  store: GraphStore | null,
  badges: ReadonlyMap<string, readonly FindBadge[]>,
  rowCount: number,
  text: string
): { result: FindResult; settle: () => void } {
  const [query, setQuery] = useState(text);
  useEffect(() => {
    // Clearing the field clears the find at once; typing waits for a pause.
    if (findNeedle(text) === "") {
      setQuery(text);
      return;
    }
    const timer = setTimeout(() => setQuery(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const textRef = useRef(text);
  textRef.current = text;
  const settle = useCallback(() => setQuery(textRef.current), []);

  const [result, setResult] = useState<FindResult>(NO_FIND);
  const running = useRef<RunningScan | null>(null);
  useEffect(() => {
    if (store === null || findNeedle(query) === "") {
      running.current = null;
      setResult(NO_FIND);
      return;
    }
    let current = running.current;
    // A splice or reset swaps in a new store whose row numbers differ, so it starts over.
    if (current === null || current.query !== query || current.store !== store || current.badges !== badges) {
      current = { scan: new FindScan(query, badges), query, store, badges };
      running.current = current;
    }
    const scan = current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      // Dropped: a newer query, store or refs took over.
      if (running.current !== scan) return;
      const done = scan.scan.scan(store, CHUNK_ROWS);
      setResult({ query: scan.query, matches: scan.scan.matches, scanning: !done });
      if (!done) timer = setTimeout(step, 0);
    };
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [store, badges, rowCount, query]);

  return { result, settle };
}
