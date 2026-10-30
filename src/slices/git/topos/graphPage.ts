// Decodes a `Rows` page of a Topos graph session (#369, #375). The layout is documented, and
// encoded, in `src-tauri/src/slices/git/graph/page.rs`; `fixtures/graph-page-v2.bin` is a page Rust
// encoded.

import { RUN_KINDS, type RunKind } from "../../terminal/types.ts";

/** "TGPG" read as a little-endian u32. */
export const PAGE_MAGIC = 0x47504754;
export const PAGE_FORMAT_VERSION = 2;
export const MIN_HEADER_BYTES = 80;
/** The `parentRow` of an edge whose parent row hasn't loaded yet. */
export const OPEN_ROW = 0xffffffff;
/** Where each field sits in an edge's `EDGE_FIELDS` `u32`s. */
export const EDGE_FIELD = { childRow: 0, parentRow: 1, lane: 2, childLane: 3, parentLane: 4, track: 5 } as const;
export const EDGE_FIELDS = 6;
/** Where each field sits in a close's `CLOSE_FIELDS` `u32`s. */
export const CLOSE_FIELD = { edge: 0, parentRow: 1, parentLane: 2 } as const;
export const CLOSE_FIELDS = 3;

/** An author in a session's author table. */
export interface GraphAuthor {
  name: string;
  email: string;
}

/** What a track's color key came from; only derived and anonymous tracks probe for clashes. */
export type TrackKind = "default" | "named" | "derived" | "anonymous";

/** One run of first parents drawn in one lane, as the lane pass opened it. */
export interface GraphTrack {
  id: number;
  /** The branch name without `refs/heads/` or `refs/remotes/<remote>/`, or an oid. */
  key: string;
  kind: TrackKind;
  /** The tracks either side of this one's lane when it opened. */
  left: number | null;
  right: number | null;
}

const AGENT_SOURCES = ["stamp", "coauthor"] as const;
/** How Quay knows a commit's agent: its `Quay-Agent` stamp, or a known `Co-authored-by` email. */
export type AgentSource = (typeof AGENT_SOURCES)[number];

/** The agent of one agent commit, as the backend classified it (#381). */
export interface GraphAgent {
  /** The agent's run kind, or null for a stamp naming none. */
  kind: RunKind | null;
  source: AgentSource;
  /** An unknown stamp's value, untrusted text for the tooltip only. */
  raw?: string;
}

/** An agent commit's row within its page, and its agent. */
export interface PageAgent extends GraphAgent {
  row: number;
}

/** A page agent's agent, without its row. */
export function toGraphAgent(a: PageAgent): GraphAgent {
  return a.raw === undefined ? { kind: a.kind, source: a.source } : { kind: a.kind, source: a.source, raw: a.raw };
}

export interface GraphPage {
  sessionId: number;
  /** From 0 within the session. */
  pageIndex: number;
  /** The session-wide index of the page's first row. */
  firstRow: number;
  rowCount: number;
  /** Epoch milliseconds, one per row. */
  authorTimeMs: Float64Array;
  /** Indexes into the session's author table, one per row. */
  authorIds: Uint32Array;
  /** Each row's lane. */
  rowLanes: Uint16Array;
  /** Each row's track id. */
  rowTracks: Uint32Array;
  /** The session-wide id of the page's first edge. */
  firstEdge: number;
  edgeCount: number;
  /** `EDGE_FIELDS` per edge whose child row is in this page, in child-row order. */
  edges: Uint32Array;
  /** `CLOSE_FIELDS` per edge from an earlier page whose parent row is in this page. */
  closes: Uint32Array;
  /** The ids of the edges open at the page's first row. */
  checkpoint: Uint32Array;
  /** The most lanes any row so far has needed. */
  peakLanes: number;
  oids: string[];
  subjects: string[];
  /** Authors this page adds to the session's table, in id order. */
  newAuthors: GraphAuthor[];
  /** Tracks this page opens, in id order. */
  newTracks: GraphTrack[];
  /** The page's agent commits, in row order; a human commit has no entry. */
  agents: PageAgent[];
}

export class GraphPageError extends Error {}

const TRACK_KINDS: readonly string[] = ["default", "named", "derived", "anonymous"];

function isStringArray(value: unknown, length: number): value is string[] {
  return Array.isArray(value) && value.length === length && value.every((v) => typeof v === "string");
}

function isAuthorArray(value: unknown): value is GraphAuthor[] {
  return (
    Array.isArray(value) &&
    value.every(
      (a) => typeof a === "object" && a !== null && typeof a.name === "string" && typeof a.email === "string"
    )
  );
}

