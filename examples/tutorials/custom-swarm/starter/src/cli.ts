// Usage: node src/cli.ts [--lines] [--words] [--chars] [--json] <file...>
// Prints how many lines, words and characters each file holds.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { tally, type Tally } from "./count.ts";
import { OPTIONS } from "./options.ts";

const USAGE = `Usage: tally [--lines] [--words] [--chars] [--json] <file...>

Counts the lines, words and characters in each file.

Options:
  -l, --lines   print the line count
  -w, --words   print the word count
  -c, --chars   print the character count
  -j, --json    print one JSON object instead of one line per file
  -h, --help    print this help and exit

With none of --lines, --words or --chars, it prints all three.`;

function fail(message: string): never {
  console.error(`tally: ${message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: OPTIONS });
} catch (error) {
  fail(`${(error as Error).message}\n\n${USAGE}`);
}

const { values, positionals: files } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (files.length === 0) fail(`name at least one file.\n\n${USAGE}`);

// The counts to print, in this order. None chosen means all three.
const COUNTS = ["lines", "words", "chars"] as const;
const chosen = COUNTS.filter((count) => values[count]);
const counts = chosen.length > 0 ? chosen : COUNTS;

const results = new Map<string, Tally>();
for (const file of files) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail(`no such file: ${file}`);
  }
  results.set(file, tally(text));
}

if (values.json) {
  const report: Record<string, Partial<Tally>> = {};
  for (const [file, result] of results) {
    report[file] = Object.fromEntries(counts.map((count) => [count, result[count]]));
  }
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [file, result] of results) {
    console.log(`${file}: ${counts.map((count) => `${result[count]} ${count}`).join(", ")}`);
  }
}
