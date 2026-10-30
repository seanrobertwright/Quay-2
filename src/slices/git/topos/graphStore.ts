// The frontend copy of one graph session's rows and lanes (#370, #375): per-row numbers and edges
// live in typed arrays that grow by doubling, never per page, so ingesting a page stays cheap at a
// million rows.

import {
  CLOSE_FIELD,
  CLOSE_FIELDS,
  EDGE_FIELD,
  EDGE_FIELDS,
  OPEN_ROW,
  type GraphAuthor,
  type GraphPage,
  type TrackKind,
} from "./graphPage.ts";
import type { EdgeGeometry } from "./graphPaths.ts";
import { trackSlot } from "./laneColors.ts";

const INITIAL_CAPACITY = 1024;

type Growable = Float64Array | Uint32Array | Uint16Array;

function grown<T extends Growable>(array: T, needed: number, make: (n: number) => T): T {
  if (needed <= array.length) return array;
  let capacity = array.length;
  while (capacity < needed) capacity *= 2;
  const next = make(capacity);
  next.set(array);
  return next;
}

/** A track met at some row, with where it started (#376). */
export interface TrackPassing {
  track: number;
  key: string;
  kind: TrackKind;
  /** The lane it is in at that row. */
  lane: number;
  /** Its first row, or the child row of its first edge when that comes first. */
  startRow: number;
}

/** How a track is named to the operator: its key, with an anonymous track's oid cut short. */
export function trackLabel(key: string, kind: TrackKind): string {
  if (kind !== "anonymous") return key;
  const caret = key.indexOf("^");
  return caret === -1 ? key.slice(0, 7) : key.slice(0, Math.min(caret, 7)) + key.slice(caret);
}

/** One edge, with its close applied. */
export interface GraphEdge extends EdgeGeometry {
  track: number;
}

export class GraphStore {
  /** The session these rows belong to. */
  readonly sessionId: number;
  private count = 0;
  private nextPage = 0;
  private authorTimes = new Float64Array(INITIAL_CAPACITY);
  private authorIdsByRow = new Uint32Array(INITIAL_CAPACITY);
  private lanesByRow = new Uint16Array(INITIAL_CAPACITY);
  private tracksByRow = new Uint32Array(INITIAL_CAPACITY);
  private readonly oids: string[] = [];
  private readonly subjects: string[] = [];
  private readonly authors: GraphAuthor[] = [];
  /** `EDGE_FIELDS` per edge, in edge-id order, which is child-row order. */
  private edgeData = new Uint32Array(INITIAL_CAPACITY * EDGE_FIELDS);
  private edges = 0;
  private readonly trackKeys: string[] = [];
  private readonly trackSlots: number[] = [];
  private readonly trackKinds: TrackKind[] = [];
  private readonly trackStarts: number[] = [];
  /** Each page's first row and first edge id, and the edges open at its first row. */
  private readonly pageFirstRows: number[] = [];
  private readonly pageFirstEdges: number[] = [];
  private readonly checkpoints: Uint32Array[] = [];
  private peak = 0;

  constructor(sessionId: number) {
    this.sessionId = sessionId;
  }

  get rowCount(): number {
    return this.count;
  }

  get edgeCount(): number {
    return this.edges;
  }

  /** The most lanes any loaded row has needed. */
  get peakLanes(): number {
    return this.peak;
  }

  /** Capacity of the per-row typed arrays, which only ever doubles. */
  get capacity(): number {
    return this.authorTimes.length;
  }

