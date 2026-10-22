// Writes the quarterly sweep's issue body: each published tutorial whose latest passing test run
// is more than 90 days old. The Tutorial Sweep workflow runs it and opens the issue.
//
//   pnpm docs:sweep --out <file> [--today YYYY-MM-DD]
//
// The date defaults to today in UTC, the same on every machine. When no tutorial is due it writes
// no file. Exits 0 when the sweep is done, 1 when a record or sidecar manifest can't be read, and
// 2 on a bad argument.

import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatUtcDateStamp } from '../../src/lib/dates.ts';
import { parseSweepArgs, sweep, sweepIssue, SWEEP_AFTER_DAYS } from './sweep.ts';

const root = join(import.meta.dirname, '..', '..');

let args: { out: string; today: string };
try {
  args = parseSweepArgs(process.argv.slice(2), () => formatUtcDateStamp(Date.now()));
} catch (error) {
  console.error(`docs:sweep: ${(error as Error).message}`);
  process.exit(2);
}

const { due, problems } = sweep({ root, today: args.today });
// A file left from an earlier sweep must not read as this one's.
rmSync(args.out, { force: true });
if (problems.length > 0) {
  console.error(`docs:sweep: these can't be read, so the sweep can't tell which tutorials are due:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
  process.exit(1);
}
if (due.length === 0) {
  console.log(`No tutorial's latest passing run is more than ${SWEEP_AFTER_DAYS} days old on ${args.today}.`);
} else {
  writeFileSync(args.out, sweepIssue(due, args.today));
  console.log(`${due.length} due on ${args.today}: ${due.map(({ tutorial }) => tutorial.slug).join(', ')}. Wrote the issue body to ${args.out}.`);
}
