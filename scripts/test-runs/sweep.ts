// The quarterly sweep: which published tutorials are due a re-run because their latest passing
// test run is more than 90 days old, and the issue that lists them. README.md beside this file
// says what a sweep re-run involves.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseSidecar, type Sidecar } from '../capture/capture.ts';
import { publishedTutorials, tutorialTitle, type Tutorial } from '../../docs/.vitepress/tutorials.ts';
import { daysBetweenDateStamps, isDateStamp } from '../../src/lib/dates.ts';
import { parseRecord, REPO } from './publish.ts';

/** A tutorial whose latest passing run is more than this many days old is due a re-run. */
export const SWEEP_AFTER_DAYS = 90;

/** A tutorial the sweep lists. */
export interface DueTutorial {
  tutorial: Tutorial;
  /** The date of its latest passing run, or null when its record has none. */
  lastPass: string | null;
  /** Days from `lastPass` to the sweep's date, or null when there is no passing run. */
  age: number | null;
  /** Its sidecar manifest, or null when it has none. */
  sidecar: Sidecar | null;
}

/**
 * Reads each published tutorial's record, `examples/tutorials/<slug>/test-runs.md`, and sidecar
 * manifest under `root`, and returns, in series order, those due a re-run on `today`: the ones
 * whose latest passing run is more than `SWEEP_AFTER_DAYS` days old or that have no passing run.
 * A record the docs build would reject, or a sidecar manifest that can't be read, is a problem
 * instead.
 */
export function sweep({ root, today }: { root: string; today: string }): { due: DueTutorial[]; problems: string[] } {
  const due: DueTutorial[] = [];
  const problems: string[] = [];
  for (const tutorial of publishedTutorials(join(root, 'docs'))) {
    const folder = `examples/tutorials/${tutorial.slug}`;
    const read = (file: string) => {
      const path = join(root, folder, file);
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    };
    const before = problems.length;

    const record = read('test-runs.md');
    const { runs, problems: unread } = record === null ? { runs: [], problems: [] } : parseRecord(record);
    problems.push(...unread.map((problem) => `${folder}/test-runs.md: ${problem}`));
    // Dates written YYYY-MM-DD sort as text.
    const lastPass = runs.filter((run) => run.result === 'pass').map((run) => run.date).sort().at(-1) ?? null;

    let sidecar: Sidecar | null = null;
    const manifest = read('sidecar.json');
    if (manifest !== null) {
      try {
        sidecar = parseSidecar(manifest, tutorial.slug);
      } catch (error) {
        problems.push(`${folder}/sidecar.json: ${(error as Error).message}`);
      }
    }

    if (problems.length > before) continue;
    const age = lastPass === null ? null : daysBetweenDateStamps(lastPass, today);
    if (age === null || age > SWEEP_AFTER_DAYS) due.push({ tutorial, lastPass, age, sidecar });
  }
  return { due, problems };
}

/** A value made safe for a Markdown table cell. */
const cell = (text: string) => text.replace(/\s+/g, ' ').replaceAll('|', '\\|');

/** The sweep issue's body for the tutorials `due` on `today`. */
export function sweepIssue(due: DueTutorial[], today: string): string {
  const rows = due.map(({ tutorial, lastPass, age, sidecar }) => {
    const record = `${REPO}/blob/master/examples/tutorials/${tutorial.slug}/test-runs.md`;
    const clis = sidecar === null ? '—' : Object.entries(sidecar.cliVersions).map(([cli, version]) => `${cli} ${version}`).join(', ') || '—';
    return [
      tutorialTitle(tutorial),
      lastPass === null ? 'none' : `[${lastPass}](${record})`,
      age === null ? '—' : String(age),
      sidecar?.quayVersion ?? '—',
      sidecar?.recordedOn ?? '—',
      clis,
    ];
  });
  const count = due.length === 1 ? '1 tutorial' : `${due.length} tutorials`;
  return [
    `The quarterly sweep on ${today} found ${count} due a re-run: a latest passing test run more than ${SWEEP_AFTER_DAYS} days old, or no passing run.`,
    'Re-run each one on the latest agent CLIs, as `scripts/test-runs/README.md` says.',
    '',
    '| Tutorial | Latest passing run | Days old | Quay captured | Recorded on | CLIs recorded |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    '',
    'The last three columns come from each tutorial\'s sidecar manifest, `examples/tutorials/<slug>/sidecar.json`: what its screenshots and recordings were made with.',
    '',
    'For each tutorial:',
    '',
    "1. Bump its starter's pinned dependencies, or decide to leave them. A sweep is the only time starter dependencies are bumped. A bump changes the run fingerprint, so the tutorial then needs two passing runs; otherwise one.",
    '2. Do the test runs. Each run re-makes the recordings.',
    '3. Recapture the screenshots from the new recordings with `pnpm docs:capture`, which rewrites the sidecar manifest.',
    '',
    ...due.map(({ tutorial }) => `- [ ] ${tutorialTitle(tutorial)} (\`${tutorial.slug}\`)`),
    '',
  ].join('\n');
}

const USAGE = 'usage: pnpm docs:sweep --out <file> [--today YYYY-MM-DD]';

/** Reads the command's arguments. The date defaults to `today()`. */
export function parseSweepArgs(argv: string[], today: () => string): { out: string; today: string } {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { out: { type: 'string' }, today: { type: 'string' } }, strict: true }));
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${USAGE}`);
  }
  if (values.out === undefined || values.out === '') throw new Error(`--out names the file the issue body is written to\n${USAGE}`);
  const date = values.today ?? today();
  if (!isDateStamp(date)) throw new Error(`--today "${date}" is not a date written YYYY-MM-DD`);
  return { out: values.out, today: date };
}
