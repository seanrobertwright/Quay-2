// The frontend copy of one graph session's rows and lanes (#370, #375): per-row numbers and edges
// live in typed arrays that grow by doubling, never per page, so ingesting a page stays cheap at a
// million rows.

import { CLOSE_FIELDS, EDGE_FIELDS, OPEN_ROW, type GraphAuthor, type GraphPage } from "./graphPage.ts";
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
    for (let i = 5; i < page.edges.length; i += EDGE_FIELDS) {
      if (page.edges[i] >= tracks) throw new Error(`page names unknown track ${page.edges[i]}`);
    }
    for (let i = 0; i < page.closes.length; i += CLOSE_FIELDS) {
      if (page.closes[i] >= this.edges) throw new Error(`page closes unknown edge ${page.closes[i]}`);
    }
    for (const e of page.checkpoint) if (e >= this.edges) throw new Error(`page's checkpoint names unknown edge ${e}`);

    for (const t of page.newTracks) {
      const neighbours = [t.left, t.right].filter((n): n is number => n !== null && n < this.trackSlots.length);
      this.trackKeys.push(t.key);
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
      this.oids.push(page.oids[i]);
      this.subjects.push(page.subjects[i]);
    }
    for (const author of page.newAuthors) this.authors.push(author);

    this.edgeData = grown(this.edgeData, (this.edges + page.edgeCount) * EDGE_FIELDS, (n) => new Uint32Array(n));
    this.edgeData.set(page.edges, this.edges * EDGE_FIELDS);
    for (let i = 0; i < page.closes.length; i += CLOSE_FIELDS) {
      const at = page.closes[i] * EDGE_FIELDS;
      this.edgeData[at + 1] = page.closes[i + 1];
      this.edgeData[at + 4] = page.closes[i + 2];
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

  edge(id: number): GraphEdge {
    const at = id * EDGE_FIELDS;
    const d = this.edgeData;
    return { childRow: d[at], parentRow: d[at + 1], lane: d[at + 2], childLane: d[at + 3], parentLane: d[at + 4], track: d[at + 5] };
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
      const parentRow = d[id * EDGE_FIELDS + 1];
      return parentRow === OPEN_ROW || parentRow >= start - 1;
    };
    const out: number[] = [];
    for (const id of this.checkpoints[lo]) if (reaches(id)) out.push(id);
    for (let id = this.pageFirstEdges[lo]; id < this.edges && d[id * EDGE_FIELDS] < end; id++) {
      if (reaches(id)) out.push(id);
    }
    return out;
  }
}
