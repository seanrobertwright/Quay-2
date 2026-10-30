import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Bot, Cloud, FolderGit2, GitBranch, Tag } from "lucide-react";
import { formatDateTime } from "../../../lib/dates";
import { usePopupLayer } from "../../overlay/useOverlay";
import { AgentIcon } from "../../terminal/AgentIcons";
import type { RunKind } from "../../terminal/types";
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
import type { Badge, RefsView } from "./graphRefs";
import { collapsedLane, laneX, NODE_RADIUS, rowY, slotPaths } from "./graphPaths";
import type { GraphAgent } from "./graphPage";
import { authorLine, nodeLabel, nodeTooltip, splitAgents } from "./provenance";
import { shortOid, type GraphStore } from "./graphStore";
import { renderedActiveRow, ROW_HEIGHT, rowWindow, sameWindow, type RowWindow } from "./graphWindow";
import { slotColor } from "./laneColors";
import { menuIndexByKey, splitStrip } from "./trackStrip";
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
  /** Each commit's ref and worktree HEAD badges and the footer's ref lines (#378). */
  refs: RefsView;
  /** The live agent terminals in each worktree, by the path its HEAD badge names (#381). */
  worktreeAgents: ReadonlyMap<string, RunKind[]>;
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

/** Badges a row shows before folding the rest into "+N". */
const SHOWN_BADGES = 3;

function badgeKey(b: Badge): string {
  return b.kind === "head" ? `head:${b.path}` : `${b.kind}:${b.name}`;
}

/** Each badge kind's icon, tooltip and colors. */
const BADGE_KINDS: Record<Badge["kind"], { Icon: typeof GitBranch; title: (name: string) => string; className: string }> = {
  head: { Icon: FolderGit2, title: (name) => `HEAD of worktree ${name}`, className: "border-[#06B6D4]/60 text-[#67e8f9]" },
  local: { Icon: GitBranch, title: (name) => `Branch ${name}`, className: "border-[#3fb950]/60 text-[#7ee787]" },
  remote: { Icon: Cloud, title: (name) => `Remote branch ${name}`, className: "border-[#bc8cff]/60 text-[#d2a8ff]" },
  tag: { Icon: Tag, title: (name) => `Tag ${name}`, className: "border-[#d29922]/60 text-[#e3b341]" },
};

/** The selected worktree's HEAD: filled rather than outlined. */
const CURRENT_HEAD_CLASS = "bg-[#06B6D4] border-[#06B6D4] text-[#0d1117] font-semibold";

function isCurrentHead(b: Badge): boolean {
  return b.kind === "head" && b.current;
}

function badgeTitle(b: Badge): string {
  return isCurrentHead(b) ? `HEAD of ${b.name}, the selected worktree` : BADGE_KINDS[b.kind].title(b.name);
}

/**
 * A commit's badges (#378). The selected worktree's HEAD reads "HEAD" in a filled badge, so it is
 * marked by text and shape as well as color, and its row carries `aria-current`.
 */
const RowBadges: React.FC<{ badges: Badge[]; worktreeAgents: ReadonlyMap<string, RunKind[]> }> = ({
  badges,
  worktreeAgents,
}) => {
  const shown = badges.slice(0, SHOWN_BADGES);
  const rest = badges.slice(SHOWN_BADGES);
  return (
    <span className="shrink-0 flex items-center gap-1 max-w-[50%] overflow-hidden">
      {shown.map((b) => {
        const { Icon, className } = BADGE_KINDS[b.kind];
        const current = isCurrentHead(b);
        const look = current ? CURRENT_HEAD_CLASS : className;
        return (
          <span
            key={badgeKey(b)}
            title={badgeTitle(b)}
            className={`inline-flex items-center gap-1 max-w-40 px-1.5 rounded border text-[10px] leading-4 ${look}`}
          >
            <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
            {current && <span>HEAD</span>}
            <span className="truncate">{b.name}</span>
            {current && <span className="sr-only">(selected worktree)</span>}
            {b.kind === "head" && <HeadAgents kinds={worktreeAgents.get(b.path) ?? []} />}
          </span>
        );
      })}
      {rest.length > 0 && (
        <span className="shrink-0 text-[10px] text-[#8b949e]" title={rest.map(badgeTitle).join("\n")}>
          +{rest.length}
        </span>
      )}
    </span>
  );
};

