// PROTOTYPE (#370). Is a full-history "tidy" layout worth offering? Compares the
// online lane pass's width in date order (the default) and topo order (what a tidy
// mode would trade for), per repo:
//   node ... scale/tidy.ts <repo>
// Width is the lane count at each row: peak, mean, p95, and the share of rows wider
// than the 12 lanes the default 220 px graph column shows.

import { execFileSync } from "node:child_process";
import { LaneSweep, type Commit, type Ref } from "../lanes";

const [repo] = process.argv.slice(2);

const refs: Ref[] = execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(objectname)%00%(*objectname)%00%(refname)%00%(HEAD)",
  "refs/heads", "refs/remotes", "refs/tags"], { encoding: "utf8", maxBuffer: 2 ** 28 })
  .split("\n").filter(Boolean).map((line) => {
    const [oid, peeled, name, head] = line.split("\0");
    return { oid: peeled || oid, name, current: head === "*" };
  });
const defaultBranch = refs.some((r) => r.name === "refs/heads/main") ? "main" : "master";

for (const order of ["date", "topo"]) {
  const out = execFileSync("git", ["-C", repo, "--no-optional-locks", "log", `--${order}-order`, "-z",
    "--format=%H%x00%P%x00%aN%x00%ct%x00%s", "--branches", "--remotes", "HEAD"], { maxBuffer: 2 ** 31 });
  const f = out.toString("utf8").split("\0");
  const sweep = new LaneSweep(defaultBranch, refs, "derived");
  const lanes = (sweep as unknown as { lanes: unknown[] }).lanes;
  const widths = new Uint16Array(Math.floor(f.length / 5));
  const t0 = performance.now();
  sweep.beginPage();
  let row = 0;
  for (let i = 0; i + 4 < f.length; i += 5, row++) {
    if (row > 0 && row % 512 === 0) { sweep.endPage(); sweep.beginPage(); }
    const p = f[i + 1];
    const c: Commit = { oid: f[i].replace(/^\n/, ""), parents: p ? p.split(" ") : [], author: f[i + 2], time: Number(f[i + 3]), subject: f[i + 4] };
    sweep.place(c);
    widths[row] = (lanes as unknown[]).length;
  }
  const ms = performance.now() - t0;
  const w = widths.subarray(0, row);
  const sorted = Uint16Array.from(w).sort();
  let sum = 0;
  let wide = 0;
  for (const x of w) { sum += x; if (x > 12) wide++; }
  console.log(`${repo} ${order}: ${row} rows, peak ${sweep.maxLanes}, mean ${(sum / row).toFixed(1)}, p95 ${sorted[Math.floor(row * 0.95)]}, rows > 12 lanes ${(100 * wide / row).toFixed(1)}%, pass ${Math.round(ms)} ms`);
}
