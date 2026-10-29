// PROTOTYPE (#370). Times the #350 `git log -z` stream on a repo:
//   node ... scale/bench-git.ts <repo> [runs]
// For each variant it reports the time to the first record, to the first 512-row
// page, and to the end of the stream, plus bytes. Variants: date or topo order,
// with or without the two #353 trailer fields. Run it before and after
// `git commit-graph write` to see what the graph file buys.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [repo, runsArg, graphArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
/** "nograph" runs git with core.commitGraph=false, whatever is on disk. */
const useGraph = graphArg !== "nograph";

const BASE = "%H%x00%P%x00%aN%x00%aE%x00%at%x00%ct%x00%s";
const TRAILERS = "%x00%(trailers:key=Quay-Agent,valueonly,separator=%x2C)%x00%(trailers:key=Co-authored-by,valueonly,separator=%x2C)";

export interface StreamTiming {
  firstRowMs: number;
  firstPageMs: number;
  fullMs: number;
  rows: number;
  bytes: number;
}

export function timeLog(repo: string, order: "date" | "topo", trailers: boolean, graph = true): Promise<StreamTiming> {
  const fields = trailers ? 9 : 7;
  const args = ["-C", repo, ...(graph ? [] : ["-c", "core.commitGraph=false"]), "--no-optional-locks", "log", "--no-color", "--no-show-signature", `--${order}-order`, "-z",
    `--format=${BASE}${trailers ? TRAILERS : ""}`, "--branches", "--remotes", "--tags", "HEAD"];
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, LC_ALL: "C" } });
    let nuls = 0;
    let bytes = 0;
    let firstRowMs = -1;
    let firstPageMs = -1;
    p.stdout.on("data", (b: Buffer) => {
      bytes += b.length;
      for (let i = b.indexOf(0); i !== -1; i = b.indexOf(0, i + 1)) nuls++;
      const rows = Math.floor(nuls / fields);
      if (firstRowMs < 0 && rows >= 1) firstRowMs = performance.now() - t0;
      if (firstPageMs < 0 && rows >= 512) firstPageMs = performance.now() - t0;
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`git exit ${code}`));
      resolve({ firstRowMs, firstPageMs, fullMs: performance.now() - t0, rows: Math.floor(nuls / fields), bytes });
    });
  });
}

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

if (repo) {
  const onDisk = existsSync(join(repo, "objects/info/commit-graph")) || existsSync(join(repo, "objects/info/commit-graphs"));
  console.log(`# ${repo}  commit-graph on disk: ${onDisk ? "yes" : "no"}  used: ${useGraph && onDisk ? "yes" : "no"}  runs: ${runs}`);
  console.log("order | trailers | rows | first row ms | first page ms | full ms | MB");
  for (const order of ["date", "topo"] as const) {
    for (const trailers of [false, true]) {
      const res: StreamTiming[] = [];
      for (let i = 0; i < runs; i++) res.push(await timeLog(repo, order, trailers, useGraph));
      const m = (k: keyof StreamTiming) => Math.round(median(res.map((r) => r[k])));
      console.log(`${order} | ${trailers ? "yes" : "no"} | ${res[0].rows} | ${m("firstRowMs")} | ${m("firstPageMs")} | ${m("fullMs")} | ${(res[0].bytes / 1e6).toFixed(1)}`);
    }
  }
}
