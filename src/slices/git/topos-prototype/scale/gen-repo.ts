// PROTOTYPE (#370). Writes a real bare git repo from the #351 synthetic history:
//   node --experimental-transform-types --import ./scale/register.mjs scale/gen-repo.ts <commits> <out.git> [concurrency]
// Every commit has the empty tree, so the repo holds only commit objects, like a
// treeless clone. About 15% carry a `Quay-Agent: claude` trailer and 10% a Claude
// `Co-authored-by`, so the provenance trailer fields from #353 have work to do.

import { spawn, execFileSync } from "node:child_process";
import { synthesize } from "../synthetic";

const [countArg, out, concArg] = process.argv.slice(2);
const total = Number(countArg);
if (!Number.isInteger(total) || total < 1 || !out) {
  console.error("usage: gen-repo.ts <commits> <out.git> [concurrency]");
  process.exit(2);
}
const concurrency = concArg ? Number(concArg) : 8;

const t0 = performance.now();
const h = synthesize(total, concurrency, 370);
console.error(`synthesized ${h.commits.length} commits in ${Math.round(performance.now() - t0)} ms`);

// Oldest first. Squeeze the timestamps into the last 15 years, keeping their order.
const commits = h.commits.slice().reverse();
const tMin = commits[0].time;
const tMax = commits[commits.length - 1].time;
const end = 1_790_000_000;
const span = Math.min(tMax - tMin, 15 * 365 * 86400);
const scale = tMax === tMin ? 1 : span / (tMax - tMin);
const when = (t: number) => Math.round(end - span + (t - tMin) * scale);

execFileSync("git", ["init", "--bare", "-q", "-b", "main", out]);
const fi = spawn("git", ["-C", out, "fast-import", "--quiet", "--done"], { stdio: ["pipe", "inherit", "inherit"] });

const mark = new Map<string, number>();
let buf: string[] = [];
let bytes = 0;
const flush = async () => {
  const chunk = buf.join("");
  buf = [];
  bytes = 0;
  if (!fi.stdin.write(chunk)) await new Promise((r) => fi.stdin.once("drain", r));
};

let i = 0;
for (const c of commits) {
  i++;
  mark.set(c.oid, i);
  const email = `${c.author.toLowerCase()}@example.com`;
  let msg = c.subject + "\n";
  const r = (i * 2654435761) % 100;
  if (r < 15) msg += "\nQuay-Agent: claude\n";
  else if (r < 25) msg += "\nCo-authored-by: Claude <noreply@anthropic.com>\n";
  const t = when(c.time);
  let rec = `commit refs/heads/_gen\nmark :${i}\nauthor ${c.author} <${email}> ${t} +0000\ncommitter ${c.author} <${email}> ${t} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}`;
  if (c.parents.length > 0) {
    rec += `from :${mark.get(c.parents[0])}\n`;
    for (const p of c.parents.slice(1)) rec += `merge :${mark.get(p)}\n`;
  } else {
    rec += `deleteall\n`;
  }
  rec += "\n";
  buf.push(rec);
  bytes += rec.length;
  if (bytes > 1 << 20) await flush();
}
for (const ref of h.refs) {
  buf.push(`reset ${ref.name}\nfrom :${mark.get(ref.oid)}\n\n`);
}
buf.push(`reset refs/heads/_gen\nfrom 0000000000000000000000000000000000000000\n\ndone\n`);
await flush();
fi.stdin.end();
await new Promise<void>((res, rej) => fi.on("exit", (code) => (code === 0 ? res() : rej(new Error(`fast-import exit ${code}`)))));
execFileSync("git", ["-C", out, "symbolic-ref", "HEAD", "refs/heads/main"]);
console.error(`wrote ${out} (${h.refs.length} refs) in ${Math.round(performance.now() - t0)} ms`);
