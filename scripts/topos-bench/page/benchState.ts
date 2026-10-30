// What the benchmark page (main.tsx) publishes as `window.__toposBench` for drive.ts to read.

export interface BenchState {
  phase: "loading" | "done" | "failed";
  /** Rows the store holds. */
  rows: number;
  /** Main-thread ms for each Rows page: decode plus store ingest. */
  ingestMs: number[];
  /** Ms from the first byte to the last message applied. */
  loadMs: number;
  /** Ms from the first Rows page's arrival to the first frame after rows were rendered. */
  firstRowsMs: number | null;
  /** JS heap in bytes after a full GC, before the recording is fetched. */
  heapBeforeBytes: number;
  /** JS heap in bytes after a full GC, once every message is applied. */
  heapAfterBytes: number;
  error: string | null;
}

declare global {
  interface Window {
    __toposBench: BenchState;
  }
}
