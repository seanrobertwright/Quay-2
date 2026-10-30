// What one graph session's channel says, turned into rows and a status (#374). Each
// `git_graph_open` gets its own channel and its own feed; a message naming another session is
// dropped, so a closed session can never write into the graph that replaced it.

import { decodeGraphPage } from "./graphPage.ts";
import { GraphStore, type Splice } from "./graphStore.ts";
import type { GitError } from "./gitVersion.ts";

/** The JSON `GraphEvent`s from `src-tauri/src/slices/git/graph/page.rs`. `Rows` pages are raw bytes. */
export type GraphEvent =
  | { event: "started"; sessionId: number }
  | { event: "paused"; sessionId: number; rowsLoaded: number }
  | { event: "done"; sessionId: number; total: number }
  | { event: "truncated"; sessionId: number; cap: number }
  | { event: "failed"; sessionId: number; error: GitError }
  | ({ event: "splice"; sessionId: number } & Splice)
  | { event: "reset"; sessionId: number }
  | { event: "watch"; sessionId: number; watch: WatchState };

/** Where the session's repository watch stands (#379). */
export type WatchState = { state: "live" } | { state: "off"; reason: string } | { state: "gone" };

/** A refresh's rows on their way in, gathered apart until they can replace the rows shown. */
type Pending =
  | { kind: "splice"; splice: Splice; store: GraphStore }
  /** Swapped in once it holds `until` rows, or the walk stops. */
  | { kind: "reset"; store: GraphStore; until: number };

export type GraphStatus =
  | { state: "loading" }
  /** Every row asked for has loaded and more remain. */
  | { state: "paused" }
  | { state: "done" }
  /** The session stopped at the backend's ceiling of `cap` rows. */
  | { state: "truncated"; cap: number }
  | { state: "failed"; message: string };

/** Rows the frontend loads before it waits for the viewport (#370). The backend's default too. */
export const SOFT_CAP = 50_000;
/** Rows asked for each time the viewport nears the loaded end. */
export const MORE_ROWS = 10_240;
/** How close to the loaded end the viewport gets before more rows are asked for. */
export const LOAD_AHEAD_ROWS = 2_048;

export class GraphFeed {
  /** Null until the channel's `Started` says which session it carries. */
  sessionId: number | null = null;
  store: GraphStore | null = null;
  status: GraphStatus = { state: "loading" };
  /** The watch's state, from its last `watch` event or `git_graph_watch`; null before either. */
  watch: WatchState | null = null;
  private pending: Pending | null = null;
  /** Set while a `git_graph_more` is outstanding, so scrolling asks only once. */
  private moreRequested = false;

  /** Applies one channel message. Returns false for a message it dropped. */
  accept(message: unknown): boolean {
    if (message instanceof ArrayBuffer) {
      let page;
      try {
        page = decodeGraphPage(message);
      } catch (e) {
        this.fail(String(e instanceof Error ? e.message : e));
        return false;
      }
      if (this.store === null || page.sessionId !== this.sessionId) return false;
      if (this.pending === null && this.status.state === "failed") return false;
      try {
        if (this.pending === null) this.store.ingest(page);
        else {
          this.pending.store.ingest(page);
          this.settlePending(false);
        }
      } catch (e) {
        this.fail(String(e instanceof Error ? e.message : e));
        return false;
      }
      return true;
    }
    const event = message as GraphEvent;
    if (typeof event !== "object" || event === null || typeof event.sessionId !== "number") return false;
    if (event.event === "started" && this.sessionId === null) {
      this.sessionId = event.sessionId;
      this.store = new GraphStore(event.sessionId);
      return true;
    }
    if (event.sessionId !== this.sessionId || this.store === null) return false;
    // A refresh can follow a walk that finished.
    switch (event.event) {
      case "splice":
        this.pending = { kind: "splice", splice: event, store: this.store.continuing() };
        this.status = { state: "loading" };
        this.settlePending(false);
        return true;
      case "reset":
        this.pending = { kind: "reset", store: new GraphStore(event.sessionId), until: this.store.rowCount };
        this.status = { state: "loading" };
        return true;
      case "watch":
        this.watch = event.watch;
        return true;
    }
    if (this.isOver()) return false;
    this.settlePending(true);
    switch (event.event) {
      case "paused":
        this.moreRequested = false;
        this.status = { state: "paused" };
        return true;
      case "done":
        this.status = { state: "done" };
        return true;
      case "truncated":
        this.status = { state: "truncated", cap: event.cap };
        return true;
      case "failed":
        this.status = { state: "failed", message: event.error.stderr };
        return true;
      default:
        return false;
    }
  }

  /**
   * Rows to ask `git_graph_more` for when the window reaches `windowEnd`, or null when none are
   * needed. Asking marks the request outstanding until the session pauses again.
   */
  rowsToRequest(windowEnd: number): number | null {
    if (this.status.state !== "paused" || this.moreRequested || this.store === null) return null;
    if (windowEnd < this.store.rowCount - LOAD_AHEAD_ROWS) return null;
    this.moreRequested = true;
    this.status = { state: "loading" };
    return MORE_ROWS;
  }

  /** Swaps in a refresh's rows once they are all here, or once the walk has stopped (`ended`). */
  private settlePending(ended: boolean): void {
    const pending = this.pending;
    if (pending === null || this.store === null) return;
    if (pending.kind === "splice") {
      if (pending.store.rowCount < pending.splice.newRows) return;
      this.store = this.store.spliced(pending.store, pending.splice);
    } else {
      if (!ended && pending.store.rowCount < pending.until) return;
      this.store = pending.store;
    }
    this.pending = null;
    this.moreRequested = false;
  }

  private isOver(): boolean {
    return this.status.state === "done" || this.status.state === "truncated" || this.status.state === "failed";
  }

  /** Marks the feed failed, as when the backend refuses to open or resume the session. */
  fail(message: string): void {
    this.status = { state: "failed", message };
  }
}