function isTrackId(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isTrackArray(value: unknown): value is GraphTrack[] {
  return (
    Array.isArray(value) &&
    value.every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof t.id === "number" &&
        Number.isInteger(t.id) &&
        t.id >= 0 &&
        typeof t.key === "string" &&
        TRACK_KINDS.includes(t.kind) &&
        isTrackId(t.left) &&
        isTrackId(t.right)
    )
  );
}

const SOURCES: readonly unknown[] = AGENT_SOURCES;
const KINDS: readonly unknown[] = RUN_KINDS;

function isAgentArray(value: unknown, rowCount: number): value is PageAgent[] {
  return (
    Array.isArray(value) &&
    value.every(
      (a) =>
        typeof a === "object" &&
        a !== null &&
        Number.isInteger(a.row) &&
        a.row >= 0 &&
        a.row < rowCount &&
        (a.kind === null || KINDS.includes(a.kind)) &&
        SOURCES.includes(a.source) &&
        (a.raw === undefined || typeof a.raw === "string")
    )
  );
}

/**
 * Decodes one page. Throws a `GraphPageError` for an unknown magic or format version, or for a page
 * whose sections don't fit the buffer. The typed arrays are views on `buffer`, not copies.
 */
export function decodeGraphPage(buffer: ArrayBuffer): GraphPage {
  if (buffer.byteLength < MIN_HEADER_BYTES) throw new GraphPageError(`a graph page is at least ${MIN_HEADER_BYTES} bytes`);
  const view = new DataView(buffer);
  const u32 = (at: number) => view.getUint32(at, true);
  const magic = u32(0);
  if (magic !== PAGE_MAGIC) throw new GraphPageError(`not a graph page (magic 0x${magic.toString(16)})`);
  const version = view.getUint16(4, true);
  if (version !== PAGE_FORMAT_VERSION) {
    throw new GraphPageError(`graph page format ${version} is not supported (expected ${PAGE_FORMAT_VERSION})`);
  }
  const headerBytes = view.getUint16(6, true);
  if (headerBytes < MIN_HEADER_BYTES) throw new GraphPageError(`a graph page header is at least ${MIN_HEADER_BYTES} bytes`);
  const rowCount = u32(20);
  const edgeCount = u32(24);
  const closeCount = u32(28);
  const checkpointCount = u32(52);

  const section = (at: number, count: number, bytesEach: number) => {
    const offset = u32(at);
    if (offset < headerBytes || offset % bytesEach !== 0 || offset + count * bytesEach > buffer.byteLength) {
      throw new GraphPageError("a graph page section lies outside the page");
    }
    return offset;
  };
  const authorTimeMs = new Float64Array(buffer, section(32, rowCount, 8), rowCount);
  const authorIds = new Uint32Array(buffer, section(36, rowCount, 4), rowCount);
  const rowLanes = new Uint16Array(buffer, section(60, rowCount, 2), rowCount);
  const rowTracks = new Uint32Array(buffer, section(64, rowCount, 4), rowCount);
  const edges = new Uint32Array(buffer, section(68, edgeCount * EDGE_FIELDS, 4), edgeCount * EDGE_FIELDS);
  const closes = new Uint32Array(buffer, section(72, closeCount * CLOSE_FIELDS, 4), closeCount * CLOSE_FIELDS);
  const checkpoint = new Uint32Array(buffer, section(76, checkpointCount, 4), checkpointCount);
  const jsonAt = u32(40);
  const jsonLength = u32(44);
  if (jsonAt < headerBytes || jsonAt + jsonLength > buffer.byteLength) {
    throw new GraphPageError("the graph page's JSON lies outside the page");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(buffer, jsonAt, jsonLength)));
  } catch (e) {
    throw new GraphPageError(`the graph page's JSON doesn't parse: ${String(e)}`);
  }
  const { oids, subjects, newAuthors, newTracks, agents } = (json ?? {}) as Record<string, unknown>;
  if (
    !isStringArray(oids, rowCount) ||
    !isStringArray(subjects, rowCount) ||
    !isAuthorArray(newAuthors) ||
    !isTrackArray(newTracks) ||
    !isAgentArray(agents, rowCount)
  ) {
    throw new GraphPageError("the graph page's JSON doesn't match its rows");
  }
  return {
    sessionId: u32(8),
    pageIndex: u32(12),
    firstRow: u32(16),
    rowCount,
    authorTimeMs,
    authorIds,
    rowLanes,
    rowTracks,
    firstEdge: u32(48),
    edgeCount,
    edges,
    closes,
    checkpoint,
    peakLanes: u32(56),
    oids,
    subjects,
    newAuthors,
    newTracks,
    agents,
  };
}
