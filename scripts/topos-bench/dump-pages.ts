// Records a real graph session for the Topos scale benchmark (#377):
//   node scripts/topos-bench/dump-pages.ts <repo> <out.pages>
// It runs the ignored Rust test `dump_graph_session_for_benchmark`, which opens a graph session on
// <repo> through the same code `git_graph_open` uses, grants every row up to the 2M hard cap, and
// writes each channel message to <out.pages> as the frontend would receive it.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [repo, out] = process.argv.slice(2);
if (!repo || !out) {
  console.error("usage: node scripts/topos-bench/dump-pages.ts <repo> <out.pages>");
  process.exit(2);
}
if (!existsSync(repo)) {
  console.error(`${repo}: no such repository`);
  process.exit(2);
}

const srcTauri = resolve(dirname(fileURLToPath(import.meta.url)), "../../src-tauri");
const run = spawnSync(
  "cargo",
  ["test", "--lib", "--", "--ignored", "--nocapture", "--exact", "slices::git::graph::bench_dump::dump_graph_session_for_benchmark"],
  {
    cwd: srcTauri,
    stdio: "inherit",
    env: { ...process.env, TOPOS_BENCH_REPO: resolve(repo), TOPOS_BENCH_OUT: resolve(out) },
  }
);
process.exit(run.status ?? 1);
