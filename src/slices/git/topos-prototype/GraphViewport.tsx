// PROTOTYPE (#351). The virtualized commit list and SVG graph.
//
// Structure:
// - One scroll container over a spacer `rows * H` tall. Only a window of rows
//   [first, last] is in the DOM, placed at top = first * H. The window start is
//   rounded down to a multiple of `chunk`, so React re-renders once per chunk of
//   rows scrolled, not once per row.
// - The SVG covers only the window, in window-local coordinates. Edges come
//   from the store's checkpoint query; a ribbon whose ends are off-screen is a
//   vertical run clipped to the window plus overscan, so its curve (if any) is
//   drawn only when that end is near.
// - Edges are batched into one <path> per color slot. Nodes are <circle>s for
//   the window's rows only.
// - Hit-testing is arithmetic on one pointermove handler: row = y / H, then
//   the node in that row's lane, else the nearest ribbon lane in that row. No
//   per-node listeners, and one tooltip element.
// - Sticky badges: a strip above the list names each track that passes the
//   top visible row but whose tip has scrolled out above it.

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Cloud, GitBranch, Tag } from "lucide-react";
import { formatDateTime } from "../../../lib/dates";
import { buildWindowPaths, laneX, type Geometry } from "./geometry";
import type { Knobs } from "./knobs";
import { OPEN_ROW } from "./protocol";
import type { GraphStore } from "./store";

export interface ViewportStats {
  buildMs: number;
  visibleEdges: number;
  windowRows: number;
  renders: number;
  graphLanes: number;
}

const REFS_W = 200;
const lane = (slot: number) => `var(--topos-lane-${slot})`;

type Hover =
  | { kind: "commit"; row: number; x: number; y: number }
  | { kind: "track"; track: number; row: number; x: number; y: number }
  | null;

interface Props {
  store: GraphStore;
  version: number;
  knobs: Knobs;
  scrollRef: RefObject<HTMLDivElement | null>;
  stats: RefObject<ViewportStats>;
}

/**
 * #370: Chromium caps an element's height at about 33.5M px (1.2M rows at H = 28). In scaled
 * mode the spacer stops at this height and `v`, the virtual offset in content pixels, is the
 * source of truth: wheel and keys move `v` 1:1, and the scrollbar maps proportionally.
 */
const SCALED_MAX_PX = 8_000_000;

