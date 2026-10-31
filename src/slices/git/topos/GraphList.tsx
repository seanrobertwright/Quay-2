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
import { badgeMenu, commitMenu, graphKey, nextBadge, primaryAction, type MenuItem, type PrimaryAction, type RefAction, type RefContext } from "./refActions";
import { collapsedLane, laneX, NODE_RADIUS, rowY, slotPaths } from "./graphPaths";
import type { GraphAgent } from "./graphPage";
import { authorLine, nodeLabel, nodeTooltip, splitAgents } from "./provenance";
import { shortOid, type GraphStore } from "./graphStore";
import { renderedActiveRow, ROW_HEIGHT, rowWindow, sameWindow, type RowWindow } from "./graphWindow";
import { movedRow, offsetShowing, selectionKey } from "./commitSelection";
import { isFindable, isMatch, type FindKeyEvent } from "./graphFind";
import { FindText, GraphFindBar } from "./GraphFindBar";
import { useFindController } from "./useGraphFind";
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
  /** The WIP row (#382), while the selected worktree is dirty; null hides it. */
  wip: WipRowProps | null;
  /** What the badge and row menus need (#393); null offers no ref actions. */
  refContext: RefContext | null;
  /** Runs a menu item's or a key's action. */
  onRefAction: (action: RefAction) => void;
  /** Runs a badge's double-click or Enter, or says why it can't. */
  onPrimary: (primary: PrimaryAction) => void;
  /** Speaks a sentence in Topos's live region, such as the badge the cursor moved to. */
  announce: (text: string) => void;
  /**
   * The selected commit (#397), kept by the caller so details mode and the parent links share it.
   * A change from outside, such as a parent link, selects that commit's row and scrolls it into view.
   */
  selectedOid: string | null;
  /** The operator selected a commit, by click or key. */
  onSelect: (oid: string) => void;
  /** The second commit selected to compare (#398), or null; its row is selected too. */
  comparedOid: string | null;
  /** A Ctrl- or Shift-click, or Ctrl+Space or Shift+Space on the cursor row, adds a commit to compare. */
  onAddSelection: (oid: string) => void;
  /** Enter on the selected commit: focus moves to the inspector. */
  onInspect: () => void;
  /** Set to a function that puts focus back on the list, for the inspector's Escape. */
  focusRef?: React.MutableRefObject<(() => void) | null>;
  /** Whether Topos shows; hiding it clears the find, which is never kept (#369, #399). */
  visible: boolean;
  /**
   * Set to the find's key handler (#399), which Topos calls for keys anywhere in it: Ctrl+F opens
   * the find, F3 and Shift+F3 step, and Enter and Shift+Enter step from its field. It returns
   * whether it handled the key.
   */
  findKeysRef?: React.MutableRefObject<((e: FindKeyEvent) => boolean) | null>;
}

export interface WipRowProps {
  /** "n changed", counting every change. */
  label: string;
  /** The selected worktree's HEAD, which the row sits on. */
  headOid: string | null;
  worktreeName: string;
  /** Whether the staging inspector shows. */
  open: boolean;
  onToggle: () => void;
  /** The inspector's id. */
  controls: string;
}

/**
 * The WIP row (#382): pinned at the top of the graph while the selected worktree is dirty, with a
 * hollow dashed node in its HEAD's lane and color, so it reads as the work sitting on that HEAD.
 * Selecting it opens the staging inspector.
 */
