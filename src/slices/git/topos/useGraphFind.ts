// Find (#399) over the graph's loaded rows. `useFindController` owns the find's open state, text,
// steps, counter and keys. `useGraphFind` under it runs a query once typing pauses, in chunks that
// yield to the page, dropped when the query, the store or the refs change, and carried on as more
// rows load.

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePopupLayer } from "../../overlay/useOverlay";
import { findCounter, findKey, FindScan, findNeedle, steppedMatch, type FindBadge, type FindKeyEvent } from "./graphFind";
import type { GraphFindBarProps } from "./GraphFindBar";
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

const NO_MATCHES = new Int32Array(0);

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
}

export interface FindController {
  /** The query the shown matches are for, or "" when there are none to show. */
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
export function useFindController({ store, badges, rowCount, visible, cursorRow, selectRow, refocus, keysRef }: FindControllerOptions): FindController {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const activeText = open ? text : "";
  const { result: found, settle } = useGraphFind(store, badges, rowCount, activeText);
  // Matches only apply to the query still typed.
  const query = found.query !== "" && found.query === activeText ? found.query : "";

  const refocusRef = useRef(refocus);
  refocusRef.current = refocus;
  const close = useCallback((refocusList: boolean) => {
    setOpen(false);
    setText("");
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
      if (!open || text.trim() === "") return;
      if (query === "") {
        pendingStep.current = direction;
        settle();
        return;
      }
      const row = steppedMatch(found.matches, cursorRow, direction);
      if (row !== null) selectRow(row);
    },
    [open, text, query, found.matches, cursorRow, selectRow, settle]
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

  const counter =
    open && text.trim() !== "" ? findCounter(query === "" ? NO_MATCHES : found.matches, cursorRow, query === "" || found.scanning) : "";
  const bar: GraphFindBarProps | null = open
    ? {
        text,
        onText: setText,
        counter,
        canStep: query !== "" && found.matches.length > 0,
        onStep: step,
        onClose: () => close(true),
        inputRef,
        barRef,
      }
    : null;
  return { query, matches: found.matches, bar };
}