  /**
   * Appends a page. Throws when the page belongs to another session, doesn't follow the last one
   * exactly (rows already shown never move), or names an author, track or edge it hasn't sent.
   */
  ingest(page: GraphPage): void {
    if (page.sessionId !== this.sessionId) {
      throw new Error(`page of session ${page.sessionId} given to the store of session ${this.sessionId}`);
    }
    if (page.pageIndex !== this.nextPage || page.firstRow !== this.count) {
      throw new Error(
        `expected page ${this.nextPage} at row ${this.count}, got page ${page.pageIndex} at row ${page.firstRow}`
      );
    }
    if (page.firstEdge !== this.edges) throw new Error(`expected edge ${this.edges} next, got ${page.firstEdge}`);
    for (const id of page.authorIds) {
      if (id >= this.authors.length + page.newAuthors.length) throw new Error(`page names unknown author ${id}`);
    }
    page.newTracks.forEach((t, i) => {
      if (t.id !== this.trackKeys.length + i) throw new Error(`expected track ${this.trackKeys.length + i}, got ${t.id}`);
    });
    const tracks = this.trackKeys.length + page.newTracks.length;
    for (const t of page.rowTracks) if (t >= tracks) throw new Error(`page names unknown track ${t}`);
    for (let i = EDGE_FIELD.track; i < page.edges.length; i += EDGE_FIELDS) {
      if (page.edges[i] >= tracks) throw new Error(`page names unknown track ${page.edges[i]}`);
    }
    for (let i = CLOSE_FIELD.edge; i < page.closes.length; i += CLOSE_FIELDS) {
      if (page.closes[i] >= this.edges) throw new Error(`page closes unknown edge ${page.closes[i]}`);
    }
    for (const e of page.checkpoint) if (e >= this.edges) throw new Error(`page's checkpoint names unknown edge ${e}`);

    for (const t of page.newTracks) {
      const neighbours = [t.left, t.right].filter((n): n is number => n !== null && n < this.trackSlots.length);
      this.trackKeys.push(t.key);
      this.trackKinds.push(t.kind);
      this.trackStarts.push(OPEN_ROW);
      this.trackSlots.push(trackSlot(t, neighbours.map((n) => this.trackSlots[n])));
    }
    const end = this.count + page.rowCount;
    this.authorTimes = grown(this.authorTimes, end, (n) => new Float64Array(n));
    this.authorIdsByRow = grown(this.authorIdsByRow, end, (n) => new Uint32Array(n));
    this.lanesByRow = grown(this.lanesByRow, end, (n) => new Uint16Array(n));
    this.tracksByRow = grown(this.tracksByRow, end, (n) => new Uint32Array(n));
    this.authorTimes.set(page.authorTimeMs, this.count);
    this.authorIdsByRow.set(page.authorIds, this.count);
    this.lanesByRow.set(page.rowLanes, this.count);
    this.tracksByRow.set(page.rowTracks, this.count);
    for (let i = 0; i < page.rowCount; i++) {
      const t = page.rowTracks[i];
      if (this.trackStarts[t] === OPEN_ROW) this.trackStarts[t] = page.firstRow + i;
      this.oids.push(page.oids[i]);
      this.subjects.push(page.subjects[i]);
    }
    for (const author of page.newAuthors) this.authors.push(author);

    this.edgeData = grown(this.edgeData, (this.edges + page.edgeCount) * EDGE_FIELDS, (n) => new Uint32Array(n));
    this.edgeData.set(page.edges, this.edges * EDGE_FIELDS);
    for (let i = 0; i < page.edges.length; i += EDGE_FIELDS) {
      const t = page.edges[i + EDGE_FIELD.track];
      this.trackStarts[t] = Math.min(this.trackStarts[t], page.edges[i + EDGE_FIELD.childRow]);
    }
    for (let i = 0; i < page.closes.length; i += CLOSE_FIELDS) {
      const at = page.closes[i + CLOSE_FIELD.edge] * EDGE_FIELDS;
      this.edgeData[at + EDGE_FIELD.parentRow] = page.closes[i + CLOSE_FIELD.parentRow];
      this.edgeData[at + EDGE_FIELD.parentLane] = page.closes[i + CLOSE_FIELD.parentLane];
    }
    this.pageFirstRows.push(page.firstRow);
    this.pageFirstEdges.push(this.edges);
    // A copy, so the page's buffer can go.
    this.checkpoints.push(page.checkpoint.slice());
    this.edges += page.edgeCount;
    this.peak = Math.max(this.peak, page.peakLanes);
    this.count = end;
    this.nextPage++;
  }