const WipRow: React.FC<{ wip: WipRowProps; store: GraphStore | null; layout: ColumnLayout }> = ({ wip, store, layout }) => {
  const headRow = store && wip.headOid !== null ? store.rowOf(wip.headOid) : -1;
  const lane = store && headRow !== -1 ? collapsedLane(store.lane(headRow), layout.stubLane) : 0;
  const color =
    store && headRow !== -1 && lane !== layout.stubLane ? slotColor(store.trackSlot(store.track(headRow))) : STUB_COLOR;
  const cx = laneX(lane);
  const cy = ROW_HEIGHT / 2;
  return (
    <button
      type="button"
      onClick={wip.onToggle}
      aria-expanded={wip.open}
      aria-controls={wip.controls}
      title={`Uncommitted work on HEAD of ${wip.worktreeName}. ${wip.open ? "Hide" : "Show"} the staging inspector.`}
      className={`relative shrink-0 flex items-center gap-3 pr-3 text-xs text-left border-b border-[#30363d] hover:bg-[#161b22] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_#06B6D4] ${
        wip.open ? "bg-[#161b22]" : "bg-[#0d1117]"
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      <svg aria-hidden="true" className="shrink-0" width={layout.width} height={ROW_HEIGHT}>
        <line x1={cx} y1={cy + NODE_RADIUS} x2={cx} y2={ROW_HEIGHT} stroke={color} strokeWidth={2} strokeDasharray="2 2" />
        <circle cx={cx} cy={cy} r={NODE_RADIUS} fill="#0d1117" stroke={color} strokeWidth={1.5} strokeDasharray="2.5 2" />
      </svg>
      <span className="shrink-0 px-1.5 rounded border border-dashed border-[#8b949e]/60 text-[10px] leading-4 text-[#c9d1d9] font-semibold">
        WIP
      </span>
      <span className="flex-1 min-w-0 truncate text-[#c9d1d9]">{wip.label}</span>
      <span className="shrink-0 truncate max-w-60 text-[#8b949e]">on HEAD · {wip.worktreeName}</span>
    </button>
  );
};

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
const RowBadges: React.FC<{
  badges: Badge[];
  worktreeAgents: ReadonlyMap<string, RunKind[]>;
  cursor: number | null;
  /** The find query whose runs a ref name marks (#399), or "" for none. */
  findQuery: string;
}> = ({ badges, worktreeAgents, cursor, findQuery }) => {
  const shown = badges.slice(0, SHOWN_BADGES);
  const rest = badges.slice(SHOWN_BADGES);
  return (
    <span className="shrink-0 flex items-center gap-1 max-w-[50%] overflow-hidden">
      {shown.map((b, i) => {
        const { Icon, className } = BADGE_KINDS[b.kind];
        const current = isCurrentHead(b);
        const look = current ? CURRENT_HEAD_CLASS : className;
        return (
          <span
            key={badgeKey(b)}
            data-badge={i}
            title={badgeTitle(b)}
            className={`inline-flex items-center gap-1 max-w-40 px-1.5 rounded border text-[10px] leading-4 ${look} ${
              i === cursor ? "outline outline-1 outline-offset-1 outline-[#06B6D4]" : ""
            }`}
          >
            <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
            {current && <span>HEAD</span>}
            <span className="truncate">
              <FindText text={b.name} query={isFindable(b) ? findQuery : ""} />
            </span>
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

/** The badge under a pointer event, by its index among its row's shown badges, or null. */
function badgeIndexAt(target: EventTarget): number | null {
  const el = target instanceof Element ? target.closest("[data-badge]") : null;
  const index = el ? Number(el.getAttribute("data-badge")) : NaN;
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

/** An open badge or commit-row menu: where it shows, in the list's own px, and what it offers. */
interface OpenMenu {
  x: number;
  y: number;
  /** Untrusted text: a ref name or a short oid, only ever rendered as text. */
  label: string;
  items: MenuItem[];
}

const MENU_WIDTH = 224;

/**
 * A badge's or a commit row's context menu (#367, #393), following the menu pattern: focus starts
 * on its first item, the arrows, Home and End move it, Enter or Space runs an item, and Escape, Tab
 * or a click outside closes it. A disabled item stays focusable and says why in its title.
 */
const RefMenu: React.FC<{ menu: OpenMenu; onRun: (action: RefAction) => void; onClose: (refocus: boolean) => void }> = ({
  menu,
  onRun,
  onClose,
}) => {
  const list = useRef<HTMLUListElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [focused, setFocused] = useState(0);
  useEffect(() => {
    items.current[focused]?.focus();
  }, [focused, menu]);
  usePopupLayer(true, () => onClose(true), list);
  return (
    <ul
      ref={list}
      role="menu"
      aria-label={`Actions for ${menu.label}`}
      onKeyDown={(e) => {
        const next = menuIndexByKey(focused, menu.items.length, e.key);
        if (next !== null) {
          e.preventDefault();
          setFocused(next);
        } else if (e.key === "Tab") {
          e.preventDefault();
          onClose(true);
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose(false);
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="absolute z-30 p-1 flex flex-col rounded border border-[#30363d] bg-[#161b22] shadow-lg"
      style={{ left: menu.x, top: menu.y, width: MENU_WIDTH }}
    >
      {menu.items.map((item, i) => (
        <li key={item.label} role="none">
          <button
            ref={(el) => {
              items.current[i] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={i === focused ? 0 : -1}
            aria-disabled={item.action === null}
            title={item.disabledReason}
            onClick={() => {
              if (item.action === null) return;
              onClose(true);
              onRun(item.action);
            }}
            onMouseEnter={() => setFocused(i)}
            className={`w-full text-left px-2 py-1 rounded text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60 ${
              item.action === null ? "text-[#6e7681] cursor-default" : "text-[#c9d1d9] hover:bg-[#0d1117] focus:bg-[#0d1117]"
            }`}
          >
            <span className="block truncate">{item.label}</span>
            {item.disabledReason && <span className="block truncate text-[10px] text-[#6e7681]">{item.disabledReason}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
};

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
  wip,
  refContext,
  onRefAction,
  onPrimary,
  announce,
  selectedOid,
  onSelect,
  comparedOid,
  onAddSelection,
  onInspect,
  focusRef,
  visible,
  findKeysRef,
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
  // The badge the keyboard cursor is on in the active row (#393), by its index among the shown
  // badges, or null for the row itself. Keyed by the row, so it resets when the row changes.
  const [cursor, setCursor] = useState<{ row: number; index: number } | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // The box menus are placed in: the overlay's backdrop filter makes `position: fixed` relative to
  // it, so menus are placed in this frame's own px instead.
  const frame = useRef<HTMLDivElement>(null);
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
    if (e.target === e.currentTarget && (onGraphKey(e) || onSelectionKey(e))) {
      e.preventDefault();
      return;
    }
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
      onSelect(store.oid(row));
      el.focus({ preventScroll: true });
    },
    [store, scrollToOffset, onSelect]
  );

  /**
   * Moves the cursor to `row` and scrolls it into view, keeping the content offset the truth
   * (#377), and selects it (#397) unless `select` is false, as for Ctrl with a move key (#398).
   */
  const moveCursor = useCallback(
    (row: number, select: boolean) => {
      const el = scroller.current;
      if (!el || !store) return;
      scrollToOffset(offsetShowing(offset.current, row, el.clientHeight));
      setActive({ sessionId: store.sessionId, row });
      if (select) onSelect(store.oid(row));
    },
    [store, scrollToOffset, onSelect]
  );

  useEffect(() => {
    if (!focusRef) return;
    focusRef.current = () => scroller.current?.focus({ preventScroll: true });
    return () => {
      focusRef.current = null;
    };
  }, [focusRef]);

  // A selection made outside the list, such as a parent link, moves the list's own selection to
  // its row. Only a change of oid looks the row up, since that lookup walks the loaded rows.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (selectedOid === null || !store) return;
    const current = activeRef.current;
    if (current !== null && current.sessionId === store.sessionId && store.oid(current.row) === selectedOid) return;
    const row = store.rowOf(selectedOid);
    if (row === -1) {
      announce("That commit isn't loaded in the graph yet");
      return;
    }
    const el = scroller.current;
    if (el) scrollToOffset(offsetShowing(offset.current, row, el.clientHeight));
    setActive({ sessionId: store.sessionId, row });
    // Only a new selection, or the first rows of a new session, look the row up; a refresh's
    // store swap is followed by the remap above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOid, store === null]);

  const layout = useMemo(() => columnLayout(columnWidth, peakLanes), [columnWidth, peakLanes]);
  // aria-activedescendant must always name a row in the DOM (#351), so the active row is clamped
  // to the window while it is scrolled away.
  const activeRow = renderedActiveRow(
    active !== null && store !== null && active.sessionId === store.sessionId ? active.row : null,
    win
  );
  // The cursor row: the active row once the operator has picked one, never the window edge
  // `aria-activedescendant` falls back to. A move selects it; Ctrl with a move key doesn't (#398).
  const cursorRow = active !== null && store !== null && active.sessionId === store.sessionId ? active.row : null;
  const hovered = hover !== null && hover >= win.start && hover < win.end ? hover : null;

  // Find (#399): the controller owns the find's state; the rows read only its query and matches.
  const selectFound = useCallback((row: number) => moveCursor(row, true), [moveCursor]);
  const refocusList = useCallback(() => scroller.current?.focus({ preventScroll: true }), []);
  const {
    query: findQuery,
    matches: findMatches,
    bar: findBar,
  } = useFindController({
    store,
    badges: refs.badges,
    rowCount,
    visible,
    cursorRow,
    selectRow: selectFound,
    refocus: refocusList,
    keysRef: findKeysRef,
  });

  const cursorIndex = cursor !== null && cursor.row === activeRow ? cursor.index : null;

  /** The badges `row` shows, the ones a cursor or a click can land on. */
  const shownBadges = (row: number): Badge[] => (store ? (refs.badges.get(store.oid(row)) ?? []).slice(0, SHOWN_BADGES) : []);

  /** Opens the menu of `row`'s badge `index`, or of the row itself, at `point` in viewport px. */
  const openMenu = (row: number, index: number | null, point: { x: number; y: number }) => {
    if (!store || refContext === null) return;
    const oid = store.oid(row);
    const badge = index === null ? undefined : shownBadges(row)[index];
    let items = badge ? badgeMenu(badge, oid, refContext) : [];
    let label = badge ? badge.name : shortOid(oid);
    // The selected worktree's own HEAD has no menu of its own, so it falls back to the commit's.
    if (items.length === 0) {
      items = commitMenu(oid, refContext);
      label = shortOid(oid);
    }
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.max(0, Math.min(point.x - box.left, box.width - MENU_WIDTH));
    const y = Math.max(0, Math.min(point.y - box.top, box.height - items.length * 40 - 8));
    setMenu({ x, y, label, items });
  };

  const closeMenu = useCallback((refocus: boolean) => {
    setMenu(null);
    if (refocus) scroller.current?.focus({ preventScroll: true });
  }, []);

  /** Opens the active row's menu, or its cursor badge's, under it. */
  const openMenuByKey = () => {
    if (activeRow === null) return;
    const rowEl = document.getElementById(`${idPrefix}-row-${activeRow}`);
    const badgeEl = cursorIndex === null ? null : rowEl?.querySelector(`[data-badge="${cursorIndex}"]`);
    const anchor = (badgeEl ?? rowEl)?.getBoundingClientRect();
    if (!anchor) return;
    openMenu(activeRow, cursorIndex, { x: anchor.left + (badgeEl ? 0 : 48), y: anchor.bottom });
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!store || refContext === null) return;
    // A keyboard-opened menu (Shift+F10, the menu key) targets the listbox itself and opens at the
    // active row; one from the pointer opens where it was clicked.
    if (e.target === e.currentTarget) {
      if (menu === null) openMenuByKey();
      return;
    }
    const row = rowAt(e.clientY - (layer.current?.getBoundingClientRect().top ?? 0), win);
    if (row === null) return;
    const index = badgeIndexAt(e.target);
    setActive({ sessionId: store.sessionId, row });
    onSelect(store.oid(row));
    setCursor(index === null ? null : { row, index });
    openMenu(row, index, { x: e.clientX, y: e.clientY });
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // A double-click on a commit row only selects it, which its pointer-down already did (#367).
    if (!store || refContext === null) return;
    const index = badgeIndexAt(e.target);
    const row = rowAt(e.clientY - e.currentTarget.getBoundingClientRect().top, win);
    if (index === null || row === null) return;
    const badge = shownBadges(row)[index];
    if (badge) onPrimary(primaryAction(badge, refContext));
  };

  /**
   * Moves, copies or inspects the selection by key (#397), or moves the cursor and adds its commit
   * as the second one to compare (#398); returns whether it did.
   */
  const onSelectionKey = (e: React.KeyboardEvent<HTMLDivElement>): boolean => {
    const key = selectionKey(e, false);
    if (key === null || !store) return false;
    switch (key.kind) {
      case "move":
      case "cursor": {
        const viewport = e.currentTarget.clientHeight;
        const row = movedRow(cursorRow, key.step, {
          rowCount,
          pageRows: Math.floor(viewport / ROW_HEIGHT),
          firstVisible: Math.ceil(offset.current / ROW_HEIGHT),
        });
        if (row === null) return false;
        moveCursor(row, key.kind === "move");
        return true;
      }
      case "add":
        if (cursorRow === null) return false;
        onAddSelection(store.oid(cursorRow));
        return true;
      case "copy":
        if (cursorRow === null) return false;
        onRefAction({ kind: "copySha", oid: store.oid(cursorRow) });
        return true;
      case "inspect":
        if (cursorRow === null) return false;
        onInspect();
        return true;
    }
  };

  /** Handles a graph key (#367) on the listbox; returns whether it did. */
  const onGraphKey = (e: React.KeyboardEvent<HTMLDivElement>): boolean => {
    const key = graphKey(e, false);
    if (key === null || !store || refContext === null || activeRow === null) return false;
    const oid = store.oid(activeRow);
    const badges = shownBadges(activeRow);
    switch (key) {
      case "createBranch":
        onRefAction({ kind: "createBranch", at: oid });
        return true;
      case "createTag":
        onRefAction({ kind: "createTag", at: oid });
        return true;
      case "checkout": {
        const badge = cursorIndex === null ? undefined : badges[cursorIndex];
        if (!badge) return false;
        onPrimary(primaryAction(badge, refContext));
        return true;
      }
      case "menu":
        openMenuByKey();
        return true;
      case "nextBadge":
      case "previousBadge": {
        const index = nextBadge(cursorIndex, badges.length, key);
        setCursor(index === null ? null : { row: activeRow, index });
        const badge = index === null ? undefined : badges[index];
        announce(badge ? `${badgeTitle(badge)}. Enter checks out; Shift+F10 opens its menu.` : `Commit ${shortOid(oid)}`);
        return true;
      }
    }
  };

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
    if (row === null) return;
    setActive({ sessionId: store.sessionId, row });
    // Ctrl- or Shift-click adds a second commit to compare (#398); a plain click selects one.
    if (e.ctrlKey || e.metaKey || e.shiftKey) onAddSelection(store.oid(row));
    else onSelect(store.oid(row));
    // A click puts the badge cursor on the badge it hit, or on the row itself.
    const index = badgeIndexAt(e.target);
    setCursor(index === null ? null : { row, index });
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
      const isSelected = oid === selectedOid || oid === comparedOid;
      const rowBadges = refs.badges.get(oid);
      const holdsCurrentHead = rowBadges?.some(isCurrentHead) ?? false;
      // A binary search over the matches, so a row holds no find state of its own (#399).
      const lit = findQuery === "" || isMatch(findMatches, row);
      const marks = lit ? findQuery : "";
      out.push(
        <div
          key={oid}
          id={`${idPrefix}-row-${row}`}
          role="option"
          aria-selected={isSelected}
          aria-current={holdsCurrentHead ? "true" : undefined}
          aria-posinset={row + 1}
          aria-setsize={statusState === "done" ? rowCount : -1}
          className={`flex items-center gap-3 pr-3 text-xs border-b border-[#21262d]/60 hover:bg-[#161b22] ${
            isSelected ? "bg-[#1f2a37] shadow-[inset_2px_0_0_#06B6D4]" : isActive ? "bg-[#161b22]" : ""
          } ${isActive ? "group-focus-visible:shadow-[inset_0_0_0_1px_#06B6D4]" : ""} ${lit ? "" : "opacity-40"}`}
          style={{ height: ROW_HEIGHT }}
        >
          {/* The node's spoken label; the node itself is drawn in the aria-hidden lane graph. */}
          <span role="img" aria-label={nodeLabel(agent, author.name)} className="shrink-0" style={{ width: layout.width }} />
          {rowBadges && (
            <RowBadges badges={rowBadges} worktreeAgents={worktreeAgents} cursor={isActive ? cursorIndex : null} findQuery={marks} />
          )}
          <span className="flex-1 min-w-0 truncate text-[#c9d1d9]" title={subject}>
            <FindText text={subject} query={marks} />
          </span>
          <span className="w-40 shrink-0 truncate text-[#8b949e]" title={author.email}>
            <FindText text={authorLine(author.name, agent)} query={marks} />
          </span>
          <span className="w-40 shrink-0 truncate text-right text-[#8b949e] tabular-nums">
            {formatDateTime(store.authorTimeMs(row))}
          </span>
        </div>
      );
    }
    return out;
    // Rows already loaded never change, so the window and the row count cover the store growing.
  }, [store, win, activeRow, selectedOid, comparedOid, layout.width, idPrefix, statusState, rowCount, refs.badges, worktreeAgents, cursorIndex, findQuery, findMatches]);

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
      {findBar && <GraphFindBar {...findBar} />}
      {wip && <WipRow wip={wip} store={store} layout={layout} />}
      <div ref={frame} className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onContextMenu={onContextMenu}
          role="listbox"
          aria-label="Commits"
          aria-multiselectable="true"
          aria-busy={status.state === "loading"}
          aria-activedescendant={activeRow === null ? undefined : `${idPrefix}-row-${activeRow}`}
          tabIndex={0}
          className="group flex-1 min-h-0 overflow-y-auto [overflow-anchor:none] outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
        >
          {/* Clipped, so overscan rows past the end never make the spacer taller (#370). */}
          <div className="relative overflow-clip" style={{ height: scale.spacerHeight }}>
            {/* The pointer hovers nodes and selects a row here; the keys move the selection (#397). */}
            <div
              ref={layer}
              className="absolute inset-x-0 top-0"
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(null)}
              onPointerDown={onPointerDown}
              onDoubleClick={onDoubleClick}
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
        {menu && <RefMenu menu={menu} onRun={onRefAction} onClose={closeMenu} />}
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
