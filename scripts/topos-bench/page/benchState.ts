// What the benchmark page (main.tsx) publishes as `window.__toposBench` for drive.ts to read.

export interface BenchState {
  /** "ready" until drive.ts, having weighed the heap, calls `__toposBenchStart`. */
  phase: "ready" | "loading" | "done" | "failed";
  /** Rows the store holds. */
  rows: number;
  /** Main-thread ms for each Rows page: decode plus store ingest. */
  ingestMs: number[];
  /** Ms from the first byte to the last message applied. */
  loadMs: number;
  /** Ms from the first Rows page's arrival to the first frame after rows were rendered. */
  firstRowsMs: number | null;
  error: string | null;
}

declare global {
  interface Window {
    __toposBench: BenchState;
    /** Starts the replay. */
    __toposBenchStart: () => void;
  }
}