/**
 * The live agent terminals working in a worktree, on its HEAD marker (#381): at most three icons,
 * then "+N". Display only.
 */
const HeadAgents: React.FC<{ kinds: RunKind[] }> = ({ kinds }) => {
  if (kinds.length === 0) return null;
  const { shown, more } = splitAgents(kinds);
  return (
    <span className="shrink-0 inline-flex items-center gap-0.5" title={`Agents working here: ${kinds.join(", ")}`}>
      {shown.map(({ kind, key }) => (
        <AgentIcon key={key} kind={kind} className="w-3 h-3" />
      ))}
      {more > 0 && <span>+{more}</span>}
      <span className="sr-only">, agents working here: {kinds.join(", ")}</span>
    </span>
  );
};

/** An agent commit's node radius: room for its icon inside the ring (#381). */
const AGENT_NODE_RADIUS = 7;
const AGENT_ICON_SIZE = 10;
/** The dark fill behind an agent's icon. */
const AGENT_NODE_FILL = "#0d1117";

/** An agent commit's icon, or a generic agent glyph for a stamp naming no known agent. */
const NodeAgentIcon: React.FC<{ agent: GraphAgent }> = ({ agent }) =>
  agent.kind === null ? (
    <Bot className="w-full h-full text-[#8b949e]" aria-hidden="true" />
  ) : (
    <AgentIcon kind={agent.kind} className="w-full h-full" />
  );

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
  const icons: React.ReactNode[] = [];
  for (let row = win.start; row < win.end; row++) {
    const lane = collapsedLane(store.lane(row), layout.stubLane);
    const stubbed = lane === layout.stubLane;
    const color = stubbed ? STUB_COLOR : slotColor(store.trackSlot(store.track(row)));
    const agent = store.agent(row);
    const cx = laneX(lane);
    const cy = rowY(row, win.start);
    if (agent === null) {
      nodes.push(
        <circle key={store.oid(row)} cx={cx} cy={cy} r={stubbed ? NODE_RADIUS - 1.5 : NODE_RADIUS} fill={color} />
      );
      continue;
    }
    // An agent commit rings its icon in the lane color: solid for a Quay stamp, dashed for an
    // inferred co-author, so the source shows by line style and label, not by color alone.
    nodes.push(
      <circle
        key={store.oid(row)}
        cx={cx}
        cy={cy}
        r={AGENT_NODE_RADIUS}
        fill={AGENT_NODE_FILL}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={agent.source === "coauthor" ? "2.5 2" : undefined}
      />
    );
    icons.push(
      <span
        key={store.oid(row)}
        className="absolute"
        style={{
          left: cx - AGENT_ICON_SIZE / 2,
          top: cy - AGENT_ICON_SIZE / 2,
          width: AGENT_ICON_SIZE,
          height: AGENT_ICON_SIZE,
        }}
      >
        <NodeAgentIcon agent={agent} />
      </span>
    );
  }
  return (
    <>
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
      {/* The icons sit in HTML over their rings: the shared AgentIcon is a standalone svg sized by class. */}
      {icons.length > 0 && (
        <div aria-hidden="true" className="absolute left-0 top-0 pointer-events-none">
          {icons}
        </div>
      )}
    </>
  );
});

const jumpTitle = (store: GraphStore, track: number) => `Scroll to where ${store.trackLabel(track)} starts`;

/** A track's color dot and name, as the strip and its More menu show it. */
const TrackName: React.FC<{ store: GraphStore; track: number }> = ({ store, track }) => (
  <>
    <span
      aria-hidden="true"
      className="w-2 h-2 shrink-0 rounded-full"
      style={{ background: slotColor(store.trackSlot(track)) }}
    />
    <span className="truncate">{store.trackLabel(track)}</span>
  </>
);

/**
 * The sticky strip above the list (#376): the tracks passing the top visible row whose tips have
 * scrolled above it. A track's tip is where it starts in the graph (#351): its first row, or the
 * merge row whose ribbon opened it. Clicking a name scrolls to it. On a wide history only the
 * leftmost names show inline and the rest wait behind a More menu (#409), so a jump rebuilds a
 * bounded number of buttons however many tracks are open.
 */
