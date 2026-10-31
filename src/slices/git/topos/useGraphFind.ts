// Find (#399) over the graph's loaded rows. `useFindController` owns the find's open state, text,
// steps, counter and keys. `useGraphFind` under it runs a query once typing pauses, in chunks that
// yield to the page, dropped when the query, the store or the refs change, and carried on as more
// rows load.

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePopupLayer } from "../../overlay/useOverlay";
import { findCounter, findKey, FindScan, findNeedle, steppedMatch, type FindBadge, type FindKeyEvent } from "./graphFind";
import type { DeepSearchBarProps, GraphFindBarProps } from "./GraphFindBar";
import type { GraphStore } from "./graphStore";
import { deepCounter, parseSearch, ResultRoute, type FeedState, type SearchQuery } from "./deepSearch";
import { useDeepSearch, useResultRows } from "./useDeepSearch";

/** The graph's ref set (#370), which a deep search walks too. */
const GRAPH_REFS = { kind: "branches" } as const;

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

const NO_MATCHES = new Int32Array(0);
const NO_OIDS: readonly string[] = [];

/** What the find shows and does in its current mode: a find, a deep search, or neither. */
interface FindMode {
  /** Whether the mode lights its matches and dims the other rows. */
  active: boolean;
  /** The text whose runs the rows mark, or "" for none. */
  query: string;
  /** The rows lit, ascending. */
  matches: Int32Array;
  /** What a step walks: these rows, the typed text's once it settles, or nothing. */
  steps: Int32Array | "settle" | null;
  /** The counter's text, before the bar's open and non-blank check. */
  counter: (cursorRow: number | null) => string;
}

const NO_MODE: FindMode = { active: false, query: "", matches: NO_MATCHES, steps: null, counter: () => "" };

export interface FindControllerOptions {
  store: GraphStore | null;
  badges: ReadonlyMap<string, readonly FindBadge[]>;
  rowCount: number;
  /** Whether Topos shows; hiding it clears the find, which is never kept (#369). */
  visible: boolean;
  /** The selected row, or null for none: where a step starts and what the counter counts from. */
  cursorRow: number | null;
  /** Selects `row` and scrolls it into view; a step lands there. */
  selectRow: (row: number) => void;
  /** Puts focus back on the list when the find closes from its bar or by Escape. */
  refocus: () => void;
  /** Set to the find's key handler while it is mounted, for Topos to call for keys anywhere in it. */
  keysRef?: React.MutableRefObject<((e: FindKeyEvent) => boolean) | null>;
  /** The repo a deep search (#400) runs in: the graph's. */
  repoPath: string | null;
  /** The graph feed's status, which decides how a deep result below the loaded rows opens. */
  feedState: FeedState;
  /** Asks the graph's session for more rows, to load the graph down to a result. */
  loadMoreRows: () => void;
  /** Opens only the details of a result the graph will never load. */
  openDetails: (oid: string) => void;
}

export interface FindController {
  /** Whether a find or a deep search is lighting its matches and dimming the other rows. */
  active: boolean;
  /** The text whose runs the rows mark, or "" for none; a deep search marks none. */
  query: string;
  /** The matching rows, ascending; they apply only while `query` isn't "". */
  matches: Int32Array;
  /** The find bar's props while the find is open, otherwise null. */
  bar: GraphFindBarProps | null;
}

/**
 * The find over the commit list (#399). Its text lives only in this hook's state, so it is never
 * written anywhere. Ctrl+F opens it, F3 and Enter step, and Escape joins the overlay stack, so it
 * clears the find before Topos closes.
 */
