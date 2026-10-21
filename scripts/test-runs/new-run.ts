// Adds a test run's section to a tutorial's record, examples/tutorials/<slug>/test-runs.md,
// generated from the step cards on its page. README.md beside this file says how a run is done.
//
//   pnpm docs:test-run <slug> [--date YYYY-MM-DD]
//
// The date defaults to today, as a local calendar date. Exits 0 when the section is added, 1 when
// the page or the tutorial folder is not in order, and 2 on a bad argument.

import { join, relative } from 'node:path';
import { createMarkdownRenderer } from 'vitepress';
import siteConfig from '../../docs/.vitepress/config.mts';
import { formatDateStamp } from '../../src/lib/dates.ts';
import { newTestRun, parseTestRunArgs } from './test-runs.ts';

const root = join(import.meta.dirname, '..', '..');

let args: { slug: string; date: string };
try {
  args = parseTestRunArgs(process.argv.slice(2), () => formatDateStamp(Date.now()));
} catch (error) {
  console.error(`docs:test-run: ${(error as Error).message}`);
  process.exit(2);
}

try {
  const config = await siteConfig({ command: 'build', mode: 'production' });
  const md = await createMarkdownRenderer(join(root, 'docs'), config.markdown);
  const { file } = newTestRun({ root, ...args, md });
  console.log(`Added a ${args.date} run to ${relative(root, file).replaceAll('\\', '/')}. Fill in each value in italics.`);
} catch (error) {
  console.error(`docs:test-run: ${(error as Error).message}`);
  process.exit(1);
}