  oid(row: number): string {
    return this.oids[row];
  }

  subject(row: number): string {
    return this.subjects[row];
  }

  author(row: number): GraphAuthor {
    return this.authors[this.authorIdsByRow[row]];
  }

  /** Epoch milliseconds. */
  authorTimeMs(row: number): number {
    return this.authorTimes[row];
  }

  lane(row: number): number {
    return this.lanesByRow[row];
  }

  track(row: number): number {
    return this.tracksByRow[row];
  }

  trackKey(track: number): string {
    return this.trackKeys[track];
  }

  /** The color slot of `track`, from its key and, for derived and anonymous tracks, its neighbours. */
  trackSlot(track: number): number {
    return this.trackSlots[track];
  }

  trackKind(track: number): TrackKind {
    return this.trackKinds[track];
  }

  /** The row `track` starts at: its first row, or its first edge's child row when that is earlier. */
  trackStartRow(track: number): number {
    return this.trackStarts[track];
  }

  /**
   * The tracks at `row` that started above it, which the sticky strip names (#376): the track of
   * the row's own node, and of every edge crossing or ending at the row. Left to right by lane.
   */
  tracksPassing(row: number): TrackPassing[] {
    if (row < 0 || row >= this.count) return [];
    const lanes = new Map<number, number>([[this.track(row), this.lane(row)]]);
    for (const id of this.visibleEdges(row, row + 1)) {
      const e = this.edge(id);
      if (e.childRow >= row) continue;
      if (e.parentRow === row) {
        if (!lanes.has(e.track)) lanes.set(e.track, e.parentLane);
      } else if (e.parentRow === OPEN_ROW || e.parentRow > row) {
        if (!lanes.has(e.track)) lanes.set(e.track, e.lane);
      }
    }
    const out: TrackPassing[] = [];
    for (const [track, lane] of lanes) {
      const startRow = this.trackStarts[track];
      if (startRow < row) out.push({ track, key: this.trackKeys[track], kind: this.trackKinds[track], lane, startRow });
    }
    return out.sort((a, b) => a.lane - b.lane || a.track - b.track);
  }

  edge(id: number): GraphEdge {
    const at = id * EDGE_FIELDS;
    const d = this.edgeData;
    return {
      childRow: d[at + EDGE_FIELD.childRow],
      parentRow: d[at + EDGE_FIELD.parentRow],
      lane: d[at + EDGE_FIELD.lane],
      childLane: d[at + EDGE_FIELD.childLane],
      parentLane: d[at + EDGE_FIELD.parentLane],
      track: d[at + EDGE_FIELD.track],
    };
  }

  /**
   * The ids of the edges that can show in rows `start` up to `end`: the checkpoint of the page
   * holding `start`, plus the edges opened since, less those that ended above the row before
   * `start` (#351). There is no interval tree; this costs the checkpoint plus the edges between.
   */
  visibleEdges(start: number, end: number): number[] {
    const pages = this.pageFirstRows;
    if (pages.length === 0) return [];
    // The last page whose first row is at or before `start`.
    let lo = 0;
    let hi = pages.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pages[mid] <= Math.max(start, 0)) lo = mid;
      else hi = mid - 1;
    }
    const d = this.edgeData;
    const reaches = (id: number) => {
      const parentRow = d[id * EDGE_FIELDS + EDGE_FIELD.parentRow];
      return parentRow === OPEN_ROW || parentRow >= start - 1;
    };
    const out: number[] = [];
    for (const id of this.checkpoints[lo]) if (reaches(id)) out.push(id);
    for (let id = this.pageFirstEdges[lo]; id < this.edges && d[id * EDGE_FIELDS + EDGE_FIELD.childRow] < end; id++) {
      if (reaches(id)) out.push(id);
    }
    return out;
  }
}
