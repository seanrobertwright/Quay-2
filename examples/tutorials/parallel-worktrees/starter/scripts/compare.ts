// npm run compare -- <branch> ...: one row per branch, measuring the attempt in its folder.
// main is the project folder; any other branch is the worktree Quay made in .worktrees/<branch>.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const BAR_MS = 500;
const CUT_OFF_MS = 5_000;

const project = resolve(import.meta.dirname, "..");
const branches = process.argv.slice(2);
if (branches.length === 0) branches.push("main");

function folderOf(branch: string): string {
  return branch === "main" ? project : join(project, ".worktrees", branch.replace(/[/\\]/g, "-"));
}

/** Runs the folder's tests once and gives "<passed>/<total>", "no vitest" or "error". */
function tests(folder: string): string {
  let cli: string;
  try {
    const vitest = createRequire(join(folder, "package.json")).resolve("vitest/package.json");
    cli = join(dirname(vitest), "vitest.mjs");
  } catch {
    return "no vitest";
  }
  const out = mkdtempSync(join(tmpdir(), "compare-"));
  try {
    const report = join(out, "report.json");
    spawnSync(process.execPath, [cli, "run", "--reporter=json", `--outputFile=${report}`], { cwd: folder, stdio: "ignore" });
    if (!existsSync(report)) return "error";
    const { numPassedTests, numTotalTests } = JSON.parse(readFileSync(report, "utf8"));
    return `${numPassedTests}/${numTotalTests}`;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/**
 * Times the folder's findDuplicates on the 50,000 contacts, giving up after CUT_OFF_MS. The time
 * is "<ms> ms", "over <cut-off> s" or "error"; groups is "-" unless the bench finished.
 */
function bench(folder: string): { time: string; groups: string; bar: string } {
  const run = spawnSync(process.execPath, [join(project, "scripts", "bench.ts"), folder], {
    encoding: "utf8",
    timeout: CUT_OFF_MS,
  });
  if (run.error !== undefined || run.signal !== null) return { time: `over ${CUT_OFF_MS / 1_000} s`, groups: "-", bar: "FAIL" };
  if (run.status !== 0) return { time: "error", groups: "-", bar: "FAIL" };
  const { ms, groups } = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}");
  return { time: `${ms} ms`, groups: String(groups), bar: ms < BAR_MS ? "PASS" : "FAIL" };
}

/** The lines the folder changes under src/ against main, as "+<added> -<removed>", or "-" if git fails. */
function srcLines(folder: string): string {
  const diff = spawnSync("git", ["diff", "--shortstat", "main", "--", "src"], { cwd: folder, encoding: "utf8" });
  if (diff.status !== 0) return "-";
  const added = /(\d+) insertion/.exec(diff.stdout)?.[1] ?? "0";
  const removed = /(\d+) deletion/.exec(diff.stdout)?.[1] ?? "0";
  return `+${added} -${removed}`;
}

const rows = [["branch", "tests", "50k contacts", "groups", `under ${BAR_MS} ms`, "src lines"]];
for (const branch of branches) {
  const folder = folderOf(branch);
  if (!existsSync(join(folder, "src", "dedupe.ts"))) {
    rows.push([branch, "no worktree", "-", "-", "-", "-"]);
    continue;
  }
  const { time, groups, bar } = bench(folder);
  rows.push([branch, tests(folder), time, groups, bar, srcLines(folder)]);
}

const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
for (const row of rows) {
  console.log(row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd());
}
