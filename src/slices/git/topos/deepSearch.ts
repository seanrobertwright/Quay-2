// Deep search over all history (#368, #400): the find field's `msg:`, `author:`, `path:` and
// `code:` prefixes, or its "Search all history" toggle, run a backend `git log` over the graph's
// ref set instead of Find's scan of the loaded rows.

import { errorMessage, type GitError } from "./gitVersion.ts";

/** What a deep search matches; the Rust `SearchKind`. */
export type SearchKind = "message" | "author" | "path" | "code";

/** What the find field's text asks for. */
export type SearchInput =
  /** Find (#399) over the loaded rows. */
  | { mode: "find"; text: string }
  /** A deep search, whose `text` is "" until something follows the prefix. */
  | { mode: "deep"; kind: SearchKind; text: string };

const PREFIXES: readonly (readonly [string, SearchKind])[] = [
  ["msg:", "message"],
  ["author:", "author"],
  ["path:", "path"],
  ["code:", "code"],
];

/**
 * What `text` in the find field asks for. A leading `msg:`, `author:`, `path:` or `code:`, in any
 * case, makes it a deep search of that kind for the rest, trimmed. With `allHistory` (the toggle)
 * on, text without a prefix is a message search; with it off, it is Find over the loaded rows.
 */
export function parseSearch(text: string, allHistory: boolean): SearchInput {
  const start = text.trimStart();
  const lower = start.slice(0, 7).toLowerCase();
  for (const [prefix, kind] of PREFIXES) {
    if (lower.startsWith(prefix)) return { mode: "deep", kind, text: start.slice(prefix.length).trim() };
  }
  return allHistory ? { mode: "deep", kind: "message", text: text.trim() } : { mode: "find", text };
}

/** The refs a deep search walks: the graph's current ref set; the Rust `SearchRefs`. */
export type SearchRefs = { kind: "branches" } | { kind: "only"; refs: string[] };

/** `SearchQuery` for `git_log_search`. */
export interface SearchQuery {
  kind: SearchKind;
  text: string;
  refs: SearchRefs;
}

/** The `SearchEvent`s from `src-tauri/src/slices/git/search.rs`. */
export type SearchEvent =
  | { event: "matches"; searchId: number; oids: string[] }
  | { event: "done"; searchId: number; total: number }
  | { event: "capped"; searchId: number; total: number }
  | { event: "failed"; searchId: number; error: GitError };

/** The backend commands a deep search runs, passed in so tests can stand in for them. */
export interface SearchBackend {
  /** `git_log_search`: starts the search, sending its events to `onEvent`; resolves to its id. */
  start(repoPath: string, query: SearchQuery, onEvent: (event: SearchEvent) => void): Promise<number>;
  /** `git_search_more`: Load more. */
  more(searchId: number): void;
  /** `git_search_cancel`, which kills the search's git. */
  cancel(searchId: number): void;
}

/** The timer functions the search uses, passed in so tests can run time by hand. */
export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface DeepSearchState {
  /** The query asked for, or null for none. */
  query: SearchQuery | null;
  /**
   * The matching oids so far, newest first. Only oids: the rows' text stays in the graph's store,
   * so a long result list costs one string per match.
   */
  oids: readonly string[];
  /** `waiting` covers the debounce and the start; `capped` waits for Load more. */
  status: "idle" | "waiting" | "running" | "capped" | "done" | "failed";
  /** Why it failed, or null. */
  error: string | null;
}

/** How long typing pauses before a deep search starts (#368). */
export const SEARCH_DEBOUNCE_MS = 300;

/** A search that holds no query and no results. */
export const IDLE: DeepSearchState = { query: null, oids: [], status: "idle", error: null };

/** One `git_log_search` call; its id is null until the backend answers. */
interface Run {
  id: number | null;
}

function sameQuery(a: { repoPath: string; query: SearchQuery } | null, repoPath: string, query: SearchQuery): boolean {
  return (
    a !== null &&
    a.repoPath === repoPath &&
    a.query.kind === query.kind &&
    a.query.text === query.text &&
    JSON.stringify(a.query.refs) === JSON.stringify(query.refs)
  );
}

export interface DeepSearchOptions {
  backend: SearchBackend;
  timers: Timers;
  onState: (state: DeepSearchState) => void;
  debounceMs?: number;
}

/**
 * The deep search behind the find field (#400). A new query cancels the running search at once and
 * starts once typing has paused for [`SEARCH_DEBOUNCE_MS`]; only the current search's events count,
 * so a cancelled or superseded one's late events are dropped.
 */
export class DeepSearch {
  private readonly backend: SearchBackend;
  private readonly timers: Timers;
  private readonly onState: (state: DeepSearchState) => void;
  private readonly debounceMs: number;
  private asked: { repoPath: string; query: SearchQuery } | null = null;
  private timer: unknown = null;
  private run: Run | null = null;
  private state: DeepSearchState = IDLE;

  constructor({ backend, timers, onState, debounceMs = SEARCH_DEBOUNCE_MS }: DeepSearchOptions) {
    this.backend = backend;
    this.timers = timers;
    this.onState = onState;
    this.debounceMs = debounceMs;
  }

  private set(state: DeepSearchState): void {
    this.state = state;
    this.onState(state);
  }

  /** Stops the running search, if any, and the debounce. */
  private stop(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const run = this.run;
    this.run = null;
    // A run still starting is cancelled once its id comes back.
    if (run !== null && run.id !== null) this.backend.cancel(run.id);
  }