export function GraphViewport({ store, version, knobs, scrollRef, stats }: Props) {
  const idPrefix = useId();
  const { H, W, R, overscan, chunk } = knobs;
  /** `px` is the scroll container's scrollTop; `v` is the content offset it stands for. */
  const [view, setView] = useState({ px: 0, v: 0 });
  const vRef = useRef(0);
  const [height, setHeight] = useState(600);
  const [selected, setSelected] = useState(0);
  const [hover, setHover] = useState<Hover>(null);
  const [resizeW, setResizeW] = useState(220);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, [scrollRef]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const rows = store.rows;
  const contentH = rows * H;
  const scaled = knobs.scroll === "scaled" && contentH > SCALED_MAX_PX;
  const spacerH = scaled ? SCALED_MAX_PX : contentH;
  const ratio = scaled ? Math.max(1, (contentH - height) / Math.max(1, spacerH - height)) : 1;
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const maxV = Math.max(0, contentH - height);
  const maxVRef = useRef(maxV);
  maxVRef.current = maxV;

  const publish = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setView({ px: scrollRef.current?.scrollTop ?? 0, v: vRef.current }));
  }, [scrollRef]);

  /** Moves the content offset and puts the scrollbar where it maps to. */
  const setVirtual = useCallback((v: number) => {
    const el = scrollRef.current;
    if (!el) return;
    vRef.current = Math.min(maxVRef.current, Math.max(0, v));
    el.scrollTop = vRef.current / ratioRef.current;
    publish();
  }, [scrollRef, publish]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A scroll we caused lands within a pixel of v / ratio; anything else is the scrollbar,
    // a fling or a jump, and maps proportionally.
    if (Math.abs(el.scrollTop - vRef.current / ratioRef.current) >= 1) {
      vRef.current = Math.min(maxVRef.current, el.scrollTop * ratioRef.current);
    }
    publish();
  }, [scrollRef, publish]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scaled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? H : e.deltaMode === 2 ? el.clientHeight : 1;
      setVirtual(vRef.current + e.deltaY * unit);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrollRef, scaled, H, setVirtual]);

  const topRow = Math.min(Math.max(0, rows - 1), Math.floor(view.v / H));
  const bottomRow = Math.min(rows - 1, Math.ceil((view.v + height) / H));
  const first = Math.max(0, Math.floor((topRow - overscan) / chunk) * chunk);
  const last = Math.min(rows - 1, Math.ceil((bottomRow + overscan + 1) / chunk) * chunk);

  const edges = useMemo(() => (rows === 0 ? [] : store.visibleEdges(first, last)),
    // `version` is the store's change counter; the store itself is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, version, first, last, rows]);

  // Graph column width: the open question. Lanes past `shown` collapse onto a stub column.
  const shown = useMemo(() => {
    const P = W / 2;
    if (knobs.width === "resizable") return Math.max(1, Math.floor((resizeW - 2 * P) / W));
    if (knobs.width === "global") return Math.min(knobs.cap, Math.max(1, store.maxLanes));
    let max = 0;
    for (let r = first; r <= last; r++) max = Math.max(max, store.lane[r] + 1);
    for (const e of edges) max = Math.max(max, store.eLane[e] + 1, store.eChildLane[e] + 1);
    return Math.min(knobs.cap, Math.max(1, max));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knobs.width, knobs.cap, W, resizeW, store, version, first, last, edges]);
  const overflowing = knobs.width === "resizable" || store.maxLanes > shown;
  const graphW = knobs.width === "resizable" ? resizeW : W + (shown + (overflowing ? 1 : 0)) * W;

  const g: Geometry = useMemo(() => ({ H, W, R, P: W / 2, k: knobs.k, rho: knobs.rho, style: knobs.style, cap: shown }),
    [H, W, R, knobs.k, knobs.rho, knobs.style, shown]);

  const hoverTrack = hover?.kind === "track" ? hover.track : hover?.kind === "commit" ? store.track[hover.row] : -1;

  const paths = useMemo(() => buildWindowPaths(g, store, edges, first, last, hoverTrack),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [g, store, version, edges, first, last, hoverTrack]);

  const s = stats.current;
  s.buildMs = paths.buildMs;
  s.visibleEdges = paths.edgeCount;
  s.windowRows = last - first + 1;
  s.renders++;
  s.graphLanes = shown;

  const headRow = useMemo(() => {
    for (const [row, refs] of store.refsByRow) if (refs.some((r) => r.current)) return row;
    return -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version]);

  const nodes = useMemo(() => {
    const out = [];
    for (let r = first; r <= last; r++) {
      const l = store.lane[r];
      const cx = laneX(g, l);
      const cy = (r - first) * H + H / 2;
      const slot = store.tracks[store.track[r]]?.slot ?? 0;
      if (l >= g.cap) {
        out.push(<rect key={store.oid[r]} x={cx - 2} y={cy - 2} width={4} height={4} className="topos-stub-node" />);
        continue;
      }
      const merge = store.parentCount[r] > 1;
      out.push(
        <circle key={store.oid[r]} cx={cx} cy={cy} r={merge ? R - 1 : R}
          style={merge ? { fill: "var(--topos-bg)", stroke: lane(slot), strokeWidth: 2 } : { fill: lane(slot) }} />,
      );
      if (r === headRow) out.push(<circle key="head" cx={cx} cy={cy} r={R + 3} className="topos-head-ring" style={{ stroke: lane(slot) }} />);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, store, version, first, last, headRow]);

  const rowEls = useMemo(() => {
    const out = [];
    for (let r = first; r <= last; r++) {
      const slot = store.tracks[store.track[r]]?.slot ?? 0;
      out.push(<Row key={store.oid[r]} id={`${idPrefix}-row-${r}`} store={store} row={r} slot={slot} H={H} graphW={graphW} selected={r === selected} />);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version, first, last, H, graphW, selected, idPrefix]);

  // Tracks passing the top visible row whose tip is above it.
  const sticky = useMemo(() => {
    if (!knobs.sticky || rows === 0) return [];
    const seen = new Map<number, number>();
    for (const e of store.visibleEdges(topRow, topRow)) {
      const pr = store.eParentRow[e];
      if (store.eChildRow[e] >= topRow || (pr !== OPEN_ROW && pr < topRow)) continue;
      const t = store.eTrack[e];
      if (store.trackTip[t] < topRow && !seen.has(t)) seen.set(t, store.eLane[e]);
    }
    return [...seen].map(([track, l]) => ({ track, lane: l, info: store.tracks[track] })).sort((a, b) => a.lane - b.lane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knobs.sticky, store, version, topRow, rows]);

  const scrollToRow = useCallback((row: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const y = row * H;
    if (y < vRef.current) setVirtual(y);
    else if (y + H > vRef.current + el.clientHeight) setVirtual(y + H - el.clientHeight);
  }, [scrollRef, H, setVirtual]);

  const jumpTo = useCallback((row: number) => {
    setSelected(row);
    const el = scrollRef.current;
    if (el) setVirtual(row * H - el.clientHeight / 3);
  }, [scrollRef, H, setVirtual]);

  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || rows === 0) return;
    const rect = el.getBoundingClientRect();
    const y = ev.clientY - rect.top + vRef.current;
    const x = ev.clientX - rect.left - REFS_W;
    const row = Math.floor(y / H);
    let next: Hover = null;
    if (row >= first && row <= last && x >= 0 && x < graphW) {
      const cy = row * H + H / 2;
      const hitR = Math.max(R + 3, W / 2);
      if (Math.abs(x - laneX(g, store.lane[row])) <= hitR && Math.abs(y - cy) <= Math.max(hitR, H / 2)) {
        next = { kind: "commit", row, x: ev.clientX, y: ev.clientY };
      } else {
        let best = -1;
        let bestD = W / 2;
        for (const e of edges) {
          const top = store.eChildRow[e] + (store.eChildLane[e] !== store.eLane[e] ? 1 : 0);
          const pr = store.eParentRow[e];
          const bottom = pr === OPEN_ROW ? rows : pr - (store.eParentLane[e] !== store.eLane[e] ? 1 : 0);
          if (row < top || row > bottom) continue;
          const d = Math.abs(x - laneX(g, store.eLane[e]));
          if (d < bestD) { bestD = d; best = e; }
        }
        if (best >= 0) next = { kind: "track", track: store.eTrack[best], row, x: ev.clientX, y: ev.clientY };
      }
    }
    setHover((prev) => {
      if (prev === null && next === null) return prev;
      if (prev && next && prev.kind === next.kind && prev.row === next.row
        && (prev.kind !== "track" || (next.kind === "track" && prev.track === next.track))) {
        return { ...next };
      }
      return next;
    });
  };

  const onClick = () => {
    if (hover?.kind === "track") jumpTo(store.trackTip[hover.track]);
    else if (hover?.kind === "commit") setSelected(hover.row);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor(height / H) - 1);
    const moves = new Map([["ArrowDown", 1], ["ArrowUp", -1], ["PageDown", page], ["PageUp", -page], ["Home", -Infinity], ["End", Infinity]]);
    const move = moves.get(ev.key);
    if (move === undefined || rows === 0) return;
    ev.preventDefault();
    const next = Math.min(rows - 1, Math.max(0, selected + move));
    setSelected(next);
    scrollToRow(next);
  };

  const onResizeStart = (ev: React.PointerEvent<HTMLDivElement>) => {
    const startX = ev.clientX;
    const startW = resizeW;
    const move = (e: PointerEvent) => setResizeW(Math.max(W * 2, Math.min(800, startW + e.clientX - startX)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const P = W / 2;
  return (
    <div className="topos-viewport">
      <div className="topos-header" style={{ height: 26 }}>
        <div style={{ width: REFS_W }}>Branch / tag</div>
        <div style={{ width: graphW, position: "relative" }}>
          Graph
          {knobs.width === "resizable" && (
            // A real build gives this a keyboard alternative (a separator role with arrow keys).
            <div className="topos-resize" onPointerDown={onResizeStart} title="Drag to resize the graph column" />
          )}
        </div>
        <div className="flex-1">Message</div>
        <div style={{ width: 110 }}>Author</div>
        <div style={{ width: 170 }}>Date</div>
        <div style={{ width: 70 }}>SHA</div>
      </div>

      {knobs.sticky && (
        <div className="topos-sticky" style={{ height: H }}>
          <div className="topos-sticky-chips" style={{ width: REFS_W }}>
            {sticky.slice(0, 3).map((s) => (
              <button key={s.track} type="button" className="topos-chip topos-chip-sticky" style={{ borderColor: lane(s.info?.slot ?? 0) }}
                onClick={() => jumpTo(store.trackTip[s.track])} title={`Jump to where ${s.info?.name ?? "this track"} starts`}>
                ↑ {s.info?.name ?? "anonymous"}
              </button>
            ))}
            {sticky.length > 3 && <span className="topos-more">+{sticky.length - 3}</span>}
          </div>
          <svg width={graphW} height={H} aria-hidden="true">
            {sticky.map((s) => (
              <path key={s.track} d={`M${laneX(g, s.lane) - 4},${H - 4}L${laneX(g, s.lane)},${H - 10}L${laneX(g, s.lane) + 4},${H - 4}`}
                style={{ stroke: lane(s.info?.slot ?? 0), fill: "none", strokeWidth: 2 }} />
            ))}
          </svg>
        </div>
      )}

      <div
        ref={scrollRef}
        className="topos-scroll"
        role="listbox"
        aria-label="Commits"
        tabIndex={0}
        aria-activedescendant={rows > 0 ? `${idPrefix}-row-${selected}` : undefined}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
      >
        <div style={{ height: spacerH, position: "relative", overflow: "clip" }}>
          <div style={{ position: "absolute", top: view.px + first * H - view.v, left: 0, right: 0 }}>
            <svg className={hoverTrack >= 0 ? "topos-graph topos-dim" : "topos-graph"} aria-hidden="true"
              style={{ position: "absolute", left: REFS_W, top: 0 }} width={graphW} height={(last - first + 1) * H}>
              {paths.bySlot.map((d, slot) => d !== "" && (
                // Slots are a fixed set of twelve, so the index is the identity here.
                <path key={`slot-${slot}`} d={d} className="topos-edge" style={{ stroke: lane(slot) }} />
              ))}
              {paths.overflow !== "" && <path d={paths.overflow} className="topos-edge topos-overflow" />}
              {paths.highlight !== "" && <path d={paths.highlight} className="topos-edge topos-highlight" style={{ stroke: lane(paths.highlightSlot) }} />}
              {overflowing && <line x1={P + shown * W + W / 2} x2={P + shown * W + W / 2} y1={0} y2={(last - first + 1) * H} className="topos-cap-line" />}
              {nodes}
            </svg>
            {rowEls}
          </div>
        </div>
      </div>

      {hover && <Tooltip hover={hover} store={store} />}
    </div>
  );
}

const Row = memo(function Row({ id, store, row, slot, H, graphW, selected }:
  { id: string; store: GraphStore; row: number; slot: number; H: number; graphW: number; selected: boolean }) {
  const refs = store.refsByRow.get(row) ?? [];
  return (
    <div id={id} role="option" aria-selected={selected} className={selected ? "topos-row topos-selected" : "topos-row"} style={{ height: H }}>
      <div className="topos-refs" style={{ width: REFS_W }}>
        {refs.slice(0, 2).map((ref) => (
          <span key={`${ref.kind}:${ref.name}`} className={ref.current ? "topos-chip topos-current" : "topos-chip"} style={{ borderColor: lane(slot) }}>
            {ref.kind === "tag" ? <Tag size={11} /> : ref.kind === "remote" ? <Cloud size={11} /> : <GitBranch size={11} />}
            {ref.name}
          </span>
        ))}
        {refs.length > 2 && <span className="topos-more">+{refs.length - 2}</span>}
      </div>
      <div style={{ width: graphW, flex: "none" }} />
      <div className="topos-subject">{store.subject[row]}</div>
      <div className="topos-cell" style={{ width: 110 }}>{store.author[row]}</div>
      <div className="topos-cell" style={{ width: 170 }}>{formatDateTime(store.time[row] * 1000)}</div>
      <div className="topos-cell topos-mono" style={{ width: 70 }}>{store.oid[row].slice(0, 7)}</div>
    </div>
  );
});

function Tooltip({ hover, store }: { hover: NonNullable<Hover>; store: GraphStore }) {
  const style = { left: hover.x + 14, top: hover.y + 14 };
  if (hover.row >= store.rows) return null;
  if (hover.kind === "commit") {
    const r = hover.row;
    const t = store.tracks[store.track[r]];
    return (
      <div role="tooltip" className="topos-tooltip" style={style}>
        <div className="font-semibold">{store.subject[r]}</div>
        <div>{store.author[r]} · {formatDateTime(store.time[r] * 1000)}</div>
        <div className="topos-mono">{store.oid[r].slice(0, 12)} · row {r} · lane {store.lane[r]} · {store.parentCount[r]} parent(s)</div>
        <div>track: {t?.name ?? "anonymous"} (slot {t?.slot}, rank {t?.rank})</div>
      </div>
    );
  }
  const t = store.tracks[hover.track];
  return (
    <div role="tooltip" className="topos-tooltip" style={style}>
      <div className="font-semibold">{t?.name ?? "anonymous track"}</div>
      <div>starts at row {store.trackTip[hover.track]} · click to jump there</div>
    </div>
  );
}
