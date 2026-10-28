// Runs every sample in README.md and checks it prints what the README says it prints.
//
// A sample is a fenced block tagged ts. The block right after it, with only blank lines between,
// must be tagged text and hold the sample's exact output. Each sample is written to
// .readme-samples/sample-<n>.ts and run with this same node, from where it can import "slugkit".
// A block tagged as other JavaScript or TypeScript fails, since it would never be run. Every
// export of slugkit must be called in at least one passing sample. Failures go to
// .readme-samples/report.md, which ends with the same summary line this script prints last.
// Exits 1 when anything fails.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SAMPLE_TIMEOUT_MS = 10_000;
const UNRUN_CODE_TAGS = new Set(["typescript", "mts", "cts", "tsx", "js", "javascript", "mjs", "cjs", "jsx"]);
const dir = ".readme-samples";

type Block = { lang: string; body: string; line: number; start: number; end: number };
type Result = { n: number; line: number; code: string; expected: string | null; actual: string; ok: boolean };

const readme = readFileSync("README.md", "utf8").replace(/\r\n/g, "\n");
const blocks: Block[] = [];
// The opening fence may carry more after its language, such as ```ts title="x".
for (const match of readme.matchAll(/^```([\w-]*)[^\n`]*\n([\s\S]*?)^```[ \t]*$/gm)) {
  const start = match.index;
  blocks.push({
    lang: match[1].toLowerCase(),
    body: match[2],
    line: readme.slice(0, start).split("\n").length,
    start,
    end: start + match[0].length,
  });
}

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);

const results: Result[] = [];
blocks.forEach((block, i) => {
  const n = results.length + 1;
  if (UNRUN_CODE_TAGS.has(block.lang)) {
    const actual = `(not run: tagged ${block.lang}; tag a sample ts so it runs)\n`;
    results.push({ n, line: block.line, code: block.body, expected: null, actual, ok: false });
    console.log(`FAIL sample ${n} (README.md line ${block.line})`);
    return;
  }
  if (block.lang !== "ts") return;
  const next = blocks[i + 1];
  const adjacent = next !== undefined && readme.slice(block.end, next.start).trim() === "";
  const expected = adjacent && next.lang === "text" ? next.body : null;
  const file = join(dir, `sample-${n}.ts`);
  writeFileSync(file, block.body);
  const run = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: SAMPLE_TIMEOUT_MS });
  const stdout = (run.stdout ?? "").replace(/\r\n/g, "\n");
  const stderr = (run.stderr ?? "").replace(/\r\n/g, "\n");
  const exit = run.error ? `did not finish: ${run.error.message}` : `exit ${run.status}`;
  const actual = stderr === "" ? `${stdout}(${exit})\n` : `${stdout}${stderr}(${exit})\n`;
  const ok = run.status === 0 && expected !== null && stdout === expected;
  results.push({ n, line: block.line, code: block.body, expected, actual, ok });
  console.log(`${ok ? "PASS" : "FAIL"} sample ${n} (README.md line ${block.line})`);
});

const exports = Object.keys(await import("slugkit")).sort();
const passing = results.filter((r) => r.ok);
const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const called = (name: string, code: string) => new RegExp(`\\b${escape(name)}\\s*\\(`).test(code);
const uncovered = exports.filter((name) => !passing.some((r) => called(name, r.code)));
console.log(uncovered.length === 0 ? `Exports covered: ${exports.join(", ")}` : `Not covered: ${uncovered.join(", ")}`);

const summary = `${passing.length} of ${results.length} samples ran as written`;
console.log(summary);

const sections = results
  .filter((r) => !r.ok)
  .map(
    (r) =>
      `## Sample ${r.n}, README.md line ${r.line}\n\nCode:\n\n${r.code}\nExpected:\n\n` +
      `${r.expected ?? "(no text block right after it, with only blank lines between)\n"}\nActual:\n\n${r.actual}`,
  );
if (results.length === 0) sections.push("## No samples\n\nREADME.md has no ts block.\n");
if (uncovered.length > 0) {
  sections.push(`## Not covered\n\nNo passing sample calls: ${uncovered.join(", ")}.\n`);
}
if (sections.length === 0) sections.push("Every sample ran as written, and every export is covered.\n");
writeFileSync(join(dir, "report.md"), `${sections.join("\n")}\n${summary}\n`);

process.exit(results.length === 0 || passing.length < results.length || uncovered.length > 0 ? 1 : 0);
