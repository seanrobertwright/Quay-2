// PROTOTYPE (#351). The online lane pass from the #348 findings, written fresh
// in TypeScript so the prototype can run without Rust. The real one belongs in
// src-tauri/src/slices/git. One commit at a time, top-down; a row's lane depends
// only on the rows above it, so emitted rows never move.

import { EDGE_FIRST_PARENT, EDGE_JOIN, EDGE_MERGE, OPEN_ROW, type ClashMode, type PageJson, type RefOut, type TrackOut } from "./protocol";
import { hashedSlot, probeSlot } from "./palette";

export interface Commit {
  oid: string;
  parents: string[];
  author: string;
  /** Unix seconds. */
  time: number;
  subject: string;
}

export interface Ref {
  oid: string;
  /** Full ref name, e.g. refs/heads/main or refs/remotes/origin/main. */
  name: string;
  current: boolean;
}

interface LaneSlot {
  awaits: string;
  track: number;
  edge: number;
  rank: number;
}

const RANK_DEFAULT = 0;
const RANK_NAMED = 1;
const RANK_DERIVED = 2;
const RANK_ANON = 3;

function shortRefName(name: string): { short: string; kind: RefOut["kind"] } | null {
  if (name.startsWith("refs/heads/")) return { short: name.slice("refs/heads/".length), kind: "local" };
  if (name.startsWith("refs/remotes/")) {
    const rest = name.slice("refs/remotes/".length);
    if (rest.endsWith("/HEAD")) return null;
    return { short: rest, kind: "remote" };
  }
  if (name.startsWith("refs/tags/")) return { short: name.slice("refs/tags/".length), kind: "tag" };
  return null;
}

/** Branch name without refs/heads/ or refs/remotes/<remote>/, so main and origin/main share a color. */
function trackKeyOfRef(name: string): string | null {
  if (name.startsWith("refs/heads/")) return name.slice("refs/heads/".length);
  if (name.startsWith("refs/remotes/")) {
    const rest = name.slice("refs/remotes/".length);
    const slash = rest.indexOf("/");
    const branch = slash < 0 ? "" : rest.slice(slash + 1);
    // <remote>/HEAD is a pointer to the remote's default branch, not a branch of its own.
    return branch === "" || branch === "HEAD" ? null : branch;
  }
  return null;
}