const TrackStrip = React.memo<{
  store: GraphStore | null;
  topRow: number;
  onJump: (row: number) => void;
}>(function TrackStrip({ store, topRow, onJump }) {
  const [isOpen, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const tracks = store ? store.tracksPassing(topRow) : [];
  const { shown, more } = splitStrip(tracks);
  const open = isOpen && more.length > 0;
  // A refresh can shorten the menu under its focused item.
  const focused = Math.min(focusIndex, more.length - 1);

  // Scrolling closes the menu, so an open menu never rebuilds per frame; focus inside it goes back
  // to the trigger rather than falling to the page.
  const openedAt = useRef(topRow);
  useLayoutEffect(() => {
    if (openedAt.current === topRow) return;
    openedAt.current = topRow;
    if (menu.current?.contains(document.activeElement)) trigger.current?.focus();
    setOpen(false);
  }, [topRow]);

  useEffect(() => {
    if (open) items.current[focused]?.focus();
  }, [open, focused]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const jump = (row: number) => {
    setOpen(false);
    onJump(row);
  };
  // Escape reaches the overlay stack before the menu, so the menu joins it to close first.
  usePopupLayer(open, () => close(true), menu);
  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const next = menuIndexByKey(focused, more.length, e.key);
    if (next === null) return;
    e.preventDefault();
    setFocusIndex(next);
  };
  // Focus leaving the trigger and the menu, by a click outside or by Tab, closes it.
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  };

  const itemClass =
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[#c9d1d9] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60";
  return (
    <div className="relative h-6 shrink-0 flex items-center border-b border-[#30363d] bg-[#0d1117]">
      <div className="flex-1 min-w-0 h-full flex items-center px-2 overflow-x-auto overflow-y-hidden">
        {store && shown.length > 0 && (
          <ul aria-label="Tracks above" className="flex items-center gap-1">
            {shown.map((t) => (
              <li key={t.track} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onJump(t.startRow)}
                  title={jumpTitle(store, t.track)}
                  className={`${itemClass} max-w-48 hover:bg-[#161b22]`}
                >
                  <TrackName store={store} track={t.track} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {store && more.length > 0 && (
        <div className="shrink-0 pr-2" onBlur={onBlur}>
          <button
            ref={trigger}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            aria-label={`+${more.length.toLocaleString()} more ${more.length === 1 ? "track" : "tracks"} above`}
            onClick={() => {
              if (open) return close(false);
              setFocusIndex(0);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
              e.preventDefault();
              setFocusIndex(e.key === "ArrowDown" ? 0 : more.length - 1);
              setOpen(true);
            }}
            className="px-1.5 py-0.5 rounded text-[11px] text-[#8b949e] hover:bg-[#161b22] hover:text-[#c9d1d9] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
          >
            +{more.length.toLocaleString()} more
          </button>
          {open && (
            <ul
              ref={menu}
              id={menuId}
              role="menu"
              aria-label="More tracks above"
              onKeyDown={onMenuKeyDown}
              className="absolute right-2 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto p-1 flex flex-col rounded border border-[#30363d] bg-[#161b22] shadow-lg"
            >
              {more.map((t, i) => (
                <li key={t.track} role="none">
                  <button
                    ref={(el) => {
                      items.current[i] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={i === focused ? 0 : -1}
                    onClick={() => jump(t.startRow)}
                    title={jumpTitle(store, t.track)}
                    className={`${itemClass} w-full hover:bg-[#0d1117]`}
                  >
                    <TrackName store={store} track={t.track} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * The commit list (#374): one scroll container over a spacer as tall as every loaded row, with
 * only a window of rows in the DOM, and the lane graph (#375) drawn over the window's left edge in
 * a column the operator resizes (#376). Past 8M px of rows the spacer stops growing and the list
 * scrolls scaled (#377): the content offset is the source of truth, a wheel event moves it by its
 * `deltaY`, scroll keys and jumps set it, and the scrollbar maps onto it proportionally.
 */
export const GraphList: React.FC<GraphListProps> = ({
  feed,
  version,
  onReachedRow,
  columnWidth,
  onColumnWidth,
  refs,
  worktreeAgents,
}) => {
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
  // The strip follows at low priority: while jumps land every frame its render keeps yielding to
  // the rows', and it catches up once the list settles (#409).
  const stripRow = useDeferredValue(topRow);
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

  // A refresh that splices or resets swaps in a new store (#379). The view stays anchored to the
  // commit at the top of the viewport, and the selection follows its commit or clears if it is gone.
  // The list turns off the browser's own scroll anchoring, which measures rows inside the moving
  // window layer and so shifted the view by the window's 8-row steps on top of this.
  const shownStore = useRef(store);
  useLayoutEffect(() => {
    const before = shownStore.current;
    shownStore.current = store;
    if (before === null || store === null || before === store || before.rowCount === 0) return;
    const top = Math.min(Math.floor(offset.current / ROW_HEIGHT), before.rowCount - 1);
    const row = store.rowOf(before.oid(top));
    if (row !== -1) scrollToOffset(row * ROW_HEIGHT + (offset.current - top * ROW_HEIGHT));
    setActive((prev) => {
      if (prev === null || prev.sessionId !== before.sessionId || prev.row >= before.rowCount) return prev;
      const moved = store.rowOf(before.oid(prev.row));
      return moved === -1 ? null : { sessionId: store.sessionId, row: moved };
    });
  }, [store, scrollToOffset]);

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

  const jumpTo = useCallback(
    (row: number) => {
      const el = scroller.current;
      if (!el || !store) return;
      scrollToOffset(row * ROW_HEIGHT);
      setActive({ sessionId: store.sessionId, row });
      el.focus({ preventScroll: true });
    },
    [store, scrollToOffset]
  );

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
      const agent = store.agent(row);
      const subject = store.subject(row);
      const isActive = row === activeRow;
      const oid = store.oid(row);
      const rowBadges = refs.badges.get(oid);
      const holdsCurrentHead = rowBadges?.some(isCurrentHead) ?? false;
      out.push(
        <div
          key={oid}
          id={`${idPrefix}-row-${row}`}
          role="option"
          aria-selected={isActive}
          aria-current={holdsCurrentHead ? "true" : undefined}
          aria-posinset={row + 1}
          aria-setsize={statusState === "done" ? rowCount : -1}
          className={`flex items-center gap-3 pr-3 text-xs border-b border-[#21262d]/60 hover:bg-[#161b22] ${
            isActive ? "bg-[#161b22] group-focus-visible:shadow-[inset_0_0_0_1px_#06B6D4]" : ""
          }`}
          style={{ height: ROW_HEIGHT }}
        >
          {/* The node's spoken label; the node itself is drawn in the aria-hidden lane graph. */}
          <span role="img" aria-label={nodeLabel(agent, author.name)} className="shrink-0" style={{ width: layout.width }} />
          {rowBadges && <RowBadges badges={rowBadges} worktreeAgents={worktreeAgents} />}
          <span className="flex-1 min-w-0 truncate text-[#c9d1d9]" title={subject}>
            {subject}
          </span>
          <span className="w-40 shrink-0 truncate text-[#8b949e]" title={author.email}>
            {authorLine(author.name, agent)}
          </span>
          <span className="w-40 shrink-0 truncate text-right text-[#8b949e] tabular-nums">
            {formatDateTime(store.authorTimeMs(row))}
          </span>
        </div>
      );
    }
    return out;
    // Rows already loaded never change, so the window and the row count cover the store growing.
  }, [store, win, activeRow, layout.width, idPrefix, statusState, rowCount, refs.badges, worktreeAgents]);

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
      <TrackStrip store={store} topRow={stripRow} onJump={jumpTo} />
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
          className="group flex-1 min-h-0 overflow-y-auto [overflow-anchor:none] outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
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
                  {/* Text children, so React escapes an unknown stamp's untrusted value. */}
                  {nodeTooltip(store.agent(hovered), store.author(hovered).name).map((line) => (
                    <div key={line} className="truncate font-medium">
                      {line}
                    </div>
                  ))}
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
        {refs.tagOnlyNote && (
          <span title="Graph sessions don't walk tags, so commits only a tag reaches aren't drawn">{refs.tagOnlyNote}</span>
        )}
        {refs.error && (
          <span role="alert" className="text-[#f85149] truncate min-w-0" title={refs.error}>
            {refs.error}
          </span>
        )}
        {status.state === "failed" && (
          <span role="alert" className="text-[#f85149] truncate min-w-0" title={status.message}>
            {status.message}
          </span>
        )}
      </footer>
    </div>
  );
};
