// PROTOTYPE (#370). Times the #351 lane pass (TypeScript, a stand-in for the Rust
// worker) over a repo's real `git log -z` stream, then measures the refresh
// splice for several checkpoint intervals:
//   node --expose-gc ... scale/bench-layout.ts <repo> [order]
// Splice: the "old" session is the history without its newest K commits; the
// "new" session is the full history. A splice lays the new stream out from row 0
// until a checkpoint matches an old one by (oid at the row, lane state), so the
// cost is the number of rows laid out before that match.

import { execFileSync } from "node:child_process";
import { LaneSweep, type Commit, type Ref } from "../lanes";

const [repo, orderArg] = process.argv.slice(2);
const order = orderArg === "topo" ? "topo" : "date";
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const mb = (n: number) => (n / 1e6).toFixed(0);

function readHistory(repo: string) {
  const t0 = performance.now();
  const out = execFileSync("git", ["-C", repo, "--no-optional-locks", "log", "--no-color", "--no-show-signature",
    `--${order}-order`, "-z", "--format=%H%x00%P%x00%aN%x00%ct%x00%s", "--branches", "--remotes", "--tags", "HEAD"],
    { maxBuffer: 2 ** 31, env: { ...process.env, LC_ALL: "C" } });
  const gitMs = performance.now() - t0;
  const t1 = performance.now();
  const f = out.toString("utf8").split("\0");
  const commits: Commit[] = [];
  for (let i = 0; i + 4 < f.length; i += 5) {
    const p = f[i + 1];
    commits.push({ oid: f[i].replace(/^\n/, ""), parents: p ? p.split(" ") : [], author: f[i + 2], time: Number(f[i + 3]), subject: f[i + 4] });
  }
  const parseMs = performance.now() - t1;
  const refs: Ref[] = execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(objectname)%00%(*objectname)%00%(refname)%00%(HEAD)",
    "refs/heads", "refs/remotes", "refs/tags"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean).map((line) => {
      const [oid, peeled, name, head] = line.split("\0");
      return { oid: peeled || oid, name, current: head === "*" };
    });
  let defaultBranch = "main";
  if (refs.some((r) => r.name === "refs/heads/master") && !refs.some((r) => r.name === "refs/heads/main")) defaultBranch = "master";
  return { commits, refs, defaultBranch, gitMs, parseMs };
}

/** A 53-bit hash of the lane state, so a checkpoint costs 8 bytes plus its oid key. */
type LaneState = number;
interface Run {
  ms: number;
  firstPageMs: number;
  maxLanes: number;
  jsonBytes: number;
  /** Checkpoint key per interval row: oid at the row plus the awaited oid of each lane. */
  /** Per interval: oid at each checkpoint row -> lane state (the awaited oid of each lane). */
  checkpoints: Map<number, Map<string, LaneState>>;
  rowsUntilMatch?: number;
}

function laneState(sweep: LaneSweep, _oid: string): LaneState {
  const lanes = (sweep as unknown as { lanes: ({ awaits: string } | null)[] }).lanes;
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (const l of lanes) {
    const s = l ? l.awaits : "-";
    for (let i = 0; i < Math.min(12, s.length); i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b ^ c, 0x5bd1e995);
    }
    a = Math.imul(a ^ 44, 0x01000193);
    b = Math.imul(b ^ 44, 0x5bd1e995);
  }
  return (a >>> 0) * 2097152 + ((b >>> 0) & 0x1fffff);
}

