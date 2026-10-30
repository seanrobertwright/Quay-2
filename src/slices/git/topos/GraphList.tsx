import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatDateTime } from "../../../lib/dates";
import type { GraphFeed, GraphStatus } from "./graphFeed";
import { GRAPH_PADDING, LANE_WIDTH, laneX, NODE_RADIUS, rowY, slotPaths } from "./graphPaths";
import type { GraphStore } from "./graphStore";
import { ROW_HEIGHT, rowWindow, sameWindow, type RowWindow } from "./graphWindow";
import { slotColor } from "./laneColors";

export interface GraphListProps {
  feed: GraphFeed;
  /** Bumps when the feed changes. */
  version: number;
  onReachedRow: (windowEnd: number) => void;
}

function statusLine(status: GraphStatus, rows: number): string {
  const loaded = `${rows.toLocaleString()} ${rows === 1 ? "commit" : "commits"}`;
  switch (status.state) {
    case "loading":
      return `Loading commits… ${rows.toLocaleString()} so far`;
    case "paused":
      return `${loaded} loaded; scroll down for more`;
    case "done":
      return loaded;
    case "truncated":
      return `Showing the first ${status.cap.toLocaleString()} commits`;
    case "failed":
      return `${loaded} loaded`;
  }
}

/** Lanes the graph column shows; the resizable column and its stub for the rest are #376. */
const SHOWN_LANES = 12;

function graphWidth(peakLanes: number): number {
  return 2 * GRAPH_PADDING + Math.min(Math.max(peakLanes, 1), SHOWN_LANES) * LANE_WIDTH;
}

/**
 * The lanes for the rows in `win` (#375): one SVG over the window, in window-local y, with one
 * `<path>` per color slot for the edges and the nodes drawn on top.
 */
const GraphLanes: React.FC<{ store: GraphStore; win: RowWindow; width: number }> = ({ store, win, width }) => {
  // Rebuilt on every render: the store grows in place, and a page landing can close an edge in
  // rows already shown. A window holds one edge per open lane plus its own rows' edges, so this
  // stays cheap.
  const edges = store.visibleEdges(win.start, win.end).map((id) => {
    const edge = store.edge(id);
    return { ...edge, slot: store.trackSlot(edge.track) };
  });
  const paths = slotPaths(edges, win);
  const nodes: React.ReactNode[] = [];
  for (let row = win.start; row < win.end; row++) {
    nodes.push(
      <circle
        key={store.oid(row)}
        cx={laneX(store.lane(row))}
        cy={rowY(row, win.start)}
        r={NODE_RADIUS}
        fill={slotColor(store.trackSlot(store.track(row)))}
      />
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="absolute left-0 top-0 pointer-events-none"
      width={width}
      height={(win.end - win.start) * ROW_HEIGHT}
    >
      {/* The index is the color slot, a fixed identity in a fixed-length array, so it is a stable key. */}
      {paths.map((d, slot) =>
        d === "" ? null : <path key={slot} d={d} fill="none" stroke={slotColor(slot)} strokeWidth={2} />
      )}
      {nodes}
    </svg>
  );
};

/**
 * The commit list (#374): one scroll container over a spacer as tall as every loaded row, with
 * only a window of rows in the DOM, and the lane graph (#375) drawn over the window's left edge.
 */
export const GraphList: React.FC<GraphListProps> = ({ feed, version, onReachedRow }) => {
  const scroller = useRef<HTMLDivElement>(null);
  // The scroll offset lives in a ref: only a change of window, not every pixel, re-renders.
  const scrollTop = useRef(0);
  const [height, setHeight] = useState(0);
  const store = feed.store;
  const rowCount = store?.rowCount ?? 0;
  const [win, setWin] = useState<RowWindow>({ start: 0, end: 0 });

  const updateWindow = useCallback(() => {
    const next = rowWindow(scrollTop.current, scroller.current?.clientHeight ?? height, rowCount);
    setWin((prev) => (sameWindow(prev, next) ? prev : next));
  }, [height, rowCount]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Rows loading or the viewport resizing can move the window too.
  useLayoutEffect(updateWindow, [updateWindow]);

  useEffect(() => {
    if (win.end > 0) onReachedRow(win.end);
  }, [win.end, version, onReachedRow]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    scrollTop.current = e.currentTarget.scrollTop;
    updateWindow();
  };

  const laneColumn = graphWidth(store?.peakLanes ?? 1);
  const rows: React.ReactNode[] = [];
  if (store) {
    for (let row = win.start; row < win.end; row++) {
      const author = store.author(row);
      const subject = store.subject(row);
      rows.push(
        <div
          key={store.oid(row)}
          role="listitem"
          aria-posinset={row + 1}
          aria-setsize={feed.status.state === "done" ? rowCount : -1}
          className="flex items-center gap-3 pr-3 text-xs border-b border-[#21262d]/60 hover:bg-[#161b22]"
          style={{ height: ROW_HEIGHT }}
        >
          <span className="shrink-0" style={{ width: laneColumn }} aria-hidden="true" />
          <span className="flex-1 min-w-0 truncate text-[#c9d1d9]" title={subject}>
            {subject}
          </span>
          <span className="w-40 shrink-0 truncate text-[#8b949e]" title={author.email}>
            {author.name}
          </span>
          <span className="w-40 shrink-0 truncate text-right text-[#8b949e] tabular-nums">
            {formatDateTime(store.authorTimeMs(row))}
          </span>
        </div>
      );
    }
  }

  const status = feed.status;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        ref={scroller}
        onScroll={onScroll}
        // Chromium makes a scroll container keyboard-focusable on its own; row focus comes with #397.
        className="flex-1 min-h-0 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
      >
        <div
          role="list"
          aria-label="Commits"
          aria-busy={status.state === "loading"}
          className="relative"
          style={{ height: rowCount * ROW_HEIGHT }}
        >
          <div className="absolute inset-x-0" style={{ transform: `translateY(${win.start * ROW_HEIGHT}px)` }}>
            {rows}
            {store && win.end > win.start && <GraphLanes store={store} win={win} width={laneColumn} />}
          </div>
        </div>
      </div>
      <footer className="h-7 px-3 shrink-0 flex items-center gap-3 border-t border-[#30363d] bg-[#161b22] text-[11px] text-[#8b949e]">
        <span role="status">{statusLine(status, rowCount)}</span>
        {status.state === "failed" && (
          <span role="alert" className="text-[#f85149] truncate min-w-0" title={status.message}>
            {status.message}
          </span>
        )}
      </footer>
    </div>
  );
};
