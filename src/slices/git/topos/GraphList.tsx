import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "../../../lib/dates";
import {
  clampColumnWidth,
  columnLayout,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  resizeByKey,
  type ColumnLayout,
} from "./graphColumn";
import type { GraphFeed, GraphStatus } from "./graphFeed";
import { hitNode, rowAt } from "./graphHit";
import { collapsedLane, laneX, NODE_RADIUS, rowY, slotPaths } from "./graphPaths";
import { shortOid, type GraphStore } from "./graphStore";
import { renderedActiveRow, ROW_HEIGHT, rowWindow, sameWindow, type RowWindow } from "./graphWindow";
import { slotColor } from "./laneColors";
import {
  clampOffset,
  keyOffset,
  offsetAfterScroll,
  scrollScale,
  scrollTopFor,
  wheelOffset,
  windowTop,
} from "./scaledScroll";

export interface GraphListProps {
  feed: GraphFeed;
  /** Bumps when the feed changes. */
  version: number;
  onReachedRow: (windowEnd: number) => void;
  /** The graph column's width in px, kept by the caller so it outlives the list. */
  columnWidth: number;
  onColumnWidth: (width: number) => void;
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

/** The stub column's stroke: grey, so it reads as "more lanes", not as a track (#351). */
const STUB_COLOR = "#8b949e";
/** How far right of its node the tooltip starts. */
const TOOLTIP_GAP = 12;

/**
 * The lanes for the rows in `win` (#375, #376): one SVG over the window, in window-local y, with
 * one `<path>` per color slot for the edges, one grey dashed `<path>` for the stub column, and the
 * nodes drawn on top.
 */
const GraphLanes = React.memo<{
  store: GraphStore;
  /** Bumps when a page lands, which can close an edge in rows already shown. */
  version: number;
  win: RowWindow;
  layout: ColumnLayout;
}>(function GraphLanes({ store, win, layout }) {
  const stubDash = useId();
  // A window holds one edge per open lane plus its own rows' edges, so rebuilding these whenever
  // the window, the column or the store changes stays cheap.
  const edges = store.visibleEdges(win.start, win.end).map((id) => {
    const edge = store.edge(id);
    return { ...edge, slot: store.trackSlot(edge.track) };
  });
  const { slots, stub } = slotPaths(edges, win, layout);
  const nodes: React.ReactNode[] = [];
  for (let row = win.start; row < win.end; row++) {
    const lane = collapsedLane(store.lane(row), layout.stubLane);
    const stubbed = lane === layout.stubLane;
    nodes.push(
      <circle
        key={store.oid(row)}
        cx={laneX(lane)}
        cy={rowY(row, win.start)}
        r={stubbed ? NODE_RADIUS - 1.5 : NODE_RADIUS}
        fill={stubbed ? STUB_COLOR : slotColor(store.trackSlot(store.track(row)))}
      />
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="absolute left-0 top-0 pointer-events-none"
      width={layout.width}
      height={(win.end - win.start) * ROW_HEIGHT}
    >
      {/* The index is the color slot, a fixed identity in a fixed-length array, so it is a stable key. */}
      {slots.map((d, slot) =>
        d === "" ? null : <path key={slot} d={d} fill="none" stroke={slotColor(slot)} strokeWidth={2} />
      )}
      {/* The stub's 4-on, 3-off dashes come from a striped paint, not stroke-dasharray: Chromium
          re-dashes a dashed path on every raster, which cost ~100 ms a frame on Linux's graph (#377). */}
      <defs>
        <pattern id={stubDash} patternUnits="userSpaceOnUse" width={layout.width} height={7}>
          <rect width={layout.width} height={4} fill={STUB_COLOR} />
        </pattern>
      </defs>
      {stub !== "" && <path d={stub} fill="none" stroke={`url(#${stubDash})`} strokeWidth={1.5} />}
      {nodes}
    </svg>
  );
});

/**
 * The sticky strip above the list (#376): the tracks passing the top visible row whose tips have
 * scrolled above it. A track's tip is where it starts in the graph (#351): its first row, or the
 * merge row whose ribbon opened it. Clicking a name scrolls to it.
 */
const TrackStrip: React.FC<{ store: GraphStore | null; topRow: number; onJump: (row: number) => void }> = ({
  store,
  topRow,
  onJump,
}) => {
  const tracks = store ? store.tracksPassing(topRow) : [];
  return (
    <div className="h-6 shrink-0 flex items-center px-2 overflow-x-auto border-b border-[#30363d] bg-[#0d1117]">
      {store && tracks.length > 0 && (
        <ul aria-label="Tracks above" className="flex items-center gap-1">
          {tracks.map((t) => {
            const label = store.trackLabel(t.track);
            return (
              <li key={t.track} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onJump(t.startRow)}
                  title={`Scroll to where ${label} starts`}
                  className="inline-flex items-center gap-1 max-w-48 px-1.5 py-0.5 rounded text-[11px] text-[#c9d1d9] hover:bg-[#161b22] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
                >
                  <span
                    aria-hidden="true"
                    className="w-2 h-2 shrink-0 rounded-full"
                    style={{ background: slotColor(store.trackSlot(t.track)) }}
                  />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/**
 * The commit list (#374): one scroll container over a spacer as tall as every loaded row, with
 * only a window of rows in the DOM, and the lane graph (#375) drawn over the window's left edge in
 * a column the operator resizes (#376). Past 8M px of rows the spacer stops growing and the list
 * scrolls scaled (#377): the content offset is the source of truth, a wheel event moves it by its
 * `deltaY`, scroll keys and jumps set it, and the scrollbar maps onto it proportionally.
 */
export const GraphList: React.FC<GraphListProps> = ({ feed, version, onReachedRow, columnWidth, onColumnWidth }) => {
  const scroller = useRef<HTMLDivElement>(null);
  // The content offset in px lives in a ref: only a change of window or of top row, not every
  // pixel, re-renders. Natively it is the scrollTop; scaled, the scrollTop maps onto it.
  const offset = useRef(0);
  // Positioned by hand on every scroll, since scaled the window moves against the spacer.
  const layer = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const store = feed.store;
  const rowCount = store?.rowCount ?? 0;
  const peakLanes = store?.peakLanes ?? 1;
  const [win, setWin] = useState<RowWindow>({ start: 0, end: 0 });
  // Only the strip reads it; the rows are memoized, so a new top row alone doesn't rebuild them.
  const [topRow, setTopRow] = useState(0);
  // Keyed by session, so a session reopened in place doesn't inherit another history's row.
  const [active, setActive] = useState<{ sessionId: number; row: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const idPrefix = useId();
  const scale = useMemo(() => scrollScale(rowCount * ROW_HEIGHT, height), [rowCount, height]);
  // Handlers read these, so a scroll between a state change and its commit uses what is in the DOM.
  const scaleRef = useRef(scale);
  const winRef = useRef(win);

  const updateWindow = useCallback(() => {
    const top = offset.current;
    const next = rowWindow(top, scroller.current?.clientHeight ?? height, rowCount);
    setWin((prev) => (sameWindow(prev, next) ? prev : next));
    setTopRow(Math.floor(top / ROW_HEIGHT));
  }, [height, rowCount]);

  const placeWindow = useCallback(() => {
    const el = scroller.current;
    if (el && layer.current) {
      layer.current.style.transform = `translateY(${windowTop(el.scrollTop, offset.current, winRef.current.start)}px)`;
    }
  }, []);

  /** Moves the content to `next` and the scrollbar to where it maps. */
  const scrollToOffset = useCallback(
    (next: number) => {
      const el = scroller.current;
      if (!el) return;
      offset.current = clampOffset(scaleRef.current, next);
      // The scroll event this causes lands on the same offset, and a scrollTop already there fires none.
      el.scrollTop = scrollTopFor(scaleRef.current, offset.current);
      placeWindow();
      updateWindow();
    },
    [placeWindow, updateWindow]
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Rows loading or the viewport resizing change the scale and can move the window; the content
  // offset holds still, so crossing into scaled scrolling while rows load keeps the view in place.
  useLayoutEffect(() => {
    scaleRef.current = scale;
    const el = scroller.current;
    if (el) {
      offset.current = clampOffset(scale, offset.current);
      el.scrollTop = scrollTopFor(scale, offset.current);
    }
    placeWindow();
    updateWindow();
  }, [scale, placeWindow, updateWindow]);

  useLayoutEffect(() => {
    winRef.current = win;
    placeWindow();
  }, [win, placeWindow]);

  // Scaled, the browser would scroll the wheel's deltaY in scrollbar pixels, `ratio` times too far.
  // React's onWheel is passive and can't prevent that, so this listens directly.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !scale.scaled) return;
    const onWheel = (e: WheelEvent) => {
      // A pinch or Ctrl+wheel zooms, and a sideways wheel scrolls no rows.
      if (e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      scrollToOffset(wheelOffset(scaleRef.current, offset.current, e.deltaY, e.deltaMode, el.clientHeight));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale.scaled, scrollToOffset]);

  useEffect(() => {
    if (win.end > 0) onReachedRow(win.end);
  }, [win.end, version, onReachedRow]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    offset.current = offsetAfterScroll(scaleRef.current, offset.current, e.currentTarget.scrollTop);
    placeWindow();
    updateWindow();
  };

  // Natively the browser scrolls for these keys; scaled it would move the scrollbar, not the content.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!scaleRef.current.scaled || e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    const next = keyOffset(scaleRef.current, offset.current, e.key, e.shiftKey, e.currentTarget.clientHeight);
    if (next === null) return;
    e.preventDefault();
    scrollToOffset(next);
  };

  const jumpTo = (row: number) => {
    const el = scroller.current;
    if (!el || !store) return;
    scrollToOffset(row * ROW_HEIGHT);
    setActive({ sessionId: store.sessionId, row });
    el.focus({ preventScroll: true });
  };

  const layout = useMemo(() => columnLayout(columnWidth, peakLanes), [columnWidth, peakLanes]);
  // aria-activedescendant must always name a row in the DOM (#351), so the active row is clamped
  // to the window while it is scrolled away.
  const activeRow = renderedActiveRow(
    active !== null && store !== null && active.sessionId === store.sessionId ? active.row : null,
    win
  );
  const hovered = hover !== null && hover >= win.start && hover < win.end ? hover : null;

  // One handler for the whole canvas: the hovered node comes from arithmetic over the pointer's
  // position, not from listeners on each node (#351).
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!store) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const row =
      x > layout.width ? null : hitNode(x, e.clientY - box.top, win, (r) => collapsedLane(store.lane(r), layout.stubLane));
    setHover((prev) => (prev === row ? prev : row));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!store) return;
    const row = rowAt(e.clientY - e.currentTarget.getBoundingClientRect().top, win);
    if (row !== null) setActive({ sessionId: store.sessionId, row });
  };

  const statusState = feed.status.state;
  const rows = useMemo(() => {
    const out: React.ReactNode[] = [];
    if (!store) return out;
    for (let row = win.start; row < win.end; row++) {
      const author = store.author(row);
      const subject = store.subject(row);
      const isActive = row === activeRow;
      out.push(
        <div
          key={store.oid(row)}
          id={`${idPrefix}-row-${row}`}
          role="option"
          aria-selected={isActive}
          aria-posinset={row + 1}
          aria-setsize={statusState === "done" ? rowCount : -1}
          className={`flex items-center gap-3 pr-3 text-xs border-b border-[#21262d]/60 hover:bg-[#161b22] ${
            isActive ? "bg-[#161b22] group-focus-visible:shadow-[inset_0_0_0_1px_#06B6D4]" : ""
          }`}
          style={{ height: ROW_HEIGHT }}
        >
          <span className="shrink-0" style={{ width: layout.width }} aria-hidden="true" />
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
    return out;
    // Rows already loaded never change, so the window and the row count cover the store growing.
  }, [store, win, activeRow, layout.width, idPrefix, statusState, rowCount]);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, x: e.clientX, width: layout.width };
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d && d.pointerId === e.pointerId) onColumnWidth(clampColumnWidth(d.width + e.clientX - d.x));
  };
  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };
  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = resizeByKey(layout.width, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    onColumnWidth(next);
  };

  const shownLanes = layout.stubLane ?? Math.max(peakLanes, 1);
  const handleText = `${layout.width} px, ${shownLanes} ${shownLanes === 1 ? "lane" : "lanes"}${
    layout.stubLane === null ? "" : " and a stub"
  }`;
  const hoveredTrack = store && hovered !== null ? store.track(hovered) : null;

  const status = feed.status;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TrackStrip store={store} topRow={topRow} onJump={jumpTo} />
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          role="listbox"
          aria-label="Commits"
          aria-busy={status.state === "loading"}
          aria-activedescendant={activeRow === null ? undefined : `${idPrefix}-row-${activeRow}`}
          tabIndex={0}
          className="group flex-1 min-h-0 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
        >
          {/* Clipped, so overscan rows past the end never make the spacer taller (#370). */}
          <div className="relative overflow-clip" style={{ height: scale.spacerHeight }}>
            {/* The pointer only hovers nodes and picks the active row here; moving it by key is #397's. */}
            <div
              ref={layer}
              className="absolute inset-x-0 top-0"
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(null)}
              onPointerDown={onPointerDown}
            >
              {rows}
              {store && win.end > win.start && (
                <GraphLanes store={store} version={version} win={win} layout={layout} />
              )}
              {store && hovered !== null && hoveredTrack !== null && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-10 max-w-md px-2 py-1 rounded border border-[#30363d] bg-[#161b22] text-[11px] text-[#c9d1d9] shadow-lg"
                  style={{
                    left: laneX(collapsedLane(store.lane(hovered), layout.stubLane)) + TOOLTIP_GAP,
                    top: (hovered - win.start + 1) * ROW_HEIGHT,
                  }}
                >
                  <div className="truncate">
                    <span className="font-mono text-[#8b949e]">{shortOid(store.oid(hovered))}</span>{" "}
                    {store.subject(hovered)}
                  </div>
                  <div className="truncate text-[#8b949e]">
                    {store.trackLabel(hoveredTrack)} ·{" "}
                    {store.author(hovered).name} · {formatDateTime(store.authorTimeMs(hovered))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA 1.2 focusable window splitter (separator with aria-valuenow) */}
        <div role="separator" tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize graph column"
          aria-valuenow={layout.width}
          aria-valuemin={MIN_COLUMN_WIDTH}
          aria-valuemax={MAX_COLUMN_WIDTH}
          aria-valuetext={handleText}
          title="Drag, or use the arrow keys, to resize the graph column"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onKeyDown={onHandleKeyDown}
          className="group/handle absolute top-0 bottom-0 z-20 w-[9px] -ml-[4px] cursor-col-resize flex justify-center outline-none touch-none"
          style={{ left: layout.width }}
        >
          <div className="w-px h-full bg-[#30363d]/60 group-hover/handle:bg-[#58a6ff] group-focus-visible/handle:w-[2px] group-focus-visible/handle:bg-[#58a6ff]" />
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
