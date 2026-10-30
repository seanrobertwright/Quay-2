// Writes a synthetic bare repo for the Topos scale benchmark (#377), in the style of the #370
// prototype's generator:
//   node scripts/topos-bench/gen-repo.ts <commits> <out.git> [live-branches]
// Every commit has the empty tree, so the repo holds only commit objects, like a treeless clone.
// History is `main` plus a few live feature branches that grow side by side and merge back into
// `main`, so date order interleaves them and the lane pass has real lanes to keep. About 15% of
// commits carry a `Quay-Agent: claude` trailer and 10% a Claude `Co-authored-by`, so the
// provenance trailer fields (#353) have work to do. The output is deterministic for a given
// commit count and branch count.

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

function usage(message: string): never {
  console.error(`${message}\nusage: node scripts/topos-bench/gen-repo.ts <commits> <out.git> [live-branches]`);
  process.exit(2);
}

function positiveInt(text: string | undefined, what: string, max: number): number {
  if (text === undefined || !/^\d+$/.test(text)) usage(`${what} must be a whole number`);
  const n = Number(text);
  if (n < 1 || n > max) usage(`${what} must be between 1 and ${max}`);
  return n;
}

const [countArg, out, branchesArg] = process.argv.slice(2);
const total = positiveInt(countArg, "commits", 5_000_000);
if (!out) usage("name the bare repo to write");
if (existsSync(out)) usage(`${out} already exists; remove it or name another path`);
const liveBranches = branchesArg === undefined ? 8 : positiveInt(branchesArg, "live-branches", 64);

/** mulberry32: a small seeded PRNG, so a given size always writes the same history. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = prng(377);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];
const AUTHORS = ["Ada", "Brook", "Cyd", "Dana", "Eli", "Fen", "Gale", "Hana", "Ira", "Jo", "Kit", "Lee", "Max", "Noor", "Oak", "Pat"];
const AREAS = ["graph", "pty", "rail", "stage", "docs", "build", "auth", "ui", "core", "api"];
const VERBS = ["fix", "add", "drop", "tidy", "speed up", "rename", "test", "document"];

interface Branch {
  name: string;
  /** Mark of the branch's tip, or of the `main` commit it starts from before its first commit. */
  tip: number;
  /** Commits it gets before it merges back. */
  length: number;
  commits: number;
}

let serial = 0;
const newBranch = (from: number): Branch => ({
  name: `feature-${++serial}`,
  tip: from,
  length: 3 + Math.floor(random() * 60),
  commits: 0,
});

// Oldest first, one to ten minutes apart, ending at 2026-09-01.
const end = 1_788_220_800;
let time = end - total * 330;
let mark = 0;
let mainTip = 0;
const live: Branch[] = [];
/** The last merged branches keep a remote-tracking ref, as an un-pruned clone has. */
const merged: Branch[] = [];
const MERGED_REFS = 40;

execFileSync("git", ["init", "--bare", "-q", "-b", "main", out]);
const fastImport = spawn("git", ["-C", out, "fast-import", "--quiet", "--done"], { stdio: ["pipe", "inherit", "inherit"] });
let buffer: string[] = [];
let bytes = 0;
const flush = async () => {
  const chunk = buffer.join("");
  buffer = [];
  bytes = 0;
  if (!fastImport.stdin.write(chunk)) await new Promise((resolve) => fastImport.stdin.once("drain", resolve));
};

async function commit(parents: number[], subject: string): Promise<number> {
  mark++;
  time += 60 + Math.floor(random() * 540);
  const author = pick(AUTHORS);
  let message = `${subject}\n`;
  const roll = (mark * 2654435761) % 100;
  if (roll < 15) message += "\nQuay-Agent: claude\n";
  else if (roll < 25) message += "\nCo-authored-by: Claude <noreply@anthropic.com>\n";
  const who = `${author} <${author.toLowerCase()}@example.invalid> ${time} +0000`;
  let record = `commit refs/heads/_gen\nmark :${mark}\nauthor ${who}\ncommitter ${who}\ndata ${Buffer.byteLength(message)}\n${message}`;
  if (parents.length === 0) record += "deleteall\n";
  else {
    record += `from :${parents[0]}\n`;
    for (const parent of parents.slice(1)) record += `merge :${parent}\n`;
  }
  buffer.push(record, "\n");
  bytes += record.length;
  if (bytes > 1 << 20) await flush();
  return mark;
}

const started = performance.now();
mainTip = await commit([], "Initial commit");
while (mark < total) {
  while (live.length < liveBranches) live.push(newBranch(mainTip));
  const subject = `${pick(AREAS)}: ${pick(VERBS)} #${mark + 1}`;
  if (random() < 0.4) {
    mainTip = await commit([mainTip], subject);
    continue;
  }
  const index = Math.floor(random() * live.length);
  const branch = live[index];
  if (branch.commits >= branch.length) {
    mainTip = await commit([mainTip, branch.tip], `Merge branch '${branch.name}'`);
    live.splice(index, 1);
    merged.push(branch);
    if (merged.length > MERGED_REFS) merged.shift();
    continue;
  }
  branch.tip = await commit([branch.tip], subject);
  branch.commits++;
}

buffer.push(`reset refs/heads/main\nfrom :${mainTip}\n\n`, `reset refs/remotes/origin/main\nfrom :${mainTip}\n\n`);
for (const branch of live) if (branch.commits > 0) buffer.push(`reset refs/heads/${branch.name}\nfrom :${branch.tip}\n\n`);
for (const branch of merged) buffer.push(`reset refs/remotes/origin/${branch.name}\nfrom :${branch.tip}\n\n`);
buffer.push("reset refs/heads/_gen\nfrom 0000000000000000000000000000000000000000\n\ndone\n");
await flush();
fastImport.stdin.end();
await new Promise<void>((resolve, reject) =>
  fastImport.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`git fast-import exited with ${code}`))))
);
execFileSync("git", ["-C", out, "symbolic-ref", "HEAD", "refs/heads/main"]);
console.error(`wrote ${mark.toLocaleString()} commits to ${out} in ${Math.round(performance.now() - started)} ms`);