  /** Searches `repoPath` for `query`, or stops searching for null or an empty text. */
  ask(repoPath: string | null, query: SearchQuery | null): void {
    if (repoPath === null || query === null || query.text.trim() === "") {
      this.asked = null;
      this.stop();
      if (this.state !== IDLE) this.set(IDLE);
      return;
    }
    if (sameQuery(this.asked, repoPath, query)) return;
    this.asked = { repoPath, query };
    this.stop();
    this.set({ query, oids: [], status: "waiting", error: null });
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.begin(repoPath, query);
    }, this.debounceMs);
  }

  private begin(repoPath: string, query: SearchQuery): void {
    const run: Run = { id: null };
    this.run = run;
    this.backend.start(repoPath, query, (event) => this.accept(run, event)).then(
      (id) => {
        run.id = id;
        if (this.run !== run) this.backend.cancel(id);
      },
      (e: unknown) => {
        if (this.run !== run) return;
        this.run = null;
        this.set({ ...this.state, status: "failed", error: errorMessage(e) });
      }
    );
  }

  private accept(run: Run, event: SearchEvent): void {
    // Dropped: a newer query took over, or the event names another search.
    if (this.run !== run || (run.id !== null && event.searchId !== run.id)) return;
    switch (event.event) {
      case "matches":
        this.set({ ...this.state, oids: this.state.oids.concat(event.oids), status: "running" });
        return;
      case "capped":
        this.set({ ...this.state, status: "capped" });
        return;
      case "done":
        this.run = null;
        this.set({ ...this.state, status: "done" });
        return;
      case "failed":
        this.run = null;
        this.set({ ...this.state, status: "failed", error: errorMessage(event.error) });
        return;
    }
  }

  /** Load more: lets a capped search send its next batch. */
  loadMore(): void {
    const run = this.run;
    if (run === null || run.id === null || this.state.status !== "capped") return;
    this.backend.more(run.id);
    this.set({ ...this.state, status: "running" });
  }

  /** Stops searching for good, as when the find closes. */
  dispose(): void {
    this.asked = null;
    this.stop();
  }
}

/** The loaded rows as a result lookup reads them; `GraphStore` is one. */
export interface ResultRows {
  readonly rowCount: number;
  oid(row: number): string;
}

/**
 * The loaded rows that are deep-search results, found by one pass over the rows against a set of
 * the results' oids. The rows come out ascending, as Find's sorted match list (#399) is, so Find's
 * highlighting, counter and stepping read them unchanged; rows keep no search state of their own.
 */
export class ResultScan {
  private readonly oids: ReadonlySet<string>;
  private buffer = new Int32Array(64);
  private count = 0;
  private next = 0;

  constructor(oids: Iterable<string>) {
    this.oids = new Set(oids);
  }

  get matches(): Int32Array {
    return this.buffer.subarray(0, this.count);
  }

  /** Scans up to `budget` more rows; returns whether it has reached the last loaded row. */
  scan(rows: ResultRows, budget: number): boolean {
    const end = Math.min(rows.rowCount, this.next + budget);
    if (this.oids.size > 0) {
      for (let row = this.next; row < end; row++) {
        if (!this.oids.has(rows.oid(row))) continue;
        if (this.count === this.buffer.length) {
          const grown = new Int32Array(this.buffer.length * 2);
          grown.set(this.buffer);
          this.buffer = grown;
        }
        this.buffer[this.count++] = row;
      }
    }
    this.next = end;
    return end === rows.rowCount;
  }
}

/** The graph feed's status, as a result's route reads it. */
export type FeedState = "loading" | "paused" | "done" | "truncated" | "failed";

/** What opening a result does next. */
export type RouteStep =
  /** It is loaded at `row`: select it there. */
  | { kind: "inPlace"; row: number }
  /** It isn't loaded and more rows remain: ask the graph's session for more. */
  | { kind: "loadMore" }
  /** More rows are on their way: try again once they land. */
  | { kind: "wait" }
  /** The graph will never load it (past its hard ceiling of rows): open only its details. */
  | { kind: "detailsOnly" };

/**
 * Opening the result `oid` (#368): in place when it is loaded, loading the graph down to it
 * through its one `git log` session when it lies further down, and only its details once the
 * session has no more rows to give. Each step scans only the rows that loaded since the last.
 */
export class ResultRoute {
  readonly oid: string;
  private next = 0;

  constructor(oid: string) {
    this.oid = oid;
  }

  step(rows: ResultRows, state: FeedState): RouteStep {
    for (let row = this.next; row < rows.rowCount; row++) {
      if (rows.oid(row) === this.oid) return { kind: "inPlace", row };
    }
    this.next = rows.rowCount;
    switch (state) {
      case "paused":
        return { kind: "loadMore" };
      case "loading":
        return { kind: "wait" };
      default:
        return { kind: "detailsOnly" };
    }
  }
}

/**
 * The find counter in deep mode: how many commits the search found in all history, then where
 * the selected `row` is among the `loaded` results ("2 of 41 loaded"), or how many are loaded.
 */
export function deepCounter(status: DeepSearchState["status"], found: number, loaded: ArrayLike<number>, row: number | null): string {
  if (status === "failed") return "Search failed";
  if (found === 0) return status === "done" ? "No matches in history" : "Searching all history…";
  const total = `${found.toLocaleString("en-US")} found${status === "capped" ? ", more remain" : status === "done" ? "" : " so far"}`;
  const n = loaded.length;
  if (n === 0) return `${total} · none loaded`;
  let at = -1;
  if (row !== null) {
    for (let i = 0; i < n; i++) if (loaded[i] === row) at = i;
  }
  return `${total} · ${at === -1 ? n.toLocaleString("en-US") : `${(at + 1).toLocaleString("en-US")} of ${n.toLocaleString("en-US")}`} loaded`;
}
