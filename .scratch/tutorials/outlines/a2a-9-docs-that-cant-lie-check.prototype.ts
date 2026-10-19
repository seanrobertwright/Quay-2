// PROTOTYPE, throwaway. Sketch of the docs-that-cant-lie starter's scripts/check-readme.ts,
// written for A2A 9, Docs that can't lie. Run from a package root with `node <this file>`.
// No coverage check yet. Not for merging.
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const md = readFileSync("README.md", "utf8").replace(/\r\n/g, "\n");
const fence = /^```(\w*)\n([\s\S]*?)^```$/gm;
const blocks: { lang: string; body: string; line: number }[] = [];
for (const m of md.matchAll(fence)) {
  blocks.push({ lang: m[1], body: m[2], line: md.slice(0, m.index).split("\n").length });
}
const dir = ".readme-samples";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
let run = 0;
let failed = 0;
const report: string[] = [];
blocks.forEach((b, i) => {
  if (b.lang !== "ts") return;
  run++;
  const next = blocks[i + 1];
  const expected = next && next.lang === "text" ? next.body : null;
  const file = join(dir, `sample-${run}.ts`);
  writeFileSync(file, b.body);
  const r = spawnSync(process.execPath, [file], { encoding: "utf8" });
  const actual = (r.stdout + r.stderr).replace(/\r\n/g, "\n");
  const ok = r.status === 0 && expected !== null && actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} sample ${run} (README.md line ${b.line})`);
  if (!ok) {
    report.push(
      `## Sample ${run}, README.md line ${b.line}\n\nCode:\n\n${b.body}\nExpected:\n\n${expected ?? "(no text block after it)\n"}\nActual (exit ${r.status}):\n\n${actual}`,
    );
  }
});
writeFileSync(join(dir, "report.md"), report.join("\n") || "All samples ran.\n");
console.log(`${run - failed} of ${run} samples ran as written`);
process.exit(run === 0 || failed > 0 ? 1 : 0);
