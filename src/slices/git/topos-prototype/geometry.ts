// PROTOTYPE (#351). Turns (row, lane) data into SVG paths for the rendered
// window, per the #348 formulas. All y values are local to the window, whose
// first row sits at y = H/2, so path numbers stay small however deep the scroll.

import { OPEN_ROW } from "./protocol";
import type { GraphStore } from "./store";
import { SLOT_COUNT } from "./palette";

export type EdgeStyle = "scurve" | "elbow";

export interface Geometry {
  H: number;
  W: number;
  R: number;
  /** Left padding. */
  P: number;
  /** S-curve control-point factor. */
  k: number;
  /** Elbow corner radius. */
  rho: number;
  style: EdgeStyle;
  /** Lanes at or past this index are drawn as stubs on the cap column. */
  cap: number;
}

const KAPPA = 0.5523;

export interface WindowPaths {
  bySlot: string[];
  overflow: string;
  highlight: string;
  highlightSlot: number;
  edgeCount: number;
  buildMs: number;
}

const f = (n: number) => Math.round(n * 10) / 10;

export function laneX(g: Geometry, lane: number): number {
  return g.P + Math.min(lane, g.cap) * g.W + g.W / 2;
}

/** One lane change over one row pitch, both ends vertical. */
function curve(g: Geometry, x0: number, y0: number, x1: number, y1: number): string {
  if (x0 === x1) return `L${f(x1)},${f(y1)}`;
  const span = y1 - y0;
  return `C${f(x0)},${f(y0 + g.k * span)} ${f(x1)},${f(y1 - g.k * span)} ${f(x1)},${f(y1)}`;
}

/** Merge-side elbow: run along the child row, turn down into the lane. */
function elbowTop(g: Geometry, xc: number, yc: number, xl: number, yEnd: number): string {
  const s = Math.sign(xl - xc);
  const rho = Math.min(g.rho, Math.abs(xl - xc), yEnd - yc);
  return `H${f(xl - s * rho)}C${f(xl - s * rho + s * KAPPA * rho)},${f(yc)} ${f(xl)},${f(yc + rho - KAPPA * rho)} ${f(xl)},${f(yc + rho)}L${f(xl)},${f(yEnd)}`;
}

/** Fork-side elbow: come down the lane, turn along the parent row into the parent. */
function elbowBottom(g: Geometry, xl: number, yStart: number, xp: number, yp: number): string {
  const s = Math.sign(xp - xl);
  const rho = Math.min(g.rho, Math.abs(xp - xl), yp - yStart);
  return `L${f(xl)},${f(yp - rho)}C${f(xl)},${f(yp - rho + KAPPA * rho)} ${f(xl + s * rho - s * KAPPA * rho)},${f(yp)} ${f(xl + s * rho)},${f(yp)}H${f(xp)}`;
}

/** Path for one edge, clipped to [top, bottom]. Long vertical runs collapse to one clipped `V`. */
export function edgePath(g: Geometry, store: GraphStore, e: number, first: number, top: number, bottom: number): string {
  const H = g.H;
  const yOf = (r: number) => (r - first) * H + H / 2;
  const childRow = store.eChildRow[e];
  const parentRow = store.eParentRow[e];
  const open = parentRow === OPEN_ROW;
  const xc = laneX(g, store.eChildLane[e]);
  const xl = laneX(g, store.eLane[e]);
  const xp = open ? xl : laneX(g, store.eParentLane[e]);
  const yc = yOf(childRow);
  const yp = open ? bottom + H : yOf(parentRow);
  const topCurve = xc !== xl;
  const bottomCurve = xp !== xl;

  if (yp < top || yc > bottom) return "";

  // One-row edges: a single lane change.
  if (!open && parentRow === childRow + 1 && (topCurve || bottomCurve)) {
    if (g.style === "elbow") {
      return topCurve && !bottomCurve ? `M${f(xc)},${f(yc)}${elbowTop(g, xc, yc, xl, yp)}` : `M${f(xc)},${f(yc)}${elbowBottom(g, xc, yc, xp, yp)}`;
    }
    return `M${f(xc)},${f(yc)}${curve(g, xc, yc, xp, yp)}`;
  }

  let d = "";
  let y = yc;
  if (topCurve) {
    if (yc + H >= top) d += `M${f(xc)},${f(yc)}` + (g.style === "elbow" ? elbowTop(g, xc, yc, xl, yc + H) : curve(g, xc, yc, xl, yc + H));
    y = yc + H;
  }
  const runEnd = bottomCurve ? yp - H : yp;
  const a = Math.max(y, top);
  const b = Math.min(runEnd, bottom);
  if (b > a) {
    d += d !== "" && a === y ? `L${f(xl)},${f(b)}` : `M${f(xl)},${f(a)}L${f(xl)},${f(b)}`;
  }
  if (bottomCurve && runEnd <= bottom) {
    const pen = d !== "" && b === runEnd ? "" : `M${f(xl)},${f(runEnd)}`;
    d += pen + (g.style === "elbow" ? elbowBottom(g, xl, runEnd, xp, yp) : curve(g, xl, runEnd, xp, yp));
  }
  return d;
}

/** One path string per color slot, so the edge layer is at most a dozen elements at any zoom. */
export function buildWindowPaths(g: Geometry, store: GraphStore, edges: number[], first: number, last: number, highlightTrack: number): WindowPaths {
  const t0 = performance.now();
  const bySlot: string[] = Array.from({ length: SLOT_COUNT }, () => "");
  let overflow = "";
  let highlight = "";
  let highlightSlot = 0;
  const top = -2 * g.H;
  const bottom = (last - first + 2) * g.H;
  for (const e of edges) {
    const d = edgePath(g, store, e, first, top, bottom);
    if (d === "") continue;
    const capped = store.eLane[e] >= g.cap || store.eChildLane[e] >= g.cap;
    const t = store.eTrack[e];
    if (t === highlightTrack) {
      highlight += d;
      highlightSlot = store.tracks[t]?.slot ?? 0;
    }
    if (capped) overflow += d;
    else bySlot[store.tracks[t]?.slot ?? 0] += d;
  }
  return { bySlot, overflow, highlight, highlightSlot, edgeCount: edges.length, buildMs: performance.now() - t0 };
}
