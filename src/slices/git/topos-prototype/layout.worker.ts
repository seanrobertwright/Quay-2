// PROTOTYPE (#351). Stands in for the Rust graph session: loads a history,
// runs the lane pass one page at a time, and posts each page as soon as it is
// laid out, the way `git_graph_open` would over `Channel<GraphEvent>`.

import { LaneSweep, type Commit, type Ref } from "./lanes";
import type { ColumnarMeta, OpenRequest, PageColumnar, PageJson, WorkerEvent, WorkerRequest } from "./protocol";
import { synthesize } from "./synthetic";

let current = 0;

function post(event: WorkerEvent, transfer: Transferable[] = []): void {
  self.postMessage(event, { transfer });
}

interface RepoDump {
  defaultBranch: string;
  commits: [string, string, string, number, string][];
  refs: [string, string, number][];
}

async function load(req: OpenRequest): Promise<{ commits: Commit[]; refs: Ref[]; defaultBranch: string }> {
  if (req.source.kind === "synthetic") {
    return synthesize(req.source.commits, req.source.concurrency, req.source.seed);
  }
  if (!/^[\w.-]+$/.test(req.source.name)) throw new Error(`bad repo name: ${req.source.name}`);
  const res = await fetch(new URL(`${req.source.name}.json`, req.source.dataUrl));
  if (!res.ok) throw new Error(`data/${req.source.name}.json: HTTP ${res.status}`);
  const dump = (await res.json()) as RepoDump;
  return {
    defaultBranch: dump.defaultBranch,
    commits: dump.commits.map(([oid, parents, author, time, subject]) => ({
      oid, parents: parents === "" ? [] : parents.split(" "), author, time, subject,
    })),
    refs: dump.refs.map(([oid, name, current]) => ({ oid, name, current: current === 1 })),
  };
}

function toColumnar(p: PageJson): { body: PageColumnar; transfer: ArrayBuffer[] } {
  const meta: ColumnarMeta = { oid: p.oid, author: p.author, subject: p.subject, tracks: p.tracks, refs: p.refs };
  const body: PageColumnar = {
    start: p.start,
    edgeStart: p.edgeStart,
    laneCount: p.laneCount,
    meta: JSON.stringify(meta),
    time: Float64Array.from(p.time),
    lane: Uint16Array.from(p.lane),
    track: Uint32Array.from(p.track),
    parentCount: Uint8Array.from(p.parentCount),
    eChildRow: Uint32Array.from(p.eChildRow),
    eParentRow: Uint32Array.from(p.eParentRow),
    eLane: Uint16Array.from(p.eLane),
    eChildLane: Uint16Array.from(p.eChildLane),
    eParentLane: Uint16Array.from(p.eParentLane),
    eKind: Uint8Array.from(p.eKind),
    eTrack: Uint32Array.from(p.eTrack),
    closes: Uint32Array.from(p.closes),
    checkpoint: Uint32Array.from(p.checkpoint),
  };
  const transfer = [body.time, body.lane, body.track, body.parentCount, body.eChildRow, body.eParentRow, body.eLane,
    body.eChildLane, body.eParentLane, body.eKind, body.eTrack, body.closes, body.checkpoint].map((a) => a.buffer as ArrayBuffer);
  return { body, transfer };
}

const utf8 = new TextEncoder();

const yieldToEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function open(req: OpenRequest): Promise<void> {
  const { sessionId } = req;
  const t0 = performance.now();
  const { commits, refs, defaultBranch } = await load(req);
  if (sessionId !== current) return;
  post({ event: "started", sessionId, defaultBranch, sourceMs: performance.now() - t0 });

  const sweep = new LaneSweep(defaultBranch, refs, req.clash);
  let layoutTotal = 0;
  for (let start = 0; start < commits.length; start += req.pageSize) {
    const t1 = performance.now();
    sweep.beginPage();
    const end = Math.min(commits.length, start + req.pageSize);
    for (let i = start; i < end; i++) sweep.place(commits[i]);
    const page = sweep.endPage();
    const layoutMs = performance.now() - t1;
    layoutTotal += layoutMs;
    if (req.payload === "json") {
      const body = JSON.stringify(page);
      post({ event: "rows", sessionId, format: "json", body, bytes: utf8.encode(body).byteLength, layoutMs });
    } else {
      const { body, transfer } = toColumnar(page);
      const bytes = utf8.encode(body.meta).byteLength + transfer.reduce((n, b) => n + b.byteLength, 0);
      post({ event: "rows", sessionId, format: "columnar", body, bytes, layoutMs }, transfer);
    }
    await yieldToEvents();
    if (sessionId !== current) return;
  }
  post({ event: "done", sessionId, total: commits.length, maxLanes: sweep.maxLanes, edges: sweep.edges, layoutMs: layoutTotal });
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type === "close") {
    if (req.sessionId === current) current = 0;
    return;
  }
  current = req.sessionId;
  open(req).catch((err: unknown) => {
    post({ event: "failed", sessionId: req.sessionId, error: err instanceof Error ? err.message : String(err) });
  });
};
