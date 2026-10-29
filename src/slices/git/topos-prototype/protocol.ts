// PROTOTYPE (#351). Messages between the page and the layout worker. The worker
// stands in for the Rust side: it plays the role of `git_graph_open` and sends
// pages the way `Channel<GraphEvent>` would.

export type SourceSpec =
  | { kind: "synthetic"; commits: number; concurrency: number; seed: number }
  /** `dataUrl` is the page's data/ folder; the worker's own URL differs between dev and a build. */
  | { kind: "repo"; name: string; dataUrl: string };

/** Neighbour-aware color probing: never, only for derived and anonymous tracks, or for every non-default track. */
export type ClashMode = "off" | "derived" | "all";

/** `json` mimics a Tauri Channel's JSON body; `columnar` sends typed arrays plus one small JSON string. */
export type PayloadFormat = "json" | "columnar";

export interface OpenRequest {
  type: "open";
  sessionId: number;
  source: SourceSpec;
  clash: ClashMode;
  payload: PayloadFormat;
  pageSize: number;
}

export interface CloseRequest {
  type: "close";
  sessionId: number;
}

export type WorkerRequest = OpenRequest | CloseRequest;

/** parent_row of an edge whose parent has not streamed in yet. */
export const OPEN_ROW = 0xffffffff;

export const EDGE_FIRST_PARENT = 0;
export const EDGE_MERGE = 1;
/** Merge parent that already had a lane coming down: a one-row curve into that lane. */
export const EDGE_JOIN = 2;

export interface TrackOut {
  id: number;
  /** Branch name for named and derived tracks, null for anonymous ones. */
  name: string | null;
  slot: number;
  /** 0 pinned default branch, 1 named ref, 2 derived from a merge message, 3 anonymous. */
  rank: number;
}

export interface RefOut {
  row: number;
  name: string;
  kind: "local" | "remote" | "tag";
  current: boolean;
}

/**
 * One page, in logical form. Rows are final once sent. An edge is sent once, in
 * the page where it opens (its child row), with `parentRow = OPEN_ROW` if its
 * parent lies in a later page; the later page carries a `close` for it. So edges
 * stay sorted by child row, and the checkpoint lists the edges open at the page
 * start.
 */
export interface PageJson {
  start: number;
  oid: string[];
  author: string[];
  subject: string[];
  time: number[];
  lane: number[];
  track: number[];
  parentCount: number[];
  /** Id of the first edge opened in this page; ids are sequential. */
  edgeStart: number;
  eChildRow: number[];
  eParentRow: number[];
  eLane: number[];
  eChildLane: number[];
  eParentLane: number[];
  eKind: number[];
  eTrack: number[];
  /** Triples of edge id, parent row, parent lane. */
  closes: number[];
  /** Edge ids open when the page's first row is placed. */
  checkpoint: number[];
  tracks: TrackOut[];
  refs: RefOut[];
  /** Peak lane count over every row sent so far. */
  laneCount: number;
}

/** The same page as transferable buffers. Strings, tracks and refs ride in `meta` as JSON. */
export interface PageColumnar {
  start: number;
  edgeStart: number;
  laneCount: number;
  meta: string;
  time: Float64Array;
  lane: Uint16Array;
  track: Uint32Array;
  parentCount: Uint8Array;
  eChildRow: Uint32Array;
  eParentRow: Uint32Array;
  eLane: Uint16Array;
  eChildLane: Uint16Array;
  eParentLane: Uint16Array;
  eKind: Uint8Array;
  eTrack: Uint32Array;
  closes: Uint32Array;
  checkpoint: Uint32Array;
}

export interface ColumnarMeta {
  oid: string[];
  author: string[];
  subject: string[];
  tracks: TrackOut[];
  refs: RefOut[];
}

export type WorkerEvent =
  | { event: "started"; sessionId: number; defaultBranch: string; sourceMs: number }
  | { event: "rows"; sessionId: number; format: "json"; body: string; bytes: number; layoutMs: number }
  | { event: "rows"; sessionId: number; format: "columnar"; body: PageColumnar; bytes: number; layoutMs: number }
  | { event: "done"; sessionId: number; total: number; maxLanes: number; edges: number; layoutMs: number }
  | { event: "failed"; sessionId: number; error: string };
