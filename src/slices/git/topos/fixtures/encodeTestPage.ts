// Test support: encodes a format-2 graph page the way `src-tauri/src/slices/git/graph/page.rs`
// lays one out, so store and feed tests can build sessions without the backend.

import {
  CLOSE_FIELDS,
  EDGE_FIELDS,
  MIN_HEADER_BYTES,
  PAGE_FORMAT_VERSION,
  PAGE_MAGIC,
  type GraphTrack,
} from "../graphPage.ts";

export interface TestPage {
  sessionId: number;
  pageIndex: number;
  firstRow: number;
  rowCount: number;
  /** Each row's `[lane, track]`; every row sits in lane 0 on track 0 when left out. */
  rows?: [number, number][];
  firstEdge?: number;
  /** `[childRow, parentRow, lane, childLane, parentLane, track]` per edge. */
  edges?: number[][];
  /** `[edge, parentRow, parentLane]` per close. */
  closes?: number[][];
  checkpoint?: number[];
  peakLanes?: number;
  /** The author id every row names; the page index when left out. */
  authorId?: number;
  /** The authors the page adds; one per page, named for the page index, when left out. */
  newAuthors?: { name: string; email: string }[];
  /** Each row's oid; the row number in hex when left out. */
  oids?: string[];
  /** Page 0 opens track 0, `main`, when left out. */
  newTracks?: GraphTrack[];
}

const align8 = (n: number) => Math.ceil(n / 8) * 8;

export function encodeTestPage(p: TestPage): ArrayBuffer {
  const n = p.rowCount;
  const rows = p.rows ?? Array.from({ length: n }, (): [number, number] => [0, 0]);
  const edges = p.edges ?? [];
  const closes = p.closes ?? [];
  const checkpoint = p.checkpoint ?? [];
  const json = new TextEncoder().encode(
    JSON.stringify({
      oids: p.oids ?? Array.from({ length: n }, (_, i) => (p.firstRow + i).toString(16).padStart(40, "0")),
      subjects: p.oids ?? Array.from({ length: n }, (_, i) => `commit ${p.firstRow + i}`),
      newAuthors: p.newAuthors ?? [{ name: `Author ${p.pageIndex}`, email: `a${p.pageIndex}@example.invalid` }],
      newTracks: p.newTracks ?? (p.pageIndex === 0 ? [{ id: 0, key: "main", kind: "default", left: null, right: null }] : []),
    })
  );
  const authorTimeAt = MIN_HEADER_BYTES;
  const authorIdsAt = authorTimeAt + 8 * n;
  const lanesAt = align8(authorIdsAt + 4 * n);
  const tracksAt = align8(lanesAt + 2 * n);
  const edgesAt = align8(tracksAt + 4 * n);
  const closesAt = align8(edgesAt + 4 * EDGE_FIELDS * edges.length);
  const checkpointAt = align8(closesAt + 4 * CLOSE_FIELDS * closes.length);
  const jsonAt = align8(checkpointAt + 4 * checkpoint.length);
  const buffer = new ArrayBuffer(jsonAt + json.length);
  const view = new DataView(buffer);
  view.setUint32(0, PAGE_MAGIC, true);
  view.setUint16(4, PAGE_FORMAT_VERSION, true);
  view.setUint16(6, MIN_HEADER_BYTES, true);
  [
    p.sessionId,
    p.pageIndex,
    p.firstRow,
    n,
    edges.length,
    closes.length,
    authorTimeAt,
    authorIdsAt,
    jsonAt,
    json.length,
    p.firstEdge ?? 0,
    checkpoint.length,
    p.peakLanes ?? 1,
    lanesAt,
    tracksAt,
    edgesAt,
    closesAt,
    checkpointAt,
  ].forEach((value, i) => view.setUint32(8 + 4 * i, value, true));
  for (let i = 0; i < n; i++) {
    view.setFloat64(authorTimeAt + 8 * i, 1_700_000_000_000 - (p.firstRow + i) * 1000, true);
    view.setUint32(authorIdsAt + 4 * i, p.authorId ?? p.pageIndex, true);
    view.setUint16(lanesAt + 2 * i, rows[i][0], true);
    view.setUint32(tracksAt + 4 * i, rows[i][1], true);
  }
  edges.flat().forEach((value, i) => view.setUint32(edgesAt + 4 * i, value, true));
  closes.flat().forEach((value, i) => view.setUint32(closesAt + 4 * i, value, true));
  checkpoint.forEach((value, i) => view.setUint32(checkpointAt + 4 * i, value, true));
  new Uint8Array(buffer, jsonAt).set(json);
  return buffer;
}