export function useFindController({
  store,
  badges,
  rowCount,
  visible,
  cursorRow,
  selectRow,
  refocus,
  keysRef,
  repoPath,
  feedState,
  loadMoreRows,
  openDetails,
}: FindControllerOptions): FindController {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  // "Search all history" (#400): text without a prefix searches messages in all history.
  const [allHistory, setAllHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const activeText = open ? text : "";
  const input = parseSearch(activeText, allHistory);
  const deepKind = input.mode === "deep" ? input.kind : null;
  const deepText = input.mode === "deep" ? input.text : "";
  const deepQuery = useMemo<SearchQuery | null>(
    () => (deepKind === null || deepText === "" ? null : { kind: deepKind, text: deepText, refs: GRAPH_REFS }),
    [deepKind, deepText]
  );
  const deep = useDeepSearch(repoPath, deepQuery);
  const deepState = deepQuery === null ? null : deep.state;
  const deepRows = useResultRows(store, rowCount, deepState?.oids ?? NO_OIDS);
  const { result: found, settle } = useGraphFind(store, badges, rowCount, input.mode === "find" ? activeText : "");
  // Matches only apply to the query still typed.
  const findQuery = input.mode === "find" && found.query !== "" && found.query === activeText ? found.query : "";
  // Each mode's rules in one place.
  let mode: FindMode = NO_MODE;
  if (deepState !== null) {
    const { status, oids } = deepState;
    mode = {
      active: true,
      query: "",
      matches: deepRows.matches,
      steps: deepRows.matches,
      counter: (row) => deepCounter(status, oids.length, deepRows.matches, row),
    };
  } else if (input.mode === "find") {
    mode = {
      active: findQuery !== "",
      query: findQuery,
      matches: found.matches,
      steps: findQuery === "" ? "settle" : found.matches,
      counter: (row) => findCounter(findQuery === "" ? NO_MATCHES : found.matches, row, findQuery === "" || found.scanning),
    };
  }
  const { active, query, matches, steps } = mode;

  const refocusRef = useRef(refocus);
  refocusRef.current = refocus;
  const close = useCallback((refocusList: boolean) => {
    setOpen(false);
    setText("");
    setAllHistory(false);
    if (refocusList) refocusRef.current();
  }, []);
  useEffect(() => {
    if (!visible) close(false);
  }, [visible, close]);
  usePopupLayer(open, () => close(true), barRef);

  // A step asked for before the typed text's matches arrived runs once they have.
  const pendingStep = useRef<1 | -1 | null>(null);
  const step = useCallback(
    (direction: 1 | -1) => {
      if (!open || text.trim() === "" || steps === null) return;
      if (steps === "settle") {
        pendingStep.current = direction;
        settle();
        return;
      }
      const row = steppedMatch(steps, cursorRow, direction);
      if (row !== null) selectRow(row);
    },
    [open, text, steps, cursorRow, selectRow, settle]
  );
  useEffect(() => {
    const direction = pendingStep.current;
    if (direction === null || query === "" || (found.scanning && found.matches.length === 0)) return;
    pendingStep.current = null;
    step(direction);
  }, [query, found, step]);

  const openFind = useCallback(() => {
    setOpen(true);
    // The bar mounts with this render; focus it once it has.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);
  const onKey = useCallback(
    (e: FindKeyEvent): boolean => {
      const key = findKey(e, e.target === inputRef.current);
      switch (key) {
        case null:
          return false;
        case "open":
          openFind();
          return true;
        case "next":
        case "previous":
          if (!open) return false;
          step(key === "next" ? 1 : -1);
          return true;
      }
    },
    [openFind, open, step]
  );
  useEffect(() => {
    if (!keysRef) return;
    keysRef.current = onKey;
    return () => {
      keysRef.current = null;
    };
  }, [keysRef, onKey]);

  // Opening a deep result (#368): in place when loaded, by loading the graph down to it while the
  // session has more rows, and otherwise only its details. Each new page lets the route step again.
  const [route, setRoute] = useState<ResultRoute | null>(null);
  useEffect(() => setRoute(null), [store, deepQuery]);
  const routeActions = useRef({ selectRow, loadMoreRows, openDetails });
  routeActions.current = { selectRow, loadMoreRows, openDetails };
  useEffect(() => {
    if (route === null || store === null) return;
    const next = route.step(store, feedState);
    switch (next.kind) {
      case "inPlace":
        setRoute(null);
        routeActions.current.selectRow(next.row);
        return;
      case "loadMore":
        routeActions.current.loadMoreRows();
        return;
      case "wait":
        return;
      case "detailsOnly":
        setRoute(null);
        routeActions.current.openDetails(route.oid);
        return;
    }
  }, [route, store, rowCount, feedState]);
  const openResult = useCallback((oid: string) => setRoute(new ResultRoute(oid)), []);

  // The rows of the loaded results, for the results list; no more entries than results.
  const resultRows = useMemo(() => {
    const rows = new Map<string, number>();
    if (store !== null && deepQuery !== null) for (const row of deepRows.matches) rows.set(store.oid(row), row);
    return rows;
  }, [store, deepQuery, deepRows.matches]);

  const counter = open && text.trim() !== "" ? mode.counter(cursorRow) : "";
  const deepBar: DeepSearchBarProps | null =
    input.mode === "deep"
      ? {
          kind: input.kind,
          status: deepState?.status ?? "idle",
          error: deepState?.error ?? null,
          oids: deepState?.oids ?? NO_OIDS,
          rowOf: (oid) => resultRows.get(oid) ?? -1,
          store,
          loading: route?.oid ?? null,
          onOpen: openResult,
          onLoadMore: deep.loadMore,
        }
      : null;
  const bar: GraphFindBarProps | null = open
    ? {
        text,
        onText: setText,
        counter,
        canStep: steps instanceof Int32Array && steps.length > 0,
        allHistory,
        onAllHistory: setAllHistory,
        deep: deepBar,
        onStep: step,
        onClose: () => close(true),
        inputRef,
        barRef,
      }
    : null;
  return { active, query, matches, bar };
}
