// The frontend copy of one graph session's rows and lanes (#370, #375): per-row numbers, oids and
// edges live in typed arrays that grow by doubling, never per page, so ingesting a page stays cheap
// at a million rows. Oids are bytes (#410), turned into hex only when a caller asks for one.

import {
  CLOSE_FIELD,
  CLOSE_FIELDS,
  EDGE_FIELD,
  EDGE_FIELDS,
  OPEN_ROW,
  toGraphAgent,
  type GraphAgent,
  type GraphAuthor,
  type GraphPage,
  type GraphTrack,
  type TrackKind,
} from "./graphPage.ts";
import type { EdgeGeometry } from "./graphPaths.ts";
import { trackSlot } from "./laneColors.ts";
import { OidColumn } from "./oidColumn.ts";

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

/** The most distinct agents a store tells apart; past it an unknown stamp loses its value. */
const MAX_AGENTS = 0xffff;
/** An unknown stamp without its value, kept at a fixed index so a full table can still name it. */
const UNKNOWN_STAMP: GraphAgent = { kind: null, source: "stamp" };
const UNKNOWN_STAMP_ID = 1;
/** The first table index an agent read from a row takes; every entry from it on is non-null. */
const FIRST_READ_ID = UNKNOWN_STAMP_ID + 1;

function agentKey(a: GraphAgent): string {
  return JSON.stringify([a.kind, a.source, a.raw ?? null]);
}

/** A track met at some row, with where it started (#376). */
export interface TrackPassing {
  track: number;
  /** The lane it is in at that row. */
  lane: number;
  /** Its first row, or the child row of its first edge when that comes first. */
  startRow: number;
}

/** How many characters of an oid name a commit to the operator. */
const SHORT_OID_LENGTH = 7;

export function shortOid(oid: string): string {
  return oid.slice(0, SHORT_OID_LENGTH);
}

/** How a track is named to the operator: its key, with an anonymous track's oid cut short. */
export function trackLabel(key: string, kind: TrackKind): string {
  if (kind !== "anonymous") return key;
  const caret = key.indexOf("^");
  return caret === -1 ? shortOid(key) : shortOid(key.slice(0, caret)) + key.slice(caret);
}

/** One edge, with its close applied. */
export interface GraphEdge extends EdgeGeometry {
  track: number;
}

/**
 * How a refresh joins its rows to the rows already loaded (#370), from the backend's
 * `GraphEvent::Splice`: the `newRows` rows sent after it replace the first `replaceRows` rows, and
 * the rest move by `rowDelta`, their edge ids from `edgesFrom` on following on from `edgesTo` and
 * their track ids from `tracksFrom` on following on from `tracksTo`. Edges and tracks crossing the
 * match map through `crossingEdges` and `liveTracks`, as `[old, new]` pairs.
 */
export interface Splice {
  replaceRows: number;
  newRows: number;
  rowDelta: number;
  edgesFrom: number;
  edgesTo: number;
  tracksFrom: number;
  tracksTo: number;
  crossingEdges: [number, number][];
  liveTracks: [number, number][];
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
  /** Each row's index into `agentTable`, 0 for a human commit (#381). */
  private agentIdsByRow = new Uint16Array(INITIAL_CAPACITY);
  /** The distinct agents seen; few, so a row holds an index rather than an object. */
  private readonly agentTable: (GraphAgent | null)[] = [null, UNKNOWN_STAMP];
  private readonly agentIds = new Map<string, number>([[agentKey(UNKNOWN_STAMP), UNKNOWN_STAMP_ID]]);
  private readonly oids = new OidColumn();
  private readonly subjects: string[] = [];
  private readonly authors: GraphAuthor[] = [];
  /** `EDGE_FIELDS` per edge, in edge-id order, which is child-row order. */
  private edgeData = new Uint32Array(INITIAL_CAPACITY * EDGE_FIELDS);
  private edges = 0;
  private readonly trackKeys: string[] = [];
  private readonly trackSlots: number[] = [];
  private readonly trackKinds: TrackKind[] = [];
  private readonly trackStarts: number[] = [];
  /** The tracks either side of each track when it opened, which its color steered away from. */
  private readonly trackNeighbours: [number | null, number | null][] = [];
  /** Each page's first row and first edge id, and the edges open at its first row. */
  private readonly pageFirstRows: number[] = [];
  private readonly pageFirstEdges: number[] = [];
  private readonly checkpoints: Uint32Array[] = [];
  private peak = 0;

  constructor(sessionId: number) {
    this.sessionId = sessionId;
  }

