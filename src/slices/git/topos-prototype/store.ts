// PROTOTYPE (#351). The frontend's copy of the graph: growable typed arrays
// filled page by page, plus the checkpoint-based visible-edge query from the
// #348 findings (no interval tree, no per-row passing-lane lists).

import { OPEN_ROW, type ColumnarMeta, type PageColumnar, type PageJson, type RefOut, type TrackOut } from "./protocol";

function grow<T extends Uint8Array | Uint16Array | Uint32Array | Float64Array>(a: T, need: number): T {
  if (need <= a.length) return a;
  const next = new (a.constructor as new (n: number) => T)(Math.max(need, a.length * 2));
  next.set(a);
  return next;
}

export class GraphStore {
  rows = 0;
  edges = 0;
  maxLanes = 0;
  pageSize: number;

  oid: string[] = [];
  author: string[] = [];
  subject: string[] = [];
  time = new Float64Array(1024);
  lane = new Uint16Array(1024);
  track = new Uint32Array(1024);
  parentCount = new Uint8Array(1024);

  eChildRow = new Uint32Array(1024);
  eParentRow = new Uint32Array(1024);
  eLane = new Uint16Array(1024);
  eChildLane = new Uint16Array(1024);
  eParentLane = new Uint16Array(1024);
  eKind = new Uint8Array(1024);
  eTrack = new Uint32Array(1024);

  checkpoints: Uint32Array[] = [];
  tracks: TrackOut[] = [];
  /** First row a track touches: its tip row, or the merge row that opened it. */
  trackTip: number[] = [];
  refsByRow = new Map<number, RefOut[]>();
  rowByOid = new Map<string, number>();

  constructor(pageSize: number) {
    this.pageSize = pageSize;
  }

  /** Adds one page. Returns main-thread milliseconds spent decoding and copying. */
  ingest(format: "json" | "columnar", body: string | PageColumnar): number {
    const t0 = performance.now();
    let p: PageJson | PageColumnar;
    let meta: ColumnarMeta;
    if (format === "json") {
      const page = JSON.parse(body as string) as PageJson;
      p = page;
      meta = page;
    } else {
      p = body as PageColumnar;
      meta = JSON.parse(p.meta) as ColumnarMeta;
    }
    for (const t of meta.tracks) {
      this.tracks[t.id] = t;
      this.trackTip[t.id] = -1;
    }
    const n = meta.oid.length;
    const start = p.start;
    const end = start + n;
    this.time = grow(this.time, end);
    this.lane = grow(this.lane, end);
    this.track = grow(this.track, end);
    this.parentCount = grow(this.parentCount, end);
    for (let i = 0; i < n; i++) {
      const r = start + i;
      this.oid[r] = meta.oid[i];
      this.author[r] = meta.author[i];
      this.subject[r] = meta.subject[i];
      this.time[r] = p.time[i];
      this.lane[r] = p.lane[i];
      this.track[r] = p.track[i];
      this.parentCount[r] = p.parentCount[i];
      this.rowByOid.set(meta.oid[i], r);
    }

    const ne = p.eChildRow.length;
    const eEnd = p.edgeStart + ne;
    this.eChildRow = grow(this.eChildRow, eEnd);
    this.eParentRow = grow(this.eParentRow, eEnd);
    this.eLane = grow(this.eLane, eEnd);
    this.eChildLane = grow(this.eChildLane, eEnd);
    this.eParentLane = grow(this.eParentLane, eEnd);
    this.eKind = grow(this.eKind, eEnd);
    this.eTrack = grow(this.eTrack, eEnd);
    for (let i = 0; i < ne; i++) {
      const e = p.edgeStart + i;
      this.eChildRow[e] = p.eChildRow[i];
      this.eParentRow[e] = p.eParentRow[i];
      this.eLane[e] = p.eLane[i];
      this.eChildLane[e] = p.eChildLane[i];
      this.eParentLane[e] = p.eParentLane[i];
      this.eKind[e] = p.eKind[i];
      this.eTrack[e] = p.eTrack[i];
      // A merge track starts at its merge row, before any of its own rows arrive.
      if (this.trackTip[p.eTrack[i]] === -1) this.trackTip[p.eTrack[i]] = p.eChildRow[i];
    }
    for (let i = 0; i < p.closes.length; i += 3) {
      this.eParentRow[p.closes[i]] = p.closes[i + 1];
      this.eParentLane[p.closes[i]] = p.closes[i + 2];
    }
    this.checkpoints[Math.floor(start / this.pageSize)] = Uint32Array.from(p.checkpoint);
    for (let i = 0; i < n; i++) {
      const t = this.track[start + i];
      if (this.trackTip[t] === -1) this.trackTip[t] = start + i;
    }
    for (const ref of meta.refs) {
      const list = this.refsByRow.get(ref.row) ?? [];
      list.push(ref);
      this.refsByRow.set(ref.row, list);
    }
    this.rows = end;
    this.edges = eEnd;
    this.maxLanes = Math.max(this.maxLanes, p.laneCount);
    return performance.now() - t0;
  }

  /**
   * Edges that touch rows [a, b]: the checkpoint at or before a gives every
   * edge crossing that page's start, and edges opened since are contiguous
   * because they are stored in child-row order. O(lanes + visible edges).
   */
  visibleEdges(a: number, b: number, out: number[] = []): number[] {
    out.length = 0;
    if (this.rows === 0) return out;
    const from = Math.max(0, a - 1);
    const page = Math.floor(from / this.pageSize);
    const cp = this.checkpoints[page];
    if (cp) for (const e of cp) if (this.reaches(e, from)) out.push(e);
    let lo = 0;
    let hi = this.edges;
    const pageStart = page * this.pageSize;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.eChildRow[mid] < pageStart) lo = mid + 1;
      else hi = mid;
    }
    for (let e = lo; e < this.edges && this.eChildRow[e] <= b + 1; e++) if (this.reaches(e, from)) out.push(e);
    return out;
  }

  private reaches(e: number, row: number): boolean {
    const pr = this.eParentRow[e];
    return pr === OPEN_ROW || pr >= row;
  }
}