/** Branch names parsed from the merge message, indexed by parent index (1-based). */
export function mergeBranchName(subject: string, parentIndex: number): string | null {
  let m = /^Merge branch '([^']+)'/.exec(subject);
  if (m) return parentIndex === 1 ? m[1] : null;
  m = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject);
  if (m) return parentIndex === 1 ? m[1] : null;
  m = /^Merge remote-tracking branch '(?:[^/']+\/)?([^']+)'/.exec(subject);
  if (m) return parentIndex === 1 ? m[1] : null;
  m = /^Merge branches (.+?)(?: into \S+)?$/.exec(subject);
  if (m) {
    const names = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    return names[parentIndex - 1] ?? null;
  }
  return null;
}

export class LaneSweep {
  private lanes: (LaneSlot | null)[] = [];
  /** Holes below lanes.length, kept sorted ascending. */
  private free: number[] = [];
  private awaiting = new Map<string, number[]>();
  private refsByOid = new Map<string, Ref[]>();
  private trackCount = 0;
  private trackSlots: number[] = [];
  private trackRanks: number[] = [];
  private edgeCount = 0;
  private row = 0;
  maxLanes = 0;

  private page!: PageJson;

  constructor(
    private readonly defaultBranch: string,
    refs: Ref[],
    private readonly clash: ClashMode,
  ) {
    for (const ref of refs) {
      const list = this.refsByOid.get(ref.oid) ?? [];
      list.push(ref);
      this.refsByOid.set(ref.oid, list);
    }
    // Pin lane 0 to the default branch: it waits for the tip but draws nothing until it lands.
    // It waits for the local and the remote tip at once and takes whichever streams in first,
    // so a stale local branch (common in agent worktrees) does not leave lane 0 empty.
    this.pinnedTips = [...new Set(refs.filter((r) => trackKeyOfRef(r.name) === defaultBranch).map((r) => r.oid))];
    this.page = this.emptyPage();
    if (this.pinnedTips.length > 0) {
      const track = this.newTrack(defaultBranch, RANK_DEFAULT, 0);
      this.lanes.push({ awaits: this.pinnedTips[0], track, edge: -1, rank: RANK_DEFAULT });
      for (const oid of this.pinnedTips) this.awaiting.set(oid, [0]);
    }
  }

  private pinnedTips: string[] = [];

  /** Once lane 0 receives its first default-branch tip, the other tips stop waiting in it. */
  private settlePin(oid: string): void {
    for (const other of this.pinnedTips) {
      if (other === oid) continue;
      const list = this.awaiting.get(other);
      if (!list) continue;
      const rest = list.filter((l) => l !== 0);
      if (rest.length > 0) this.awaiting.set(other, rest);
      else this.awaiting.delete(other);
    }
    this.pinnedTips = [];
  }

  get edges(): number {
    return this.edgeCount;
  }

  private emptyPage(): PageJson {
    return {
      start: this.row, oid: [], author: [], subject: [], time: [], lane: [], track: [], parentCount: [],
      edgeStart: this.edgeCount, eChildRow: [], eParentRow: [], eLane: [], eChildLane: [], eParentLane: [],
      eKind: [], eTrack: [], closes: [], checkpoint: [], tracks: [], refs: [], laneCount: 0,
    };
  }

  /** Starts a page and records its checkpoint: the edges open before its first row is placed. */
  beginPage(): void {
    this.page = this.emptyPage();
    for (const slot of this.lanes) if (slot && slot.edge >= 0) this.page.checkpoint.push(slot.edge);
  }

  endPage(): PageJson {
    this.page.laneCount = this.maxLanes;
    return this.page;
  }

  private newTrack(key: string, rank: number, lane: number): number {
    let slot = hashedSlot(key, this.defaultBranch);
    const probe = this.clash === "all" ? rank >= RANK_NAMED : this.clash === "derived" ? rank >= RANK_DERIVED : false;
    if (probe && slot !== 0) {
      const neighbours: number[] = [];
      for (const l of [lane - 1, lane + 1]) {
        const s = this.lanes[l];
        if (s) neighbours.push(this.trackSlots[s.track]);
      }
      slot = probeSlot(slot, neighbours);
    }
    const id = this.trackCount++;
    this.trackSlots[id] = slot;
    this.trackRanks[id] = rank;
    const out: TrackOut = { id, name: rank === RANK_ANON ? null : key, slot, rank };
    this.page.tracks.push(out);
    return id;
  }

  private openEdge(lane: number, childLane: number, kind: number, track: number, parentRow = OPEN_ROW, parentLane = 0): number {
    const p = this.page;
    p.eChildRow.push(this.row);
    p.eParentRow.push(parentRow);
    p.eLane.push(lane);
    p.eChildLane.push(childLane);
    p.eParentLane.push(parentLane);
    p.eKind.push(kind);
    p.eTrack.push(track);
    return this.edgeCount++;
  }

  private closeEdge(edge: number, parentLane: number): void {
    if (edge < 0) return;
    const p = this.page;
    const local = edge - p.edgeStart;
    if (local >= 0) {
      // Opened in this same page: patch in place rather than send a close.
      p.eParentRow[local] = this.row;
      p.eParentLane[local] = parentLane;
    } else {
      p.closes.push(edge, this.row, parentLane);
    }
  }

  private freeLane(lane: number): void {
    this.lanes[lane] = null;
    let lo = 0;
    let hi = this.free.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.free[mid] < lane) lo = mid + 1;
      else hi = mid;
    }
    this.free.splice(lo, 0, lane);
  }

  private takeLowestFree(): number {
    if (this.free.length > 0) return this.free.shift()!;
    this.lanes.push(null);
    return this.lanes.length - 1;
  }

  private takeFreeRightOf(lane: number): number {
    const i = this.free.findIndex((l) => l > lane);
    if (i >= 0) return this.free.splice(i, 1)[0];
    this.lanes.push(null);
    return this.lanes.length - 1;
  }

  private tipTrack(c: Commit, lane: number): number {
    const refs = (this.refsByOid.get(c.oid) ?? [])
      .map((r) => ({ r, key: trackKeyOfRef(r.name) }))
      .filter((x): x is { r: Ref; key: string } => x.key !== null)
      .sort((a, b) =>
        Number(b.r.current) - Number(a.r.current)
        || Number(b.r.name.startsWith("refs/heads/")) - Number(a.r.name.startsWith("refs/heads/"))
        || a.key.localeCompare(b.key));
    if (refs.length > 0) return this.newTrack(refs[0].key, RANK_NAMED, lane);
    return this.newTrack(c.oid, RANK_ANON, lane);
  }

  place(c: Commit): void {
    const p = this.page;
    const row = this.row;
    const waiting = this.awaiting.get(c.oid);
    this.awaiting.delete(c.oid);

    let lane: number;
    let track: number;
    if (!waiting || waiting.length === 0) {
      lane = this.takeLowestFree();
      track = this.tipTrack(c, lane);
    } else {
      lane = waiting[0];
      for (const l of waiting) {
        const a = this.lanes[l]!;
        const b = this.lanes[lane]!;
        if (a.rank < b.rank || (a.rank === b.rank && l < lane)) lane = l;
      }
      track = this.lanes[lane]!.track;
      for (const l of waiting) {
        if (l === lane) continue;
        this.closeEdge(this.lanes[l]!.edge, lane);
        this.freeLane(l);
      }
      this.closeEdge(this.lanes[lane]!.edge, lane);
      if (lane === 0 && this.pinnedTips.length > 0) this.settlePin(c.oid);
    }
    const rank = this.trackRanks[track];

    p.oid.push(c.oid);
    p.author.push(c.author);
    p.subject.push(c.subject);
    p.time.push(c.time);
    p.lane.push(lane);
    p.track.push(track);
    p.parentCount.push(c.parents.length);
    for (const ref of this.refsByOid.get(c.oid) ?? []) {
      const short = shortRefName(ref.name);
      if (short) p.refs.push({ row, name: short.short, kind: short.kind, current: ref.current });
    }

    if (c.parents.length === 0) {
      this.freeLane(lane);
    } else {
      const p0 = c.parents[0];
      const e = this.openEdge(lane, lane, EDGE_FIRST_PARENT, track);
      this.lanes[lane] = { awaits: p0, track, edge: e, rank };
      const w0 = this.awaiting.get(p0);
      if (w0) w0.push(lane);
      else this.awaiting.set(p0, [lane]);

      for (let k = 1; k < c.parents.length; k++) {
        const parent = c.parents[k];
        const existing = this.awaiting.get(parent);
        if (existing && existing.length > 0) {
          const into = existing[0];
          if (into === lane) continue;
          const target = this.lanes[into]!;
          if (target.edge < 0) {
            // The pinned lane has not started drawing yet, so there is no line to join:
            // run a merge edge down that lane instead, and let the tip close it.
            target.edge = this.openEdge(into, lane, EDGE_MERGE, target.track);
          } else {
            this.openEdge(into, lane, EDGE_JOIN, target.track, row + 1, into);
          }
          continue;
        }
        const l = this.takeFreeRightOf(lane);
        const name = mergeBranchName(c.subject, k);
        const t = name !== null ? this.newTrack(name, RANK_DERIVED, l) : this.newTrack(`${c.oid}:${k}`, RANK_ANON, l);
        const me = this.openEdge(l, lane, EDGE_MERGE, t);
        this.lanes[l] = { awaits: parent, track: t, edge: me, rank: this.trackRanks[t] };
        this.awaiting.set(parent, [l]);
      }
    }

    while (this.lanes.length > 0 && this.lanes[this.lanes.length - 1] === null) {
      this.lanes.pop();
      const last = this.free.pop();
      if (last !== this.lanes.length) throw new Error(`free list out of sync: ${last} vs ${this.lanes.length}`);
    }
    this.maxLanes = Math.max(this.maxLanes, this.lanes.length);
    this.row++;
  }
}