function layout(commits: Commit[], refs: Ref[], defaultBranch: string, opts: {
  intervals: number[];
  measureJson?: boolean;
  /**
   * Stop at the first row whose oid is an old checkpoint's oid and whose lane state matches it.
   * Every row is tested: after K prepended commits, old checkpoint rows sit at old + K, which is
   * not a multiple of the interval, so testing only the new pass's own checkpoint rows never hits.
   */
  matchAgainst?: Map<string, LaneState>;
}): Run {
  const t0 = performance.now();
  const sweep = new LaneSweep(defaultBranch, refs, "derived");
  const checkpoints = new Map<number, Map<string, LaneState>>(opts.intervals.map((i) => [i, new Map()]));
  let jsonBytes = 0;
  let firstPageMs = 0;
  sweep.beginPage();
  for (let row = 0; row < commits.length; row++) {
    if (row > 0 && row % 512 === 0) {
      const page = sweep.endPage();
      if (opts.measureJson) jsonBytes += JSON.stringify(page).length;
      if (row === 512) firstPageMs = performance.now() - t0;
      sweep.beginPage();
    }
    const want = opts.matchAgainst?.get(commits[row].oid);
    if (want !== undefined && laneState(sweep, commits[row].oid) === want) {
      return { ms: performance.now() - t0, firstPageMs, maxLanes: sweep.maxLanes, jsonBytes, checkpoints, rowsUntilMatch: row };
    }
    for (const interval of opts.intervals) {
      if (row % interval === 0) checkpoints.get(interval)!.set(commits[row].oid, laneState(sweep, commits[row].oid));
    }
    sweep.place(commits[row]);
  }
  const last = sweep.endPage();
  if (opts.measureJson) jsonBytes += JSON.stringify(last).length;
  return { ms: performance.now() - t0, firstPageMs, maxLanes: sweep.maxLanes, jsonBytes, checkpoints, rowsUntilMatch: undefined };
}

/** Drops the newest K commits: the old session's history and refs before they existed. */
function withoutNewest(commits: Commit[], refs: Ref[], k: number) {
  const dropped = new Set(commits.slice(0, k).map((c) => c.oid));
  const byOid = new Map(commits.map((c) => [c.oid, c]));
  const settle = (oid: string): string | null => {
    let cur: string | undefined = oid;
    while (cur && dropped.has(cur)) cur = byOid.get(cur)?.parents[0];
    return cur ?? null;
  };
  const oldRefs = refs.flatMap((r) => {
    const oid = settle(r.oid);
    return oid ? [{ ...r, oid }] : [];
  });
  return { commits: commits.slice(k), refs: oldRefs };
}

const h = readHistory(repo);
console.log(`# ${repo} ${order}-order: ${h.commits.length} rows, ${h.refs.length} refs, default ${h.defaultBranch}`);
console.log(`git log (buffered) ${Math.round(h.gitMs)} ms, JS parse ${Math.round(h.parseMs)} ms`);

gc();
const heap0 = process.memoryUsage().heapUsed;
const full = layout(h.commits, h.refs, h.defaultBranch, { intervals: [], measureJson: true });
gc();
const heap1 = process.memoryUsage().heapUsed;
console.log(`lane pass: ${Math.round(full.ms)} ms total (${(full.ms / h.commits.length * 1000).toFixed(2)} µs/row), first page ${full.firstPageMs.toFixed(1)} ms, peak lanes ${full.maxLanes}`);
console.log(`page JSON ${mb(full.jsonBytes)} MB (${Math.round(full.jsonBytes / h.commits.length)} B/row); history heap ${mb(heap0)} MB, after layout ${mb(heap1)} MB`);

const INTERVALS = [1, 16, 64, 128, 512, 2048];
console.log("\nsplice: new commits K | interval | rows laid out before a match | ms | old checkpoints kept");
for (const k of [1, 10, 100, 1000]) {
  const old = withoutNewest(h.commits, h.refs, k);
  const oldRun = layout(old.commits, old.refs, h.defaultBranch, { intervals: INTERVALS });
  for (const interval of INTERVALS) {
    const keys = oldRun.checkpoints.get(interval)!;
    const res = layout(h.commits, h.refs, h.defaultBranch, { intervals: [], matchAgainst: keys });
    const rows = res.rowsUntilMatch === undefined ? `none (Reset)` : String(res.rowsUntilMatch);
    console.log(`${k} | ${interval} | ${rows} | ${Math.round(res.ms)} | ${keys.size}`);
  }
}