  /**
   * An empty store for a refresh's rows that starts from this store's author table, as the
   * backend's does: its pages name authors sent before, and the rows a splice keeps still do.
   */
  continuing(): GraphStore {
    const next = new GraphStore(this.sessionId);
    for (const author of this.authors) next.authors.push(author);
    return next;
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

  /** Capacity of the per-row typed arrays, which doubles as rows load and `trim` cuts to the rows. */
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

    for (const t of page.newTracks) this.addTrack(t);
    const end = this.count + page.rowCount;
    this.growRows(end);
    this.authorTimes.set(page.authorTimeMs, this.count);
    this.authorIdsByRow.set(page.authorIds, this.count);
    this.lanesByRow.set(page.rowLanes, this.count);
    this.tracksByRow.set(page.rowTracks, this.count);
    for (let i = 0; i < page.rowCount; i++) {
      const t = page.rowTracks[i];
      if (this.trackStarts[t] === OPEN_ROW) this.trackStarts[t] = page.firstRow + i;
      this.oids.set(page.firstRow + i, page.oids[i]);
      this.subjects.push(page.subjects[i]);
    }
    for (const author of page.newAuthors) this.authors.push(author);
    for (const a of page.agents) {
      this.agentIdsByRow[page.firstRow + a.row] = this.agentId(toGraphAgent(a));
    }

    this.growEdges(this.edges + page.edgeCount);
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

  /** The index of `agent` in the agent table, adding it when it is new. */
  private agentId(agent: GraphAgent): number {
    const key = agentKey(agent);
    const known = this.agentIds.get(key);
    if (known !== undefined) return known;
    // Only distinct unknown stamps can fill the table; past it they show without their value.
    if (this.agentTable.length >= MAX_AGENTS) return UNKNOWN_STAMP_ID;
    const id = this.agentTable.length;
    this.agentTable.push(agent);
    this.agentIds.set(key, id);
    return id;
  }

  private addTrack(t: GraphTrack): void {
    const neighbours = [t.left, t.right].filter((n): n is number => n !== null && n < this.trackSlots.length);
    this.trackKeys.push(t.key);
    this.trackKinds.push(t.kind);
    this.trackStarts.push(OPEN_ROW);
    this.trackNeighbours.push([t.left, t.right]);
    this.trackSlots.push(trackSlot(t, neighbours.map((n) => this.trackSlots[n])));
  }

  private growRows(rows: number): void {
    this.authorTimes = grown(this.authorTimes, rows, (n) => new Float64Array(n));
    this.authorIdsByRow = grown(this.authorIdsByRow, rows, (n) => new Uint32Array(n));
    this.lanesByRow = grown(this.lanesByRow, rows, (n) => new Uint16Array(n));
    this.tracksByRow = grown(this.tracksByRow, rows, (n) => new Uint32Array(n));
    this.agentIdsByRow = grown(this.agentIdsByRow, rows, (n) => new Uint16Array(n));
    if (this.oids.capacity !== this.capacity) this.oids.resize(this.capacity, this.count);
  }

  /**
   * Shrinks the typed arrays to the rows and edges loaded, dropping the slack doubling left: up to
   * half of each array. The feed calls it when the session ends; a later page grows them again.
   */
  trim(): void {
    const rows = this.count;
    this.authorTimes = this.authorTimes.slice(0, rows);
    this.authorIdsByRow = this.authorIdsByRow.slice(0, rows);
    this.lanesByRow = this.lanesByRow.slice(0, rows);
    this.tracksByRow = this.tracksByRow.slice(0, rows);
    this.agentIdsByRow = this.agentIdsByRow.slice(0, rows);
    this.oids.resize(rows, rows);
    this.edgeData = this.edgeData.slice(0, this.edges * EDGE_FIELDS);
  }

  private growEdges(edges: number): void {
    this.edgeData = grown(this.edgeData, edges * EDGE_FIELDS, (n) => new Uint32Array(n));
  }

  /**
   * Joins `top`, a refresh's rows in a store from `continuing()`, to this store's rows as `splice`
   * says, and returns the joined store, which is `top`. Throws when `top` doesn't hold exactly the
   * rows, edges and tracks the splice announced.
   */
  spliced(top: GraphStore, splice: Splice): GraphStore {
    const { replaceRows, newRows, rowDelta, edgesFrom, edgesTo, tracksFrom, tracksTo } = splice;
    if (top.count !== newRows || top.edges !== edgesTo || top.trackKeys.length !== tracksTo) {
      throw new Error(
        `splice expected ${newRows} rows, ${edgesTo} edges and ${tracksTo} tracks above it, got ${top.count}, ${top.edges} and ${top.trackKeys.length}`
      );
    }
    if (replaceRows > this.count || edgesFrom > this.edges || tracksFrom > this.trackKeys.length) {
      throw new Error(`splice at row ${replaceRows} is past the ${this.count} rows loaded`);
    }
    const crossing = new Map(splice.crossingEdges);
    const live = new Map(splice.liveTracks);
    const shift = (row: number) => (row === OPEN_ROW ? row : row + rowDelta);
    const track = (t: number) => (t >= tracksFrom ? t - tracksFrom + tracksTo : (live.get(t) ?? t));
    const edge = (e: number) => (e >= edgesFrom ? e - edgesFrom + edgesTo : (crossing.get(e) ?? e));
    const d = this.edgeData;

    for (const [old, now] of crossing) {
      const from = old * EDGE_FIELDS;
      const to = now * EDGE_FIELDS;
      top.edgeData[to + EDGE_FIELD.parentRow] = shift(d[from + EDGE_FIELD.parentRow]);
      top.edgeData[to + EDGE_FIELD.parentLane] = d[from + EDGE_FIELD.parentLane];
    }
    for (let t = tracksFrom; t < this.trackKeys.length; t++) {
      const [left, right] = this.trackNeighbours[t];
      top.addTrack({
        id: track(t),
        key: this.trackKeys[t],
        kind: this.trackKinds[t],
        left: left === null ? null : track(left),
        right: right === null ? null : track(right),
      });
    }

    const kept = this.count - replaceRows;
    top.growRows(newRows + kept);
    for (let r = replaceRows; r < this.count; r++) {
      const at = r + rowDelta;
      const t = track(this.tracksByRow[r]);
      top.authorTimes[at] = this.authorTimes[r];
      top.authorIdsByRow[at] = this.authorIdsByRow[r];
      top.lanesByRow[at] = this.lanesByRow[r];
      top.tracksByRow[at] = t;
      const agent = this.agentTable[this.agentIdsByRow[r]];
      top.agentIdsByRow[at] = agent === null ? 0 : top.agentId(agent);
      top.oids.copyRow(this.oids, r, at);
      top.subjects.push(this.subjects[r]);
      if (top.trackStarts[t] === OPEN_ROW) top.trackStarts[t] = at;
    }
    for (let a = top.authors.length; a < this.authors.length; a++) top.authors.push(this.authors[a]);
    top.count = newRows + kept;

    const edges = edgesTo + this.edges - edgesFrom;
    top.growEdges(edges);
    for (let e = edgesFrom; e < this.edges; e++) {
      const from = e * EDGE_FIELDS;
      const to = edge(e) * EDGE_FIELDS;
      const t = track(d[from + EDGE_FIELD.track]);
      const childRow = shift(d[from + EDGE_FIELD.childRow]);
      top.edgeData[to + EDGE_FIELD.childRow] = childRow;
      top.edgeData[to + EDGE_FIELD.parentRow] = shift(d[from + EDGE_FIELD.parentRow]);
      top.edgeData[to + EDGE_FIELD.lane] = d[from + EDGE_FIELD.lane];
      top.edgeData[to + EDGE_FIELD.childLane] = d[from + EDGE_FIELD.childLane];
      top.edgeData[to + EDGE_FIELD.parentLane] = d[from + EDGE_FIELD.parentLane];
      top.edgeData[to + EDGE_FIELD.track] = t;
      top.trackStarts[t] = Math.min(top.trackStarts[t], childRow);
    }
    top.edges = edges;

    // The edges crossing the match are the checkpoint of a page starting there; the old pages
    // below it follow, moved and renumbered.
    top.pageFirstRows.push(newRows);
    top.pageFirstEdges.push(edgesTo);
    top.checkpoints.push(Uint32Array.from(crossing.values()));
    for (let p = 0; p < this.pageFirstRows.length; p++) {
      if (this.pageFirstRows[p] <= replaceRows) continue;
      top.pageFirstRows.push(this.pageFirstRows[p] + rowDelta);
      top.pageFirstEdges.push(edge(this.pageFirstEdges[p]));
      top.checkpoints.push(this.checkpoints[p].map(edge));
    }
    top.peak = Math.max(top.peak, this.peak);
    return top;
  }

  /** The row of the commit `oid`, or -1 when it isn't loaded. Costs a scan of the loaded rows. */
  rowOf(oid: string): number {
    return this.oids.indexOf(oid, this.count);
  }

  /** The oid at `row` as hex, built on each call: the store keeps oids as bytes (#410). */
  oid(row: number): string {
    return this.oids.hex(row);
  }

  subject(row: number): string {
    return this.subjects[row];
  }

  author(row: number): GraphAuthor {
    return this.authors[this.authorIdsByRow[row]];
  }

  /** The agent that made the commit at `row`, or null for a human commit (#381). */
  agent(row: number): GraphAgent | null {
    return this.agentTable[this.agentIdsByRow[row]];
  }

  /**
   * The distinct agents the loaded rows hold, in the order they first loaded, for the agent
   * highlight's choices (#401). The entries before `FIRST_READ_ID` are there before any row is.
   */
  agentsSeen(): readonly GraphAgent[] {
    return this.agentTable.slice(FIRST_READ_ID) as GraphAgent[];
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

  /** How `track` is named to the operator. */
  trackLabel(track: number): string {
    return trackLabel(this.trackKeys[track], this.trackKinds[track]);
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
      if (startRow < row) out.push({ track, lane, startRow });
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
