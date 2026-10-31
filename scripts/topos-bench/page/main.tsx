// The Topos scale benchmark page (#377). It mounts the real `GraphFeed` and `GraphList` and
// replays a recorded graph session (see ../dump-pages.ts) into the feed one channel message per
// task, as Tauri delivers them. It times each page's main-thread ingest and how long the first
// page takes to reach the screen, and weighs the JS heap before and after. `drive.ts` builds this
// page for production, serves it and reads `window.__toposBench`.

import { useEffect, useReducer, useState } from "react";
import ReactDOM from "react-dom/client";
import { GraphFeed } from "../../../src/slices/git/topos/graphFeed";
import { GraphList, type WipRowProps } from "../../../src/slices/git/topos/GraphList";
import { DEFAULT_COLUMN_WIDTH } from "../../../src/slices/git/topos/graphColumn";
import { NO_REFS } from "../../../src/slices/git/topos/graphRefs";
import { selectCommits, selectionOids } from "../../../src/slices/git/topos/commitSelection";
import type { BenchState } from "./benchState.ts";
import "./bench.css";

// No refs means no HEAD markers to put agents on.
const NO_WORKTREE_AGENTS = new Map();
const WIP: WipRowProps = {
  label: "3 changed",
  headOid: null,
  worktreeName: "bench",
  open: false,
  onToggle: () => {},
  controls: "bench-inspector",
};

const state: BenchState = {
  phase: "loading",
  rows: 0,
  ingestMs: [],
  loadMs: 0,
  firstRowsMs: null,
  heapBeforeBytes: 0,
  heapAfterBytes: 0,
  error: null,
};
window.__toposBench = state;
const feed = new GraphFeed();
let bump: () => void = () => {};
/** When the first Rows page arrived, for `firstRowsMs`. */
let firstPageAt: number | null = null;

/**
 * JS heap in bytes once garbage is gone. drive.ts launches Edge with `--expose-gc` and precise
 * memory info. V8 frees ArrayBuffer backing stores after the GC that finds them dead, so one GC
 * and an immediate read can still count them: this collects and waits until the heap stops
 * shrinking.
 */
async function settledHeap(): Promise<number> {
  const { gc } = window as unknown as { gc?: () => void };
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (!gc || !memory) throw new Error("the page needs gc() and performance.memory; run it through drive.ts");
  let least = Infinity;
  for (let quiet = 0; quiet < 3; ) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const used = memory.usedJSHeapSize;
    quiet = used < least ? 0 : quiet + 1;
    least = Math.min(least, used);
  }
  return least;
}

/** One task's pause, so rendering and input interleave with messages as they do over IPC. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

/** Frames are `[kind: u8 (0 JSON event, 1 Rows page)][length: u32 LE][bytes]`. */
async function replay(url: string): Promise<void> {
  state.heapBeforeBytes = await settledHeap();
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`${url}: HTTP ${response.status}`);
  const reader = response.body.getReader();
  let pending = new Uint8Array(0);
  const started = performance.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      const joined = new Uint8Array(pending.length + value.length);
      joined.set(pending);
      joined.set(value, pending.length);
      pending = joined;
    }
    let at = 0;
    while (pending.length - at >= 5) {
      const length = new DataView(pending.buffer, pending.byteOffset + at + 1, 4).getUint32(0, true);
      if (pending.length - at - 5 < length) break;
      const kind = pending[at];
      // Each IPC message arrives as its own ArrayBuffer.
      const bytes = pending.slice(at + 5, at + 5 + length);
      at += 5 + length;
      if (kind === 1) {
        const t0 = performance.now();
        firstPageAt ??= t0;
        feed.accept(bytes.buffer);
        state.ingestMs.push(performance.now() - t0);
      } else {
        feed.accept(JSON.parse(new TextDecoder().decode(bytes)));
      }
      if (feed.status.state === "failed") throw new Error(feed.status.message);
      state.rows = feed.store?.rowCount ?? 0;
      bump();
      await nextTask();
    }
    pending = pending.slice(at);
    if (done) break;
  }
  state.loadMs = performance.now() - started;
}

function Bench() {
  const [version, setVersion] = useState(0);
  const [columnWidth, setColumnWidth] = useState(DEFAULT_COLUMN_WIDTH);
  // The selection (#397, #398), held here as Topos holds it, so the gate measures the list with it wired.
  const [selection, dispatchSelection] = useReducer(selectCommits, { kind: "none" });
  const { selectedOid, comparedOid } = selectionOids(selection);
  useEffect(() => {
    // Rows are on screen in the first frame after the render that first showed them.
    if (state.firstRowsMs !== null || firstPageAt === null || !feed.store?.rowCount) return;
    const at = firstPageAt;
    requestAnimationFrame(() => {
      state.firstRowsMs ??= performance.now() - at;
    });
  }, [version]);
  useEffect(() => {
    let frame: number | null = null;
    // As useGraphSession does: re-render once per frame, not once per page.
    bump = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setVersion((v) => v + 1);
      });
    };
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="h-screen flex flex-col bg-[#0d1117]">
      {feed.store ? (
        <GraphList
          feed={feed}
          version={version}
          onReachedRow={() => {}}
          columnWidth={columnWidth}
          onColumnWidth={setColumnWidth}
          // Recordings carry no refs, so the benchmark measures rows without badges.
          refs={NO_REFS}
          worktreeAgents={NO_WORKTREE_AGENTS}
          // A dirty worktree's WIP row (#382) shows, so the gate measures the graph with it pinned on top.
          wip={WIP}
          // Ref actions (#393) act on badges, and recordings carry none.
          refContext={null}
          onRefAction={() => {}}
          onPrimary={() => {}}
          announce={() => {}}
          selectedOid={selectedOid}
          onSelect={(oid) => dispatchSelection({ kind: "pick", oid })}
          comparedOid={comparedOid}
          onAddSelection={(oid) => dispatchSelection({ kind: "add", oid })}
          onInspect={() => {}}
        />
      ) : (
        <p role="status">Loading commits…</p>
      )}
    </div>
  );
}

const pages = new URLSearchParams(location.search).get("pages") ?? "/pages";
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Bench />);
replay(pages)
  .then(async () => {
    state.heapAfterBytes = await settledHeap();
    state.phase = "done";
    bump();
  })
  .catch((e: unknown) => {
    state.error = e instanceof Error ? e.message : String(e);
    state.phase = "failed";
  });
